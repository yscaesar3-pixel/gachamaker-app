// POST /finish-room
// header: x-participant-token (ホストのトークン)
import { authenticateParticipant } from "../_shared/auth.ts";
import { broadcastRoomEvent } from "../_shared/broadcast.ts";
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== "POST") return errorResponse("method_not_allowed", "", 405);

  const participant = await authenticateParticipant(req);
  if (!participant) return errorResponse("unauthorized", "認証情報が無効です", 401);
  if (!participant.is_host) return errorResponse("forbidden", "ホストのみ操作できます", 403);

  const supabase = getServiceClient();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status")
    .eq("id", participant.room_id)
    .single();
  if (roomError || !room) return errorResponse("room_not_found", "ガチャが見つかりません", 404);

  if (room.status !== "accepting" && room.status !== "showing_result" && room.status !== "awaiting_open") {
    return errorResponse("invalid_state", "今は終了できません", 409);
  }

  const { error: updateError } = await supabase
    .from("rooms")
    .update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("id", room.id);

  if (updateError) return errorResponse("finish_failed", "うまく送れませんでした。もう一度試してみてね", 500);

  await broadcastRoomEvent(room.id, "room_status_changed", { status: "finished" });

  return jsonResponse({ ok: true });
});
