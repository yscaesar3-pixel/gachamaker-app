// POST /update-nickname
// header: x-participant-token
// body: { nickname: string }
import { authenticateParticipant } from "../_shared/auth.ts";
import { broadcastRoomEvent } from "../_shared/broadcast.ts";
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";
import { sanitizeSingleLineInput } from "../_shared/normalize.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== "POST") return errorResponse("method_not_allowed", "", 405);

  const participant = await authenticateParticipant(req);
  if (!participant) return errorResponse("unauthorized", "認証情報が無効です", 401);
  if (participant.kicked || participant.left_at) {
    return errorResponse("not_a_member", "このガチャの参加者ではありません", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "リクエストの形式が正しくありません");
  }
  if (typeof body.nickname !== "string") {
    return errorResponse("invalid_nickname", "名前を入力してください");
  }
  const nicknameResult = sanitizeSingleLineInput(body.nickname, 15);
  if (!nicknameResult.ok) return errorResponse("invalid_nickname", "名前を確認してください");

  const supabase = getServiceClient();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status")
    .eq("id", participant.room_id)
    .single();
  if (roomError || !room) return errorResponse("room_not_found", "ガチャが見つかりません", 404);

  if (room.status !== "accepting") {
    return errorResponse("nickname_locked", "今は名前を変更できません", 409);
  }

  const { error: updateError } = await supabase
    .from("participants")
    .update({ nickname: nicknameResult.value })
    .eq("id", participant.id);

  if (updateError) return errorResponse("update_failed", "うまく送れませんでした。もう一度試してみてね", 500);

  await broadcastRoomEvent(room.id, "nickname_changed", {
    participantId: participant.id,
    nickname: nicknameResult.value,
  });

  return jsonResponse({ ok: true });
});
