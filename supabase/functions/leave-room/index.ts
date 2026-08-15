// POST /leave-room
// header: x-participant-token
import { authenticateParticipant } from "../_shared/auth.ts";
import { broadcastRoomEvent } from "../_shared/broadcast.ts";
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== "POST") return errorResponse("method_not_allowed", "", 405);

  const participant = await authenticateParticipant(req);
  if (!participant) return errorResponse("unauthorized", "認証情報が無効です", 401);
  if (participant.kicked || participant.left_at) {
    return jsonResponse({ ok: true }); // すでに退出済みなら何もしない
  }

  const supabase = getServiceClient();

  const { error: updateError } = await supabase
    .from("participants")
    .update({ left_at: new Date().toISOString(), online: false })
    .eq("id", participant.id);

  if (updateError) return errorResponse("leave_failed", "うまく送れませんでした。もう一度試してみてね", 500);

  // オンライン0人になった場合の自動削除タイマー起点を即時反映
  await supabase.rpc("recompute_online_status");

  await broadcastRoomEvent(participant.room_id, "participant_left", {
    participantId: participant.id,
  });

  return jsonResponse({ ok: true });
});
