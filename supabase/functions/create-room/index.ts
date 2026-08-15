// POST /create-room
// body: {
//   name?: string,
//   showCandidates: boolean,
//   showSubmitter: boolean,
//   maxCandidatesPerPerson: number | null,
//   openMode: 'own_pace' | 'all_together',
//   hostNickname: string
// }
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";
import { generateToken, hashToken } from "../_shared/auth.ts";
import { generateShareCode } from "../_shared/shareCode.ts";
import { sanitizeSingleLineInput } from "../_shared/normalize.ts";
import { serializeParticipants, serializeRoomSummary } from "../_shared/serialize.ts";

const ALLOWED_MAX_CANDIDATES = [1, 2, 3, 5, 10, null]; // null = 無制限

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

  // --- ガチャ名（任意入力・未入力ならデフォルト） ---
  let roomName = "みんなでガチャメーカー";
  if (typeof body.name === "string" && body.name.trim().length > 0) {
    const nameResult = sanitizeSingleLineInput(body.name, 30);
    if (!nameResult.ok) return errorResponse("invalid_name", "ガチャの名前を確認してください");
    roomName = nameResult.value;
  }

  const showCandidates = body.showCandidates !== false; // デフォルト: 見せる
  const showSubmitter = body.showSubmitter === true; // デフォルト: 隠す

  const maxCandidatesPerPerson = body.maxCandidatesPerPerson ?? null;
  if (!ALLOWED_MAX_CANDIDATES.includes(maxCandidatesPerPerson as number | null)) {
    return errorResponse("invalid_max_candidates", "投稿数の設定を確認してください");
  }

  const openMode = body.openMode === "all_together" ? "all_together" : "own_pace";

  // --- ホスト名 ---
  if (typeof body.hostNickname !== "string") {
    return errorResponse("invalid_nickname", "名前を入力してください");
  }
  const nicknameResult = sanitizeSingleLineInput(body.hostNickname, 15);
  if (!nicknameResult.ok) {
    return errorResponse("invalid_nickname", "名前を確認してください");
  }

  const supabase = getServiceClient();

  // --- 共有コードの重複回避（衝突したら再生成、最大5回試行） ---
  let shareCode = "";
  let roomId: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    shareCode = generateShareCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        share_code: shareCode,
        name: roomName,
        show_candidates: showCandidates,
        show_submitter: showSubmitter,
        max_candidates_per_person: maxCandidatesPerPerson,
        open_mode: openMode,
      })
      .select("id")
      .single();

    if (!error && data) {
      roomId = data.id;
      break;
    }
    // ユニーク制約違反(共有コード重複)以外のエラーは即座に返す
    if (error && error.code !== "23505") {
      return errorResponse("room_creation_failed", "ガチャの作成に失敗しました", 500);
    }
  }

  if (!roomId) {
    return errorResponse("room_creation_failed", "ガチャの作成に失敗しました。もう一度お試しください", 500);
  }

  // --- ホスト参加者を作成 ---
  const token = generateToken();
  const tokenHash = await hashToken(token);

  const { data: hostParticipant, error: participantError } = await supabase
    .from("participants")
    .insert({
      room_id: roomId,
      nickname: nicknameResult.value,
      token_hash: tokenHash,
      is_host: true,
    })
    .select("id, nickname, is_host, online, kicked, left_at")
    .single();

  if (participantError || !hostParticipant) {
    // ロールバック: ルームだけ残ると孤立するので削除
    await supabase.from("rooms").delete().eq("id", roomId);
    return errorResponse("room_creation_failed", "ガチャの作成に失敗しました", 500);
  }

  const { data: room, error: updateError } = await supabase
    .from("rooms")
    .update({ host_participant_id: hostParticipant.id })
    .eq("id", roomId)
    .select(
      "id, share_code, name, show_candidates, show_submitter, max_candidates_per_person, open_mode, status, host_participant_id, draw_count, candidate_count",
    )
    .single();

  if (updateError || !room) {
    return errorResponse("room_creation_failed", "ガチャの作成に失敗しました", 500);
  }

  return jsonResponse({
    participantToken: token,
    room: serializeRoomSummary(room),
    participants: serializeParticipants([hostParticipant]),
    yourParticipantId: hostParticipant.id,
  });
});
