// ルームごとのBroadcastチャンネルへイベントを配信する。
// クライアントは "room:{roomId}" チャンネルを購読し、以下のevent名を待ち受ける。
//
// 使う理由: 秘密ガチャの可視性制御をサーバー側で完全にコントロールするため、
// Postgres Changesの生テーブル変更をそのまま流さず、必ずこのヘルパー経由にする。
import { getServiceClient } from "./db.ts";

export type RoomEventName =
  | "participant_joined"
  | "participant_left"
  | "participant_kicked"
  | "participant_online_changed"
  | "nickname_changed"
  | "candidate_added"
  | "candidate_removed"
  | "room_status_changed"
  | "draw_started"
  | "ready_count_changed"
  | "draw_opened"
  | "room_reset_for_replay";

export async function broadcastRoomEvent(
  roomId: string,
  event: RoomEventName,
  payload: Record<string, unknown>,
) {
  const supabase = getServiceClient();
  const channel = supabase.channel(`room:${roomId}`);
  await channel.send({
    type: "broadcast",
    event,
    payload,
  });
  // Edge Function内で作ったchannelは使い捨てなのですぐ外す
  await supabase.removeChannel(channel);
}
