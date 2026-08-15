// ルーム状態を「見せてよい範囲」だけに整形する。
// 秘密ガチャ（show_candidates=false）では、本人の候補以外は文字列を含めない。
// これはEdge Function内でのみ行い、フィルタ前のデータをクライアントへ渡さないこと。

interface RoomRow {
  id: string;
  share_code: string;
  name: string;
  show_candidates: boolean;
  show_submitter: boolean;
  max_candidates_per_person: number | null;
  open_mode: string;
  status: string;
  host_participant_id: string | null;
  draw_count: number;
  candidate_count: number;
}

interface ParticipantRow {
  id: string;
  nickname: string;
  is_host: boolean;
  online: boolean;
  kicked: boolean;
  left_at: string | null;
}

interface CandidateRow {
  id: string;
  participant_id: string;
  text: string;
  created_at: string;
  deleted: boolean;
}

export function serializeRoomSummary(room: RoomRow) {
  return {
    roomId: room.id,
    shareCode: room.share_code,
    name: room.name,
    showCandidates: room.show_candidates,
    showSubmitter: room.show_submitter,
    maxCandidatesPerPerson: room.max_candidates_per_person,
    openMode: room.open_mode,
    status: room.status,
    hostParticipantId: room.host_participant_id,
    drawCount: room.draw_count,
    candidateCount: room.candidate_count,
  };
}

export function serializeParticipants(participants: ParticipantRow[]) {
  return participants
    .filter((p) => !p.kicked && !p.left_at)
    .map((p) => ({
      participantId: p.id,
      nickname: p.nickname,
      isHost: p.is_host,
      online: p.online,
    }));
}

/**
 * candidates は事前に deleted=false のもののみ渡すこと。
 * viewerParticipantId: 今この状態を見ようとしている参加者のID
 */
export function serializeCandidates(
  room: Pick<RoomRow, "show_candidates" | "show_submitter">,
  candidates: CandidateRow[],
  participantsById: Map<string, ParticipantRow>,
  viewerParticipantId: string,
) {
  return candidates
    .filter((c) => room.show_candidates || c.participant_id === viewerParticipantId)
    .map((c) => {
      const isMine = c.participant_id === viewerParticipantId;
      const submitter = participantsById.get(c.participant_id);
      return {
        candidateId: c.id,
        text: c.text,
        isMine,
        submitterNickname:
          room.show_submitter || isMine ? submitter?.nickname ?? null : null,
      };
    });
}
