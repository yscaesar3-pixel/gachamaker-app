// POST /add-candidate
// header: x-participant-token
// body: { text: string }
import { authenticateParticipant } from "../_shared/auth.ts";
import { broadcastRoomEvent } from "../_shared/broadcast.ts";
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";
import { normalizeCandidateText, sanitizeSingleLineInput } from "../_shared/normalize.ts";

const ROOM_CANDIDATE_LIMIT = 200;

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

  if (typeof body.text !== "string") {
    return errorResponse("invalid_candidate", "候補を入力してください");
  }
  const textResult = sanitizeSingleLineInput(body.text, 30);
  if (!textResult.ok) {
    return errorResponse("invalid_candidate", "候補の内容を確認してください");
  }
  const normalized = normalizeCandidateText(textResult.value);

  const supabase = getServiceClient();

  // ルーム状態と設定を取得
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status, max_candidates_per_person, candidate_count")
    .eq("id", participant.room_id)
    .single();

  if (roomError || !room) return errorResponse("room_not_found", "ガチャが見つかりません", 404);

  if (room.status !== "accepting") {
    return errorResponse("acceptance_closed", "候補の受付は終了しました", 409);
  }
  if (room.candidate_count >= ROOM_CANDIDATE_LIMIT) {
    return errorResponse("room_candidate_limit", "入れられる候補はここまでです！", 409);
  }

  // 1人あたりの投稿上限チェック（サーバー側で厳密に判定。仕様56）
  if (room.max_candidates_per_person !== null) {
    const { count, error: countError } = await supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("participant_id", participant.id)
      .eq("deleted", false);

    if (countError) return errorResponse("lookup_failed", "確認に失敗しました", 500);
    if ((count ?? 0) >= room.max_candidates_per_person) {
      return errorResponse("per_person_limit", "入れられる候補はここまでです！", 409);
    }
  }

  const { data: candidate, error: insertError } = await supabase
    .from("candidates")
    .insert({
      room_id: room.id,
      participant_id: participant.id,
      text: textResult.value,
      normalized_text: normalized,
    })
    .select("id, text, created_at")
    .single();

  if (insertError) {
    // ユニーク制約違反 = 同一参加者による完全一致の重複候補
    if (insertError.code === "23505") {
      return errorResponse("duplicate_candidate", "同じ候補はすでに入れています", 409);
    }
    return errorResponse("candidate_add_failed", "うまく送れませんでした。もう一度試してみてね", 500);
  }

  // ルームの候補数キャッシュを更新（レース条件があっても最終的には整合するよう +1 の相対更新）
  await supabase.rpc("increment_candidate_count", { p_room_id: room.id, p_delta: 1 });

  await broadcastRoomEvent(room.id, "candidate_added", {
    candidateId: candidate.id,
    participantId: participant.id,
  });

  return jsonResponse({
    candidateId: candidate.id,
    text: candidate.text,
  });
});
