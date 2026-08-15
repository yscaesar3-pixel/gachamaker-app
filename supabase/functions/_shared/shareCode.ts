// 共有コード生成
// 仕様9: 0/O, 1/I/l など紛らわしい文字を除外する
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 0,O,1,I,L除外
const CODE_LENGTH = 6;

export function generateShareCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}
