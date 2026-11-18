// 管理员登录：账号密码只存 Cloudflare 环境变量 ADMIN_USERNAME / ADMIN_PASSWORD。
// 登录成功下发签名 Cookie（30 天），此后该浏览器用所有口令功能免输口令。
// GET /api/admin → { configured, admin, user }
// POST /api/admin {action:"login", username, password} / {action:"logout"}

import { ADMIN_COOKIE, makeAdminCookieValue, verifyAdminCookie, jsonError } from "../_lib/gate.js";

function cookieHeader(value, maxAge) {
  return ADMIN_COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const configured = !!(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);
  const user = configured ? await verifyAdminCookie(request, env) : null;
  return new Response(JSON.stringify({ configured: configured, admin: !!user, user: user || "" }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = await request.json(); } catch (e) { /* 忽略 */ }
  if (body.action === "logout") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", "Set-Cookie": cookieHeader("", 0), "Cache-Control": "no-store" },
    });
  }
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return jsonError("管理员账号未配置（需在 Cloudflare 设置 ADMIN_USERNAME 与 ADMIN_PASSWORD）", 503);
  }
  if (body.action === "login") {
    if (body.username !== env.ADMIN_USERNAME || body.password !== env.ADMIN_PASSWORD) {
      return jsonError("账号或密码错误", 401);
    }
    const value = await makeAdminCookieValue(env, body.username);
    return new Response(JSON.stringify({ ok: true, user: body.username }), {
      headers: { "Content-Type": "application/json", "Set-Cookie": cookieHeader(value, 30 * 24 * 3600), "Cache-Control": "no-store" },
    });
  }
  return jsonError("未知操作", 400);
}
