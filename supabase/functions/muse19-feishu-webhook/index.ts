/**
* 飞书机器人 webhook — Supabase Edge Function (Deno / TypeScript)
*
* 职责：
* 1. 处理飞书 URL 验证（url_verification → 原样返回 challenge）
* 2. 验签：SHA256(timestamp + nonce + encrypt_key + raw_body)
* 3. 处理 im.message.receive_v1 文本消息，执行指令，回消息到飞书
*
* 指令（省 token 路由优先级：精确匹配 → URL 检测 → 记/定时 → LLM 意图分类 → 聊天收件箱）：
* 帮助 / 研读 / 记 / 定时；画像 / 研报 / 行情 v1 暂不支持
* 研读 <URL>（或直接发链接）：抓正文 → LLM 四段式研究建议（muse19_url_cache 命中零调用）
* 记 <内容> [时间]：写 muse19_memo；时间支持 今天/明天/后天 H点、每天H点、M月D日 H点
* 定时 <cron五段> <描述>：写 muse19_scheduled_task，推送到本会话
*
* 部署：见 DEPLOY.md
* 必需 secrets：MUSE19_FEISHU_APP_ID / MUSE19_FEISHU_APP_SECRET / MUSE19_FEISHU_ENCRYPT_KEY /
* MUSE19_FEISHU_VERIFICATION_TOKEN / MUSE19_SUPABASE_URL / MUSE19_SUPABASE_SERVICE_ROLE_KEY
* v1 说明：不含 test / push / 小兵网关（原指南里那几个是公开无鉴权的，v1 不部署）
* 可选 secrets：MUSE19_LLM_BASE_URL / MUSE19_LLM_API_KEY / MUSE19_LLM_MODEL / MUSE19_LLM_FALLBACK_ENABLED
*/

import { timingSafeEqual, cut, sha256hex, cleanUrl} from "../_shared/utils.ts";
import {
verifySignature,
decryptBody,
replyMessage,
extractText,
extractPostText,
extractInteractiveText,
isBotMentioned,
} from "../_shared/feishu.ts";
import { getSb} from "../_shared/supabase.ts";
import {
llmConfigured,
llmChat,
fetchPageText,
researchAdvice,
} from "../_shared/llm.ts";
import {
shanghaiParts,
splitContentTime,
parseRemindTime,
} from "../_shared/time.ts";

const MUSE19_FEISHU_ENCRYPT_KEY = Deno.env.get("MUSE19_FEISHU_ENCRYPT_KEY")?? "";
const MUSE19_FEISHU_VERIFICATION_TOKEN =
Deno.env.get("MUSE19_FEISHU_VERIFICATION_TOKEN")?? "";

const HELP = `可用指令：
研读 <URL> —— 抓取链接并输出研究建议（直接发链接也行；没配 LLM 时先记进收件箱）
记 <内容> [时间] —— 记事；时间如 明天9点、每天8点、12月25日9点
定时 <cron五段> <描述> —— 定期任务，如：定时 0 8 * * * 每日早报
帮助 —— 显示本说明
直接聊天 —— 非指令消息会进收件箱，由 Muse 本人稍后回复你
注意：群聊里指令和聊天都要 @ 我，单聊不用
v1 暂不支持：画像 / 研报 / 行情，那几张投研表不在本项目里`;

interface Ctx {
chatType: string;
chatId: string;
messageId: string;
senderId: string;
senderName: string;
}

