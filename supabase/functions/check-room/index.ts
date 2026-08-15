// POST /check-room
// body: { shareCode: string }
// 参加者はまだ作らない。共有コード入力直後の確認用(仕様10)。
import { errorResponse, getServiceClient, handleOptions, jsonResponse } from "../_shared/db.ts";

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
  if (typeof body.shareCode !== "string" || !body.shareCode.trim()) {
    return errorResponse("invalid_request", "共有コードを入力してください");
  }

  const supabase = getServiceClient();
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, name, status")
    .eq("share_code", body.shareCode.trim().toUpperCase())
    .neq("status", "finished")
    .maybeSingle();

  if (error) return errorResponse("lookup_failed", "確認に失敗しました", 500);
  if (!room) {
    return errorResponse("room_not_found", "この共有コードのガチャは見つかりませんでした", 404);
  }

  return jsonResponse({ roomId: room.id, name: room.name });
});
