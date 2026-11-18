// 飞书待听 · 列表 / 取稿 / 删除（口令门后）
// 数据在 Supabase reader_inbox 表；服务端用 SUPABASE_URL + SUPABASE_SERVICE_KEY 访问。
// 规则（Lee 2026-11-07 定）：入库后 23 小时自动过期（列表只出未过期行，过期行由本地监听脚本清扫）；页面可手动删除。

import { checkGate, jsonError } from "../_lib/gate.js";

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  };
}

function configured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

// 协作提交的成品带 MP3（muse19 生成后传到公开桶 reader-audio，文件名 = 待听行 id）
function withAudio(env, row) {
  const has = typeof row.source_message_id === "string" && row.source_message_id.indexOf("collab:") === 0;
  const out = Object.assign({}, row);
  delete out.source_message_id;
  out.listened = !!row.listened_at;
  delete out.listened_at;
  out.has_audio = has;
  out.audio_url = has
    ? env.SUPABASE_URL.replace(/\/$/, "") + "/storage/v1/object/public/reader-audio/" + row.id + ".mp3"
    : "";
  return out;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await checkGate(request, env);
  if (denied) return denied;
  if (!configured(env)) {
    return new Response(JSON.stringify({ configured: false, items: [] }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const base = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/reader_inbox";
  try {
    if (id) {
      const r = await fetch(base + "?id=eq." + encodeURIComponent(id) + "&select=id,file_name,mode,provider,model,refined_text,char_count,created_at,expires_at,source_message_id", { headers: sbHeaders(env) });
      if (!r.ok) return jsonError("读取失败（" + r.status + "）", 502);
      const rows = await r.json();
      if (!rows.length) return jsonError("这条已不存在（可能已过期删除）", 404);
      return new Response(JSON.stringify({ configured: true, item: withAudio(env, rows[0]) }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const nowIso = new Date().toISOString();
    const q = "?select=id,file_name,mode,provider,model,char_count,created_at,expires_at,source_message_id,listened_at"
      + "&expires_at=gt." + encodeURIComponent(nowIso)
      + "&order=created_at.desc&limit=50";
    const r = await fetch(base + q, { headers: sbHeaders(env) });
    if (!r.ok) return jsonError("列表读取失败（" + r.status + "）", 502);
    const items = (await r.json()).map(function (it) { return withAudio(env, it); });
    return new Response(JSON.stringify({ configured: true, items }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return jsonError("待听服务暂时不可用：" + (e && e.message ? e.message : e), 502);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const denied = await checkGate(request, env);
  if (denied) return denied;
  if (!configured(env)) return jsonError("待听未配置", 503);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("缺少 id", 400);
  const base = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/reader_inbox";
  const r = await fetch(base + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return jsonError("删除失败（" + r.status + "）", 502);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(context) {
  // 打勾「已听」开关（Lee 2026-11-07 定）：跨设备同步，状态存 reader_inbox.listened_at；
  // 只是标记，不影响 23 小时到期删除规则。再点一次取消，恢复未听。
  const { request, env } = context;
  const denied = await checkGate(request, env);
  if (denied) return denied;
  if (!configured(env)) return jsonError("待听未配置", 503);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError("请求体不是 JSON", 400);
  }
  const id = body && body.id;
  if (!id) return jsonError("缺少 id", 400);
  const listened = !!(body && body.listened);
  const base = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/reader_inbox";
  const r = await fetch(base + "?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: Object.assign(sbHeaders(env), { Prefer: "return=minimal" }),
    body: JSON.stringify({ listened_at: listened ? new Date().toISOString() : null }),
  });
  if (!r.ok) return jsonError("标记失败（" + r.status + "）", 502);
  return new Response(JSON.stringify({ ok: true, listened }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
