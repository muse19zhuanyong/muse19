// 协作提交 · 收件接口（口令门后）
// 其他 Muse / 人把「文档」「朗读稿」或「自带 MP3」提交进来，只负责收件与暂存：
// 文件存 Supabase Storage 桶 collab-inbox（{id}.bin + {id}.json 清单），
// 后续由 muse19 本地流水线取件处理（文档走技能提炼、朗读稿直接合成、自带 MP3 不重新
// 合成直接上架），MP3 生成/上架后回传网站待听区。
// 规则（Lee 2026-11-07 定）：只认共享口令、不搞名单制；提交必须声明类型 kind=document|script|audio，
// 并自填提交者名字 uploader 作标签；文档类可指定 mode（auto/limitup/usmapping/morning/digest/minutes/clean）。
// kind=audio（Lee 2026-11-08 定，为 muse8 自传 MP3 开通）：.bin 存 MP3 本体，朗读稿文字
// （multipart 的 text 字段 / JSON 的 text 字段）随清单 script_text 一起存，只作站上展示与
// 时长估算、不参与合成；音频须由提交者用 Fish 合成（Lee 2026-11-08 定）。

import { checkGate, jsonError } from "../_lib/gate.js";

const BUCKET = "collab-inbox";
const MAX_BYTES = 15 * 1024 * 1024;
const MODES = ["auto", "limitup", "usmapping", "morning", "watchdog", "xueqiu", "catalyst", "signal", "salpha", "shortline", "zsxq", "aimorning", "digest", "minutes", "clean"];

function sbBase(env) {
  return env.SUPABASE_URL.replace(/\/$/, "");
}

function sbHeaders(env, extra) {
  return Object.assign(
    {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
    },
    extra || {}
  );
}

