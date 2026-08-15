// POST /heartbeat
// header: x-participant-token
// クライアントはフォアグラウンドにいる間、15秒間隔でこれを呼ぶ。
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

  const supabase = getServiceClient();

  const wasOffline = !(
    await supabase
      .from("participants")
      .select("online")
      .eq("id", participant.id)
      .single()
  ).data?.online;

  const { error } = await supabase
    .from("participants")
    .update({ online: true, last_seen_at: new Date().toISOString() })
    .eq("id", participant.id);

  if (error) return errorResponse("heartbeat_failed", "通信に失敗しました", 500);

  // オフライン→オンラインへの復帰は他の参加者へ通知する（一時離脱の復帰なので参加通知ではない）
  if (wasOffline) {
    await broadcastRoomEvent(participant.room_id, "participant_online_changed", {
      participantId: participant.id,
      online: true,
    });
  }

  return jsonResponse({ ok: true });
});
