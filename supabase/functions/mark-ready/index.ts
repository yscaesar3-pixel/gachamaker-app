// POST /mark-ready
// header: x-participant-token
// open_mode = 'all_together' のルーム専用。
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

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status, open_mode, show_submitter")
    .eq("id", participant.room_id)
    .single();
  if (roomError || !room) return errorResponse("room_not_found", "ガチャが見つかりません", 404);

  if (room.open_mode !== "all_together") {
    return errorResponse("wrong_open_mode", "このガチャは「自分のタイミングで開ける」設定です", 409);
  }
  if (room.status !== "awaiting_open") {
    return errorResponse("not_ready", "まだカプセルが出ていません", 409);
  }

  // 準備OKは取り消せない(仕様37)。すでにtrueなら何もしない。
  await supabase
    .from("participants")
    .update({ ready_current_draw: true })
    .eq("id", participant.id)
    .eq("ready_current_draw", false);

  const [{ count: targetCount }, { count: readyCount }] = await Promise.all([
    supabase
      .from("participants")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("kicked", false)
      .is("left_at", null)
      .eq("online_at_draw_start", true),
    supabase
      .from("participants")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("kicked", false)
      .is("left_at", null)
      .eq("online_at_draw_start", true)
      .eq("ready_current_draw", true),
  ]);

  const { data: opened } = await supabase.rpc("try_auto_open_draw", { p_room_id: room.id });

  if (!opened) {
    await broadcastRoomEvent(room.id, "ready_count_changed", {
      readyCount: readyCount ?? 0,
      targetCount: targetCount ?? 0,
    });
    return jsonResponse({ opened: false, readyCount: readyCount ?? 0, targetCount: targetCount ?? 0 });
  }

  // 開封が確定した場合、draw_openedの配信はDB関数側(realtime.send)で行い済み。
  // ここでは呼び出し元への即時レスポンス用にだけ結果を取得する。
  const { data: draw } = await supabase
    .from("draws")
    .select("winner_candidate_id")
    .eq("room_id", room.id)
    .order("draw_number", { ascending: false })
    .limit(1)
    .single();

  const { data: winner } = await supabase
    .from("candidates")
    .select("id, text, participant_id")
    .eq("id", draw?.winner_candidate_id)
    .single();

  let submitterNickname: string | null = null;
  if (room.show_submitter && winner) {
    const { data: submitter } = await supabase
      .from("participants")
      .select("nickname")
      .eq("id", winner.participant_id)
      .maybeSingle();
    submitterNickname = submitter?.nickname ?? null;
  }

  return jsonResponse({ opened: true, candidateText: winner?.text ?? "", submitterNickname });
});
