// POST /restart-draw
// header: x-participant-token (ホストのトークン)
// 未開封者がいても呼び出せる。確認はクライアント側UIで行う(仕様43)。
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

  if (room.status !== "showing_result" && room.status !== "awaiting_open") {
    return errorResponse("invalid_state", "今は「もう一度」できません", 409);
  }

  const { error: updateError } = await supabase
    .from("rooms")
    .update({ status: "accepting" })
    .eq("id", room.id);

  if (updateError) return errorResponse("restart_failed", "うまく送れませんでした。もう一度試してみてね", 500);

  await broadcastRoomEvent(room.id, "room_status_changed", { status: "accepting" });

  return jsonResponse({ ok: true });
});
