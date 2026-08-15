// POST /resume-session
// header: x-participant-token
// アプリ起動時・再接続時に呼ぶ。過去の演出を再現せず、現在の状態をそのまま返す。
import { authenticateParticipant } from "../_shared/auth.ts";
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";
import {
  serializeCandidates,
  serializeParticipants,
  serializeRoomSummary,
} from "../_shared/serialize.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== "POST") return errorResponse("method_not_allowed", "", 405);

  const participant = await authenticateParticipant(req);
  if (!participant) return errorResponse("unauthorized", "認証情報が無効です", 401);

  const supabase = getServiceClient();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select(
      "id, share_code, name, show_candidates, show_submitter, max_candidates_per_person, open_mode, status, host_participant_id, draw_count, candidate_count",
    )
    .eq("id", participant.room_id)
    .maybeSingle();

  if (roomError) return errorResponse("lookup_failed", "確認に失敗しました", 500);
  if (!room) return errorResponse("room_not_found", "このガチャはもう存在しません", 404);

  // 外された/正式退出済みの場合はその旨だけ返す(再参加は不可)
  if (participant.kicked) {
    return jsonResponse({
      membershipStatus: "kicked",
      room: serializeRoomSummary(room),
    });
  }
  if (room.status === "finished") {
    return jsonResponse({
      membershipStatus: "room_finished",
      room: serializeRoomSummary(room),
    });
  }

  // 復帰扱い: オンライン状態を更新(ハートビートと同じ効果)
  await supabase
    .from("participants")
    .update({ online: true, last_seen_at: new Date().toISOString() })
    .eq("id", participant.id);

  const [{ data: participants }, { data: candidates }] = await Promise.all([
    supabase
      .from("participants")
      .select("id, nickname, is_host, online, kicked, left_at, opened_current_draw, ready_current_draw")
      .eq("room_id", room.id),
    supabase
      .from("candidates")
      .select("id, participant_id, text, created_at, deleted")
      .eq("room_id", room.id)
      .eq("deleted", false),
  ]);

  const participantsById = new Map((participants ?? []).map((p) => [p.id, p]));

  // 現在の抽選の状態(あれば)。演出のやり直しはせず、今の到達点をそのまま返す。
  let currentDraw: Record<string, unknown> | null = null;
  if (room.status === "awaiting_open" || room.status === "showing_result") {
    const { data: draw } = await supabase
      .from("draws")
      .select("draw_number, started_at, open_mode, awaiting_open_started_at, winner_candidate_id, ended_at")
      .eq("room_id", room.id)
      .order("draw_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draw) {
      const meRow = participantsById.get(participant.id) as unknown as
        | { opened_current_draw?: boolean; ready_current_draw?: boolean }
        | undefined;

      // own_paceは自分が開封済みの場合のみ、all_togetherはshowing_resultになった場合のみ結果を含める
      const canReveal =
        (draw.open_mode === "own_pace" && meRow?.opened_current_draw === true) ||
        (draw.open_mode === "all_together" && room.status === "showing_result");

      let revealed: { candidateText: string; submitterNickname: string | null } | null = null;
      if (canReveal) {
        const { data: winner } = await supabase
          .from("candidates")
          .select("text, participant_id")
          .eq("id", draw.winner_candidate_id)
          .maybeSingle();
        let submitterNickname: string | null = null;
        if (room.show_submitter && winner) {
          const submitter = participantsById.get(winner.participant_id);
          submitterNickname = submitter?.nickname ?? null;
        }
        revealed = { candidateText: winner?.text ?? "", submitterNickname };
      }

      currentDraw = {
        drawNumber: draw.draw_number,
        startedAt: draw.started_at,
        openMode: draw.open_mode,
        awaitingOpenStartedAt: draw.awaiting_open_started_at,
        roomStatus: room.status,
        revealed,
      };
    }
  }

  return jsonResponse({
    membershipStatus: "active",
    room: serializeRoomSummary(room),
    participants: serializeParticipants(participants ?? []),
    candidates: serializeCandidates(
      room,
      candidates ?? [],
      participantsById as Map<string, { id: string; nickname: string; is_host: boolean; online: boolean; kicked: boolean; left_at: string | null }>,
      participant.id,
    ),
    yourParticipantId: participant.id,
    currentDraw,
  });
});
