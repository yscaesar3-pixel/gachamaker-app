// POST /delete-candidate
// header: x-participant-token
// body: { candidateId: string }
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
    return errorResponse("not_a_member", "このガチャの参加者ではありません", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "リクエストの形式が正しくありません");
  }
  if (typeof body.candidateId !== "string") {
    return errorResponse("invalid_request", "候補を指定してください");
  }

  const supabase = getServiceClient();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status, show_candidates")
    .eq("id", participant.room_id)
    .single();
  if (roomError || !room) return errorResponse("room_not_found", "ガチャが見つかりません", 404);

  if (room.status !== "accepting") {
    return errorResponse(
      "acceptance_closed",
      "受付終了後のため削除できませんでした",
      409,
    );
  }

  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id, participant_id, deleted")
    .eq("id", body.candidateId)
    .eq("room_id", room.id)
    .maybeSingle();

  if (candidateError) return errorResponse("lookup_failed", "確認に失敗しました", 500);
  if (!candidate || candidate.deleted) {
    return errorResponse("candidate_not_found", "候補が見つかりません", 404);
  }

  const isOwn = candidate.participant_id === participant.id;
  const isHostDeletingPublic = participant.is_host && room.show_candidates;

  if (!isOwn && !isHostDeletingPublic) {
    return errorResponse("forbidden", "この候補を削除する権限がありません", 403);
  }
  // 秘密ガチャではホストであっても他人の候補を個別には削除できない(仕様18)
  if (!isOwn && !room.show_candidates) {
    return errorResponse("forbidden", "この候補を削除する権限がありません", 403);
  }

  const { error: updateError } = await supabase
    .from("candidates")
    .update({ deleted: true })
    .eq("id", candidate.id);

  if (updateError) {
    return errorResponse("delete_failed", "うまく送れませんでした。もう一度試してみてね", 500);
  }

  await supabase.rpc("increment_candidate_count", { p_room_id: room.id, p_delta: -1 });

  await broadcastRoomEvent(room.id, "candidate_removed", {
    candidateId: candidate.id,
  });

  return jsonResponse({ ok: true });
});
