// 候補文字列の正規化
// 仕様14: 大文字/小文字・半角/全角・前後空白の差を同一とみなす
export function normalizeCandidateText(raw: string): string {
  return raw
    .normalize("NFKC") // 全角/半角の統一
    .trim()
    .toLowerCase();
}

// 入力バリデーション用: 改行不可・前後空白削除・空白のみ不可
export function sanitizeSingleLineInput(
  raw: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_type" };
  if (/[\r\n]/.test(raw)) return { ok: false, reason: "contains_newline" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if ([...trimmed].length > maxLength) return { ok: false, reason: "too_long" };
  return { ok: true, value: trimmed };
}
