// POST /open-capsule
// header: x-participant-token
// open_mode = 'own_pace' のルーム専用。各自のタイミングで結果を取得する。
import { authenticateParticipant } from "../_shared/auth.ts";
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

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status, open_mode, show_submitter")
    .eq("id", participant.room_id)
    .single();
  if (roomError || !room) return errorResponse("room_not_found", "ガチャが見つかりません", 404);

  if (room.open_mode !== "own_pace") {
    return errorResponse("wrong_open_mode", "このガチャは「みんなで一緒に開ける」設定です", 409);
  }
  if (room.status !== "awaiting_open" && room.status !== "showing_result") {
    return errorResponse("not_ready", "まだカプセルが出ていません", 409);
  }

  const { data: draw, error: drawError } = await supabase
    .from("draws")
    .select("id, winner_candidate_id")
    .eq("room_id", room.id)
    .order("draw_number", { ascending: false })
    .limit(1)
    .single();
  if (drawError || !draw) return errorResponse("draw_not_found", "抽選結果が見つかりません", 404);

  const { data: winner, error: winnerError } = await supabase
    .from("candidates")
    .select("id, text, participant_id")
    .eq("id", draw.winner_candidate_id)
    .single();
  if (winnerError || !winner) return errorResponse("winner_not_found", "結果の取得に失敗しました", 500);

  let submitterNickname: string | null = null;
  if (room.show_submitter) {
    const { data: submitter } = await supabase
      .from("participants")
      .select("nickname")
      .eq("id", winner.participant_id)
      .maybeSingle();
    submitterNickname = submitter?.nickname ?? null;
  }

  await supabase
    .from("participants")
    .update({ opened_current_draw: true })
    .eq("id", participant.id);

  return jsonResponse({
    candidateText: winner.text,
    submitterNickname,
  });
});
