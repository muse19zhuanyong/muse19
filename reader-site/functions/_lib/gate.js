// 访问校验：Fish / 小兵精炼 / 飞书待听共用。
// 两条通道任一通过即可：
//  1) 共享口令：请求头 X-Access-Password 与服务端 ACCESS_PASSWORD 比对；
//  2) 管理员登录：/api/admin 登录成功后下发的签名 Cookie（reader_admin，30 天），
//     签名密钥只在服务端环境变量里，Cookie 本身不含密码。
// 返回 null 表示通过；返回 Response 表示拒绝（直接 return 它）。

export const ADMIN_COOKIE = "reader_admin";
const ADMIN_TTL_MS = 30 * 24 * 3600 * 1000;

function signingKey(env) {
  return env.ADMIN_SECRET || ((env.ACCESS_PASSWORD || "") + "|" + (env.ADMIN_PASSWORD || ""));
}

function b64urlEncode(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToString(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(env, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(sig);
}

export async function makeAdminCookieValue(env, username) {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ u: username, exp: Date.now() + ADMIN_TTL_MS })));
  const sig = await hmac(env, payload);
  return payload + "." + sig;
}

export async function verifyAdminCookie(request, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return null;
  const cookieHeader = request.headers.get("Cookie") || "";
  let value = "";
  cookieHeader.split(";").forEach(function (part) {
    const kv = part.trim().split("=");
    if (kv[0] === ADMIN_COOKIE) value = kv.slice(1).join("=");
  });
  if (!value || value.indexOf(".") < 0) return null;
  const payload = value.slice(0, value.lastIndexOf("."));
  const sig = value.slice(value.lastIndexOf(".") + 1);
  const expect = await hmac(env, payload);
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(b64urlDecodeToString(payload));
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    if (data.u !== env.ADMIN_USERNAME) return null;
    return data.u;
  } catch (e) {
    return null;
  }
}

export async function checkGate(request, env) {
  const admin = await verifyAdminCookie(request, env);
  if (admin) return null;
  if (!env.ACCESS_PASSWORD) {
    return new Response(
      JSON.stringify({ error: "站长未设置访问口令（ACCESS_PASSWORD），该功能已禁用" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  const pw = request.headers.get("X-Access-Password") || "";
  if (pw !== env.ACCESS_PASSWORD) {
    return new Response(
      JSON.stringify({ error: "口令错误或未提供" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  return null;
}

export function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status || 400,
    headers: { "Content-Type": "application/json" },
  });
}
