// LLM（OpenAI 兼容接口）+ 网页正文抽取
// 省 token：正文截断 12000 字符；研读结果走 muse19_url_cache，命中零调用

export function llmConfigured(): boolean {
return!!(
Deno.env.get("MUSE19_LLM_BASE_URL") &&
Deno.env.get("MUSE19_LLM_API_KEY") &&
Deno.env.get("MUSE19_LLM_MODEL")
);
}

/** OpenAI 兼容 /chat/completions 调用 */
export async function llmChat(
system: string,
user: string,
temperature = 0.3,
): Promise<string> {
const base = (Deno.env.get("MUSE19_LLM_BASE_URL")?? "").replace(/\/+$/, "");
const key = Deno.env.get("MUSE19_LLM_API_KEY")?? "";
const model = Deno.env.get("MUSE19_LLM_MODEL")?? "";
if (!base ||!key ||!model) {
throw new Error(
"LLM 未配置（需要 MUSE19_LLM_BASE_URL / MUSE19_LLM_API_KEY / MUSE19_LLM_MODEL）",
);
}
const res = await fetch(`${base}/chat/completions`, {
method: "POST",
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${key}`,
},
body: JSON.stringify({
model,
messages: [
{ role: "system", content: system},
{ role: "user", content: user},
],
temperature,
}),
signal: AbortSignal.timeout(90000),
});
if (!res.ok) {
throw new Error(`LLM 请求失败 HTTP ${res.status}`);
}
const data = await res.json();
const content = data?.choices?.[0]?.message?.content;
if (!content) throw new Error("LLM 返回为空");
return String(content).trim();
}

/** 抓页面并抽正文：去 script/style/nav/footer/header/aside，截断到 maxChars */
export async function fetchPageText(
url: string,
maxChars = 12000,
): Promise<{ title: string; text: string}> {
const res = await fetch(url, {
headers: {
"User-Agent":
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
Accept:
"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
},
signal: AbortSignal.timeout(25000),
redirect: "follow",
});
if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
const ct = res.headers.get("content-type")?? "";
if (!/text\/html|application\/xhtml/i.test(ct) &&!ct.includes("text")) {
throw new Error(`不支持的内容类型：${ct || "未知"}`);
}
const html = await res.text();
const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?? "")
.replace(/\s+/g, " ")
.trim()
.slice(0, 200);
const body = html
.replace(/<script[\s\S]*?<\/script>/gi, " ")
.replace(/<style[\s\S]*?<\/style>/gi, " ")
.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
.replace(/<(nav|footer|header|aside|form)[\s>][\s\S]*?<\/\1>/gi, " ")
.replace(/<[^>]+>/g, " ");
const text = body
.replace(/&nbsp;/g, " ")
.replace(/&amp;/g, "&")
.replace(/&lt;/g, "<")
.replace(/&gt;/g, ">")
.replace(/&quot;/g, '"')
.replace(/&#39;/g, "'")
.replace(/\s+/g, " ")
.trim()
.slice(0, maxChars);
return { title, text};
}

const RESEARCH_SYSTEM = `你是资深投研分析师。用简体中文回答，严格按以下四段输出，每段不超过150字：
……
……
……
……
最后另起一行输出：相关公司：<文中提及的核心公司名，无则写"无">。
不要输出其他内容。`;

/** 研读：正文 → 四段式研究建议 */
export async function researchAdvice(
title: string,
text: string,
): Promise<string> {
return await llmChat(
RESEARCH_SYSTEM,
`标题：${title || "（无标题）"}\n正文：${text}`,
);
}