// ---------------------------------------------------------------- 研读 URL
async function handleResearch(rawUrl: string, ctx: Ctx): Promise<string> {
const url = cleanUrl(rawUrl);
if (!/^https?:\/\//i.test(url)) return "链接格式不对，请发完整的 http(s) 地址。";
const sb = getSb();

// 1) 缓存：命中则零 token
const hash = await sha256hex(url);
const { data: cached} = await sb
.from("muse19_url_cache")
.select("advice")
.eq("url_hash", hash)
.maybeSingle();
if (cached?.advice) return `${cached.advice}\n（来自缓存）`;

// 2) 抓正文
let page: { title: string; text: string};
try {
page = await fetchPageText(url, 12000);
} catch (e) {
return `抓取失败：${e instanceof Error? e.message: "未知错误"}，换个链接试试。`;
}
if (!page.text || page.text.length < 100) {
return "页面正文太少，读不出有效内容。";
}

// 3) LLM 研读（未配置则转收件箱，由 Muse 本人定时处理）
if (!llmConfigured()) {
try {
const sb2 = getSb();
await sb2.from("muse19_chat_inbox").insert({
chat_id: ctx.chatId,
chat_type: ctx.chatType,
message_id: ctx.messageId,
sender_id: ctx.senderId || "unknown",
sender_name: ctx.senderName || null,
content: "[RESEARCH] " + url,
replied: false,
});
} catch (e) {
console.error("[feishu] research inbox insert failed:", e);
}
if (NO_PLACEHOLDER_REPLY_CHATS.has(ctx.chatId)) return "";
return "收到，研读请求已记下，稍后回你。";
}
let advice: string;
try {
advice = await researchAdvice(page.title, page.text);
} catch (e) {
console.error("[feishu] research LLM failed:", e);
return "研究建议生成失败，稍后再试。";
}

// 4) 全文即建议（v1 不查公司画像表，那几张表不在本项目里）
const full = advice;

// 5) 写缓存（失败不影响返回）
await sb.from("muse19_url_cache").upsert({ url_hash: hash, url, advice: full});
return full;
}

// ---------------------------------------------------------------- 记事本
async function handleMemo(
arg: string,
chatId: string,
chatType: string,
): Promise<string> {
if (!arg) {
return "用法：记 <内容> [时间]，如：记 明天9点开站会 / 记 每天8点吃药";
}
const { content, timeExpr} = splitContentTime(arg);
const sb = getSb();
let remindAt: string | null = null;
let note = "";
if (timeExpr) {
remindAt = parseRemindTime(timeExpr);
if (!remindAt) note = "（时间没解析出来，只记录不提醒）";
}
const { error} = await sb.from("muse19_memo").insert({
content,
remind_at: remindAt,
status: "pending",
source: JSON.stringify({ chat_id: chatId, chat_type: chatType}),
});
if (error) throw error;
if (remindAt) {
const p = shanghaiParts(new Date(remindAt));
const hh = String(p.h).padStart(2, "0");
const mm = String(p.mi).padStart(2, "0");
return `记下了：${cut(content, 60)}\n⏰ 将在 ${p.mo}月${p.d}日 ${hh}:${mm} 提醒你（北京时间）。`;
}
return `记下了：${cut(content, 60)}${note}`;
}

// ---------------------------------------------------------------- 定时任务
const CRON_RE =
/^[*\d,/-]+ +[*\d,/-]+ +[*\d,/-]+ +[*\d,/-]+ +[*\d,/-]+$/;

async function handleSchedule(arg: string, chatId: string): Promise<string> {
const m = arg.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\s\S]+)$/);
if (!m ||!CRON_RE.test(m.slice(1, 6).join(" "))) {
return "用法：定时 <cron五段> <描述>，如：定时 0 8 * * * 每日早报";
}
const cron = m.slice(1, 6).join(" ");
const desc = m[6].trim();
if (!desc) return "描述不能为空，如：定时 0 8 * * * 每日早报";

