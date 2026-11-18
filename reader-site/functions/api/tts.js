// POST /api/tts  —— Fish 语音合成（需口令）
// 前端传 { text, voice: <音色 key 名>, speed }，函数映射到真实 reference_id 后直连 Fish API，
// 成功时把 audio/mpeg 二进制原样回给浏览器。密钥只从 env 读。

import { checkGate, jsonError } from "../_lib/gate.js";

// 音色白名单：key 名 -> reference_id（写死在服务端，前端无法指定任意 id）
const VOICES = {
  "wenrou-zhiyu": "4fe160663f2d436c9b68243fe71bd4c5",    // 温柔治愈女声（女，舒缓；Lee 试听 1 号、睡前同款）
  "zhaoyang": "3f43595927244394858adeefd39293d1",        // 赵阳（女，讲座学术）
  "qijingchun": "0ab6ea77e6684c76b57bada57c414698",      // 齐静春（男，讲座学术）
  "yangshi-peiyin": "59cb5986671546eaa6ca8ae6f29f6d22",  // 央视配音（男，纪录片/新闻）
  "changfa-nv": "6a866490b90942e89dcaffaec5fe28b8",      // 长发新闻女（女，评论员）
  "shuaishuai": "808a0775aa204dde81943d1ba099c327",      // 帅帅的我2（男，评论员）
  "yangshi-boyin": "188fedbaa43e40508a8fefdaddac66c6",   // 央视播音腔1（女，标准播音）
  "xinwen-nan": "2926cb350f1a426d800bf8c360c3cb94",      // 新闻男（男，新闻播报；Lee 2026-11-07 试听选中）
  "cctv13-nv": "e3dba7c2cae54176a2068f66f8768fee",       // CCTV13播报女（女，新闻播报；Lee 2026-11-07 试听选中）
  "yulin-zhuanjia": "93e07cda177046a89b5a3344202643eb",  // 于琳-专家（女，温柔、信息丰富、语速有节制；知识类/健康类书、听研报；Lee 2026-11-09 定为默认5音色）
  "qi-laoshi": "7bbcf02c0398403fa3048aa9917c7a5f",       // 祁老师（男；Lee 2026-11-09 定为默认6音色，配 Groq 提取要点）
};

const MAX_TEXT_LEN = 800;

export async function onRequestPost(context) {
  const { request, env } = context;

  const denied = await checkGate(request, env);
  if (denied) return denied;

  if (!env.FISH_API_KEY) return jsonError("Fish 未配置（站长未设置 FISH_API_KEY）", 503);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError("请求体不是合法 JSON", 400);
  }

  const text = (body.text || "").trim();
  if (!text) return jsonError("text 为空", 400);
  if (text.length > MAX_TEXT_LEN) return jsonError("单句超过 " + MAX_TEXT_LEN + " 字上限", 400);

  const referenceId = VOICES[body.voice];
  if (!referenceId) return jsonError("未知音色：" + (body.voice || ""), 400);

  let speed = Number(body.speed);
  if (!isFinite(speed) || speed <= 0) speed = 1;
  speed = Math.min(2, Math.max(0.5, speed));

  let resp;
  try {
    resp = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.FISH_API_KEY,
        "Content-Type": "application/json",
        "model": env.FISH_MODEL || "s2.1-pro-free",
      },
      body: JSON.stringify({
        text: text,
        format: "mp3",
        reference_id: referenceId,
        prosody: { speed: speed },
      }),
    });
  } catch (e) {
    return jsonError("连接 Fish API 失败：" + e.message, 502);
  }

  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 200); } catch (e) { /* 忽略 */ }
    return jsonError("Fish API 返回 " + resp.status + (detail ? "：" + detail : ""), 502);
  }

  return new Response(resp.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
