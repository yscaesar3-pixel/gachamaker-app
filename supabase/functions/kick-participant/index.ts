// POST /kick-participant
// header: x-participant-token (ホストのトークン)
// body: { targetParticipantId: string, deleteCandidates?: boolean }
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_json", "リクエストの形式が正しくありません");
  }
  if (typeof body.targetParticipantId !== "string") {
    return errorResponse("invalid_request", "対象を指定してください");
  }
  if (body.targetParticipantId === participant.id) {
    return errorResponse("cannot_kick_self", "自分自身をルームから外すことはできません", 400);
  }

  const supabase = getServiceClient();

  const { data: target, error: targetError } = await supabase
    .from("participants")
    .select("id, room_id, kicked, left_at")
    .eq("id", body.targetParticipantId)
    .eq("room_id", participant.room_id)
    .maybeSingle();

  if (targetError) return errorResponse("lookup_failed", "確認に失敗しました", 500);
  if (!target || target.kicked || target.left_at) {
    return errorResponse("participant_not_found", "参加者が見つかりません", 404);
  }

  const { error: updateError } = await supabase
    .from("participants")
    .update({ kicked: true, online: false })
    .eq("id", target.id);

  if (updateError) return errorResponse("kick_failed", "うまく送れませんでした。もう一度試してみてね", 500);

  if (body.deleteCandidates === true) {
    const { data: deletedCandidates } = await supabase
      .from("candidates")
      .update({ deleted: true })
      .eq("room_id", participant.room_id)
      .eq("participant_id", target.id)
      .eq("deleted", false)
      .select("id");

    if (deletedCandidates && deletedCandidates.length > 0) {
      await supabase.rpc("increment_candidate_count", {
        p_room_id: participant.room_id,
        p_delta: -deletedCandidates.length,
      });
    }
  }

  await supabase.rpc("recompute_online_status");

  await broadcastRoomEvent(participant.room_id, "participant_kicked", {
    participantId: target.id,
    candidatesDeleted: body.deleteCandidates === true,
  });

  return jsonResponse({ ok: true });
});