function makeId() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    t.getUTCFullYear() +
    pad(t.getUTCMonth() + 1) +
    pad(t.getUTCDate()) +
    pad(t.getUTCHours()) +
    pad(t.getUTCMinutes()) +
    pad(t.getUTCSeconds());
  return stamp + "-" + Math.random().toString(36).slice(2, 8);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await checkGate(request, env);
  if (denied) return denied;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonError("站长未配置 Supabase，协作提交不可用", 503);
  }

  let uploader = "";
  let kind = "";
  let mode = "auto";
  let fileName = "";
  let bytes = null;
  let scriptText = ""; // kind=audio 时随附的朗读稿文字（只展示/估时长，不合成）

  const ct = request.headers.get("Content-Type") || "";
  try {
    if (ct.indexOf("multipart/form-data") >= 0) {
      const form = await request.formData();
      uploader = String(form.get("uploader") || "").trim();
      kind = String(form.get("kind") || "").trim();
      mode = String(form.get("mode") || "auto").trim();
      const file = form.get("file");
      const text = form.get("text");
      if (text != null && String(text).length) scriptText = String(text);
      if (file && typeof file.arrayBuffer === "function") {
        fileName = file.name || "";
        bytes = new Uint8Array(await file.arrayBuffer());
      } else if (scriptText) {
        fileName = String(form.get("file_name") || "朗读稿.txt").trim();
        bytes = new TextEncoder().encode(scriptText);
        scriptText = "";
      }
    } else {
      const body = await request.json();
      uploader = String(body.uploader || "").trim();
      kind = String(body.kind || "").trim();
      mode = String(body.mode || "auto").trim();
      fileName = String(body.file_name || "").trim();
      if (body.text != null && String(body.text).length) scriptText = String(body.text);
      if (body.content_base64) {
        const bin = atob(String(body.content_base64));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else if (scriptText) {
        if (!fileName) fileName = "朗读稿.txt";
        bytes = new TextEncoder().encode(scriptText);
        scriptText = "";
      }
    }
  } catch (e) {
    return jsonError("请求解析失败：" + (e && e.message ? e.message : e), 400);
  }

  if (!uploader) return jsonError("缺少提交者名字（uploader）：请自填名字作标签", 400);
  if (kind !== "document" && kind !== "script" && kind !== "audio") {
    return jsonError("必须声明类型 kind：document（文档，走技能处理）、script（朗读稿，直接做 MP3）或 audio（自带 MP3，直接上架）", 400);
  }
  if (kind === "audio") {
    const isMp3Name = /\.mp3$/i.test(fileName || "");
    const isMp3Magic =
      bytes &&
      bytes.length > 3 &&
      ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || // "ID3"
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)); // MPEG 帧同步
    if (!bytes || !bytes.length) return jsonError("audio 类型没有收到 MP3 文件内容", 400);
    if (!isMp3Name && !isMp3Magic) return jsonError("audio 类型只收 MP3 文件（.mp3）", 400);
    if (scriptText.length > 30000) return jsonError("随附朗读稿文字过长（上限 30000 字）", 400);
  }
  if (kind === "document" && MODES.indexOf(mode) < 0) {
    return jsonError("mode 不合法，可选：" + MODES.join("/"), 400);
  }
  if (!bytes || !bytes.length) return jsonError("没有收到文件内容", 400);
  if (bytes.length > MAX_BYTES) return jsonError("文件过大（上限 15MB）", 413);
  if (!fileName) fileName = kind === "script" ? "朗读稿.txt" : "未命名文档";

  // 每日上限（Lee 2026-11-07 定，2026-11-16 改为 30）：其他人提交合计不超过 30 篇/天（北京时间）
  // 计数 = 收件箱待处理清单数 + 今天已处理入库的协作条数
  try {
    const base0 = sbBase(env);
    const listR = await fetch(base0 + "/storage/v1/object/list/" + BUCKET, {
      method: "POST",
      headers: sbHeaders(env, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: "", limit: 300 }),
    });
    let pending = 0;
    if (listR.ok) {
      const objs = await listR.json();
      pending = objs.filter(function (o) { return o.name && o.name.endsWith(".json"); }).length;
    }
    const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
    const bjStartUtc = new Date(
      Date.UTC(bjNow.getUTCFullYear(), bjNow.getUTCMonth(), bjNow.getUTCDate()) - 8 * 3600 * 1000
    ).toISOString();
    const cntR = await fetch(
      base0 +
        "/rest/v1/reader_inbox?select=id&source_message_id=like." +
        encodeURIComponent("collab:*") +
        "&created_at=gte." +
        encodeURIComponent(bjStartUtc) +
        "&limit=100",
      { headers: sbHeaders(env) }
    );
    let doneToday = 0;
    if (cntR.ok) doneToday = (await cntR.json()).length;
    if (pending + doneToday >= 30) {
      return jsonError("今日协作提交已达上限（30 篇/天），请明天再交", 429);
    }
  } catch (e) {
    // 计数失败不拦提交（可用性优先），由 muse19 侧事后核对
  }

  const id = makeId();
  const manifest = {
    id: id,
    file_name: fileName,
    uploader: uploader.slice(0, 40),
    kind: kind,
    mode: kind === "document" ? mode : kind,
    size: bytes.length,
    submitted_at: new Date().toISOString(),
  };
  if (kind === "audio" && scriptText) manifest.script_text = scriptText;

  const base = sbBase(env);
  const up1 = await fetch(base + "/storage/v1/object/" + BUCKET + "/" + id + ".bin", {
    method: "POST",
    headers: sbHeaders(env, { "Content-Type": "application/octet-stream", "x-upsert": "true" }),
    body: bytes,
  });
  if (!up1.ok) return jsonError("暂存文件失败（" + up1.status + "）", 502);
  const up2 = await fetch(base + "/storage/v1/object/" + BUCKET + "/" + id + ".json", {
    method: "POST",
    headers: sbHeaders(env, { "Content-Type": "application/json", "x-upsert": "true" }),
    body: JSON.stringify(manifest),
  });
  if (!up2.ok) return jsonError("暂存清单失败（" + up2.status + "）", 502);

  return new Response(
    JSON.stringify({
      ok: true,
      id: id,
      message:
        kind === "audio"
          ? "已收件。muse19 会取件后把这份 MP3 直接上架网站「飞书待听」区（不重新合成）。"
          : "已收件。muse19 会取件处理：文档走技能提炼、朗读稿直接合成，MP3 生成后出现在网站「飞书待听」区。",
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