const sb = getSb();
let task_type = "custom";
let payload: Record<string, unknown> = { text: desc};
let name = desc.slice(0, 40);
const urlM = desc.match(/https?:\/\/[^\s<>"']+/);
if (urlM) {
// 描述里带链接 → api_pull：定时拉接口
task_type = "api_pull";
const api_url = cleanUrl(urlM[0]);
name = (desc.replace(urlM[0], "").trim() || "接口推送").slice(0, 40);
payload = { api_url, template: "\n{data}"};
}
const { error} = await sb.from("muse19_scheduled_task").insert({
name,
cron,
task_type,
payload,
target_chat: chatId,
enabled: true,
});
if (error) throw error;
return `已创建定时任务"${name}"\n⏱ ${cron}（北京时间）\n推送到本会话，scheduler 每分钟检查一次。`;
}

// 不发占位回复的群（v1 为空；以后有需要再把 chat_id 加进来）
const NO_PLACEHOLDER_REPLY_CHATS = new Set<string>([]);

// ---------------------------------------------------------------- 聊天收件箱：非指令消息由 Muse 本人查收回复
// 表 muse19_chat_inbox 由运维 SQL 创建；插入失败不影响回复
async function handleChatMessage(text: string, ctx: Ctx): Promise<string> {
try {
const sb = getSb();
await sb.from("muse19_chat_inbox").insert({
chat_id: ctx.chatId,
chat_type: ctx.chatType,
message_id: ctx.messageId,
sender_id: ctx.senderId || "unknown",
sender_name: ctx.senderName || null,
content: text.slice(0, 4000),
replied: false,
});
} catch (e) {
console.error("[feishu] inbox insert failed:", e);
}
if (NO_PLACEHOLDER_REPLY_CHATS.has(ctx.chatId)) return "";
return "收到，稍后回你。";
}

// ---------------------------------------------------------------- LLM 兜底（极简：只做意图分类+参数抽取）
async function llmFallback(text: string, ctx: Ctx): Promise<string | null> {
const enabled = (Deno.env.get("MUSE19_LLM_FALLBACK_ENABLED")?? "true").toLowerCase();
if (enabled!== "true" ||!llmConfigured()) return null;
let out: string;
try {
out = await llmChat(
'你是意图分类器。只输出 JSON，不要输出其他内容，格式：{"intent":"memo|schedule|help|unknown","arg":"参数原文"}\n' +
"memo=记事 schedule=定时任务 help=帮助",
text.slice(0, 500),
0.1,
);
} catch (e) {
console.error("[feishu] fallback LLM failed:", e);
return null;
}
const jm = out.match(/\{[\s\S]*\}/);
if (!jm) return null;
let o: { intent?: string; arg?: string};
try {
o = JSON.parse(jm[0]);
} catch {
return null;
}
const arg = (o.arg?? "").trim();
try {
switch (o.intent) {
case "memo":
return arg? await handleMemo(arg, ctx.chatId, ctx.chatType): null;
case "schedule":
return arg? await handleSchedule(arg, ctx.chatId): null;
case "help":
return HELP;
default:
return null;
}
} catch (e) {
console.error("[feishu] fallback handler failed:", e);
return "执行出错了，稍后再试。";
}
}

// ---------------------------------------------------------------- 指令路由
// 优先级：精确指令 → URL 检测 → 记/定时 → LLM 意图分类 → 聊天收件箱（Muse 本人回复）
async function routeCommand(text: string, ctx: Ctx): Promise<string | null> {
// 1) 精确指令：帮助
let m = text.match(/^(帮助)\s*([\s\S]*)$/);
if (m) return HELP;

// 2) URL 检测：研读 <URL> 或直接发链接
m = text.match(/^研读\s+(https?:\/\/\S+)\s*$/);
if (m) return await handleResearch(m[1], ctx);
const urlM = text.match(/https?:\/\/[^\s<>"']+/);
if (urlM) return await handleResearch(urlM[0], ctx);

// 3) 记 / 定时
m = text.match(/^记\s+([\s\S]+)$/);
if (m) return await handleMemo(m[1].trim(), ctx.chatId, ctx.chatType);
if (/^记\s*$/.test(text)) return await handleMemo("", ctx.chatId, ctx.chatType);
m = text.match(/^定时\s+([\s\S]+)$/);
if (m) return await handleSchedule(m[1].trim(), ctx.chatId);

// 4) LLM 意图兜底（能识别意图就走指令）
// 5) 都不匹配 → 聊天收件箱，由 Muse 本人查收回复
const fb = await llmFallback(text, ctx);
if (fb) return fb;
return await handleChatMessage(text, ctx);
}

// ---------------------------------------------------------------- 文件消息：存 file_key 到收件箱，Muse 后续下载处理
async function handleFileMessage(msg: any, msgType: string, ctx: Ctx): Promise<void> {
let fileInfo: Record<string, unknown> = { msg_type: msgType};
try {
const c = JSON.parse(msg.content?? "{}");
if (msgType === "file" || msgType === "audio" || msgType === "video") {
fileInfo.file_key = c.file_key;
fileInfo.file_name = c.file_name;
if (c.duration) fileInfo.duration = c.duration;
} else if (msgType === "image") {
fileInfo.image_key = c.image_key;
}
} catch {
fileInfo.parse_error = true;
}

try {
const sb = getSb();
await sb.from("muse19_chat_inbox").insert({
chat_id: ctx.chatId,
chat_type: ctx.chatType,
message_id: ctx.messageId,
sender_id: ctx.senderId || "unknown",
sender_name: ctx.senderName || null,
content: "[FILE] " + JSON.stringify(fileInfo),
replied: false,
});
} catch (e) {
console.error("[feishu] file inbox insert failed:", e);
}

const fileName = (fileInfo.file_name as string) || msgType;
await replyMessage(ctx.chatType, ctx.chatId, ctx.messageId, `收到文件 ${fileName}，稍后处理。`);
}

// ---------------------------------------------------------------- 事件处理
const seenEvents = new Set<string>();

async function processMessageEvent(event: any): Promise<void> {
const header = event.header?? {};
const eventId = header.event_id as string | undefined;
if (eventId) {
if (seenEvents.has(eventId)) return;
seenEvents.add(eventId);
if (seenEvents.size > 1000) seenEvents.clear();
}

const msg = event.event?.message?? {};
const msgType = msg.message_type as string;

// 只处理真人发的消息：群里有很多机器人（如文档/文字/豆包汇总群），它们的消息不进收件箱也不回复
const senderType = event.event?.sender?.sender_type as string | undefined;
if (senderType && senderType!== "user") {
console.log(`[feishu] skip non-user message from ${senderType}`);
return;
}

// 群聊只响应 @ 机器人自己的消息（@ 别人不理）；单聊全部处理
const chatType = msg.chat_type as string;
if (chatType!== "p2p") {
const mentions = (msg as any).mentions as any[] | undefined;
if (!(await isBotMentioned(mentions))) {
return;
}
}

const sender = event.event?.sender ?? {};
const senderIdObj = sender.sender_id ?? {};
const senderId = (senderIdObj.user_id ?? senderIdObj.open_id ?? senderIdObj.union_id ?? "") as string;
const ctx: Ctx = {
chatType: msg.chat_type as string,
chatId: msg.chat_id as string,
messageId: msg.message_id as string,
senderId,
senderName: "",
};

// 文件/图片/音频/视频消息：存 file_key 到收件箱，由 Muse 后续下载处理
if (["file", "image", "audio", "video"].includes(msgType)) {
console.log(`[feishu] file message ${msgType} from ${ctx.chatType}/${ctx.chatId}`);
await handleFileMessage(msg, msgType, ctx);
return;
}

if (msgType!== "text" && msgType!== "post" && msgType!== "interactive") {
  console.log(`[feishu] skip unhandled msgType=${msgType} from ${ctx.chatType}/${ctx.chatId}`);
  return;
}

const text = msgType === "post"
  ? extractPostText(msg.content?? "")
  : msgType === "interactive"
    ? extractInteractiveText(msg.content?? "")
    : extractText(msg.content?? "");
if (!text) return;

console.log(`[feishu] cmd from ${ctx.chatType}/${ctx.chatId}: ${cut(text, 60)}`);
let reply: string;
try {
reply = (await routeCommand(text, ctx))?? "";
} catch (e) {
console.error("[feishu] command error:", e);
reply = "执行出错了，稍后再试。";
}
if (!reply) return;
await replyMessage(ctx.chatType, ctx.chatId, ctx.messageId, reply);

// 指令审计（失败不影响主流程）
try {
await getSb().from("muse19_feishu_command_log").insert({
chat_id: ctx.chatId,
command: cut(text, 200),
result: cut(reply, 500),
});
} catch (e) {
console.error("[feishu] command log failed:", e);
}
}

// ---------------------------------------------------------------- 入口
function needEnv(): string | null {
const missing = [
["MUSE19_FEISHU_APP_ID", Deno.env.get("MUSE19_FEISHU_APP_ID")],
["MUSE19_FEISHU_APP_SECRET", Deno.env.get("MUSE19_FEISHU_APP_SECRET")],
["MUSE19_FEISHU_VERIFICATION_TOKEN", MUSE19_FEISHU_VERIFICATION_TOKEN],
["MUSE19_SUPABASE_URL", Deno.env.get("MUSE19_SUPABASE_URL")],
["MUSE19_SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("MUSE19_SUPABASE_SERVICE_ROLE_KEY")],
]
.filter(([, v]) =>!v)
.map(([k]) => k);
return missing.length? missing.join(","): null;
}

Deno.serve(async (req: Request): Promise<Response> => {
if (req.method!== "POST") {
return new Response("Method Not Allowed", { status: 405});
}

const missing = needEnv();
if (missing) {
console.error(`[feishu] missing secrets: ${missing}`);
return new Response("Server misconfigured", { status: 500});
}

const rawBody = await req.text();
let body: any;
try {
body = JSON.parse(rawBody);
} catch {
return new Response("Bad Request", { status: 400});
}

// ---- 1) URL 验证
if (body.type === "url_verification") {
if (!timingSafeEqual(String(body.token?? ""), MUSE19_FEISHU_VERIFICATION_TOKEN)) {
console.warn("[feishu] url_verification token mismatch");
return new Response("Forbidden", { status: 403});
}
console.log("[feishu] url_verification ok");
return Response.json({ challenge: body.challenge});
}

// ---- 2) 加密事件体：先验签再解密
let payload = body;
if (body.encrypt) {
if (!MUSE19_FEISHU_ENCRYPT_KEY) {
console.error("[feishu] encrypted event but no MUSE19_FEISHU_ENCRYPT_KEY");
return new Response("Unauthorized", { status: 401});
}
const hasSig =!!req.headers.get("x-lark-signature");
if (
hasSig &&
!(await verifySignature(rawBody, req.headers, MUSE19_FEISHU_ENCRYPT_KEY))
) {
console.warn("[feishu] signature mismatch (encrypted)");
return new Response("Unauthorized", { status: 401});
}
try {
payload = JSON.parse(await decryptBody(body.encrypt, MUSE19_FEISHU_ENCRYPT_KEY));
} catch (e) {
console.error("[feishu] decrypt failed:", e);
return new Response("Bad Request", { status: 400});
}
if (payload.type === "url_verification") {
if (
!timingSafeEqual(String(payload.token?? ""), MUSE19_FEISHU_VERIFICATION_TOKEN)
) {
return new Response("Forbidden", { status: 403});
}
return Response.json({ challenge: payload.challenge});
}
} else if (MUSE19_FEISHU_ENCRYPT_KEY) {
// ---- 3) 明文事件 + 配置了 Encrypt Key：必须验签
if (!(await verifySignature(rawBody, req.headers, MUSE19_FEISHU_ENCRYPT_KEY))) {
console.warn("[feishu] signature mismatch");
return new Response("Unauthorized", { status: 401});
}
} else {
// ---- 4) 未配置 Encrypt Key：退化为 verification token 校验（不推荐用于生产）
if (!timingSafeEqual(String(body.token?? ""), MUSE19_FEISHU_VERIFICATION_TOKEN)) {
console.warn("[feishu] verification token mismatch");
return new Response("Forbidden", { status: 403});
}
}

// ---- 5) 只处理消息事件；先回 200，后台处理
const eventType = payload?.header?.event_type;
if (eventType!== "im.message.receive_v1") {
return new Response("OK");
}

const job = processMessageEvent(payload).catch((e) =>
console.error("[feishu] processMessageEvent failed:", e),
);
const rt = (globalThis as any).EdgeRuntime;
if (rt?.waitUntil) {
rt.waitUntil(job);
} else {
await job;
}
return new Response("OK");
});

// auto-deploy test 2026-09-30 22:31
