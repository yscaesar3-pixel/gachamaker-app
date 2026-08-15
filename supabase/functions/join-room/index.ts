// POST /join-room
// body: { shareCode?: string, roomId?: string, nickname: string }
// shareCode か roomId のどちらか一方を指定する(QR/URL経由ならroomId、コード入力ならshareCode)
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";
import { generateToken, hashToken } from "../_shared/auth.ts";
import { sanitizeSingleLineInput } from "../_shared/normalize.ts";
import { serializeRoomSummary } from "../_shared/serialize.ts";
import { broadcastRoomEvent } from "../_shared/broadcast.ts";

const MAX_PARTICIPANTS = 20;

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== "POST") return errorResponse("method_not_allowed", "", 405);

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
  if (!nicknameResult.ok) {
    return errorResponse("invalid_nickname", "名前を確認してください");
  }

  const supabase = getServiceClient();

  const roomQuery = supabase
    .from("rooms")
    .select(
      "id, share_code, name, show_candidates, show_submitter, max_candidates_per_person, open_mode, status, host_participant_id, draw_count, candidate_count",
    );

  const { data: room, error: roomError } = typeof body.roomId === "string"
    ? await roomQuery.eq("id", body.roomId).maybeSingle()
    : typeof body.shareCode === "string"
    ? await roomQuery.eq("share_code", body.shareCode.trim().toUpperCase()).neq("status", "finished").maybeSingle()
    : { data: null, error: null };

  if (roomError) return errorResponse("lookup_failed", "ガチャの確認に失敗しました", 500);

  if (!room) {
    return errorResponse(
      "room_not_found",
      "この共有コードのガチャは見つかりませんでした",
      404,
    );
  }
  if (room.status === "finished") {
    return errorResponse("room_finished", "このガチャは終了しました", 410);
  }

  // 満員判定: kickedされておらず正式退出していない参加者数（仕様11）
  const { count, error: countError } = await supabase
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .eq("kicked", false)
    .is("left_at", null);

  if (countError) return errorResponse("lookup_failed", "確認に失敗しました", 500);
  if ((count ?? 0) >= MAX_PARTICIPANTS) {
    return errorResponse(
      "room_full",
      "このガチャは参加人数がいっぱいです",
      409,
    );
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);

  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .insert({
      room_id: room.id,
      nickname: nicknameResult.value,
      token_hash: tokenHash,
      is_host: false,
    })
    .select("id, nickname, is_host, online, kicked, left_at")
    .single();

  if (participantError || !participant) {
    return errorResponse("join_failed", "参加に失敗しました。もう一度お試しください", 500);
  }

  await broadcastRoomEvent(room.id, "participant_joined", {
    participantId: participant.id,
    nickname: participant.nickname,
  });

  return jsonResponse({
    participantToken: token,
    room: serializeRoomSummary(room),
    yourParticipantId: participant.id,
  });
});
