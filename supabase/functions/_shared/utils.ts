// 通用小工具：文本处理、hash
// 被 muse19-feishu-webhook / muse19-feishu-scheduler 共同引用

export const enc = new TextEncoder();

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export const cut = (s: string | null | undefined, n = 140): string => {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
};

export function fmtAmount(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return String(v);
}

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 清理 URL 尾部跟进来的中文标点等杂质 */
export function cleanUrl(u: string): string {
  return u.trim().replace(/[。，、；：）"'）\]]+$/g, "");
}
