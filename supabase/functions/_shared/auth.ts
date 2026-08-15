// 参加者トークン（ログイン不要の本人確認）
// クライアントは平文トークンを端末に保存し、以降のリクエストで
// ヘッダー `x-participant-token` として送る。DBにはハッシュのみ保存する。

import { getServiceClient } from "./db.ts";

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface AuthedParticipant {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  kicked: boolean;
  left_at: string | null;
}

/**
 * リクエストヘッダーのトークンから参加者を特定する。
 * 無効・存在しない・外された参加者の場合は null を返す。
 * ホスト権限などはここで信用せず、必ずこの関数でDBから引いた値を使うこと。
 */
export async function authenticateParticipant(
  req: Request,
): Promise<AuthedParticipant | null> {
  const token = req.headers.get("x-participant-token");
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("participants")
    .select("id, room_id, nickname, is_host, kicked, left_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  return data as AuthedParticipant;
}
