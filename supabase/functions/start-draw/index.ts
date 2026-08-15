// POST /start-draw
// header: x-participant-token (ホストのトークン)
import { authenticateParticipant } from "../_shared/auth.ts";
import { broadcastRoomEvent } from "../_shared/broadcast.ts";
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";

const ANIMATION_DURATION_MS = 6000;

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== "POST") return errorResponse("method_not_allowed", "", 405);

  const participant = await authenticateParticipant(req);
  if (!participant) return errorResponse("unauthorized", "認証情報が無効です", 401);
  if (!participant.is_host) return errorResponse("forbidden", "ホストのみ操作できます", 403);

  const supabase = getServiceClient();

  const { data: draw, error } = await supabase
    .rpc("start_draw", { p_room_id: participant.room_id })
    .single();

  if (error) {
    if (error.message?.includes("not_accepting")) {
      // 二重送信・状態不整合。エラーにせず現状を返す(仕様59: 最初の1回のみ有効)
      return errorResponse("already_started", "すでに抽選が始まっています", 409);
    }
    if (error.message?.includes("not_enough_candidates")) {
      return errorResponse("not_enough_candidates", "候補を2つ以上入れてね！", 409);
    }
    return errorResponse("draw_failed", "抽選に失敗しました", 500);
  }

  await broadcastRoomEvent(participant.room_id, "draw_started", {
    drawNumber: draw.draw_number,
    startedAt: draw.started_at,
    animationDurationMs: ANIMATION_DURATION_MS,
    openMode: draw.open_mode,
    awaitingOpenStartedAt: draw.awaiting_open_started_at,
  });

  return jsonResponse({
    drawNumber: draw.draw_number,
    startedAt: draw.started_at,
    animationDurationMs: ANIMATION_DURATION_MS,
    openMode: draw.open_mode,
    awaitingOpenStartedAt: draw.awaiting_open_started_at,
  });
});
