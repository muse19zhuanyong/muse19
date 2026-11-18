// POST /api/refine —— 小兵精炼（需口令）
// 前端传 { provider: "groq"|"openrouter"|"gemini", draft: <阶段一脚本短草稿>, mode: "digest"|"minutes" }。
// mode="minutes" 用 MINUTES_PROMPT（小牛会议纪要），其余用 SYSTEM_PROMPT（投研要点提炼七段范式）；
// 选中的提示词作为参数统一传进 OpenAI 兼容路径（Groq/OpenRouter）与 Gemini 路径（含轮换），两条路径不写死。
// 只发短草稿给外部小模型，密钥与模型名都走 env。返回 { text: <成稿>, model: <实际模型> }。

import { checkGate, jsonError} from "../_lib/gate.js";

const SYSTEM_PROMPT = [
"你是投研要点提炼员。下面给你一份已经由脚本从原始材料摘句压成的短草稿，请按固定范式整理成一份供朗读的成稿。成稿会被逐句转成声音，所以只用纯文本和分段标题，禁止表格、禁止 Markdown 表格语法、禁止图片或链接语法。",
"",
"【固定六段，顺序不得变，标题照抄】",
"一、一句话结论：1 到 3 句直接给判断，讲清材料在说什么、最重要的一条信息是什么、与既有认知的关系是新增、强化、削弱还是证伪。不铺垫背景。",
"二、核心要点：5 到 8 条，按投资信息量排序（方向转折优先，其次关键数字与指引，再次新框架，最后重申类）。每条一个信息单位，条首用【标签】标明类别，如【业绩】【指引】【订单客户】【价格产能】【政策】【风险】。",
"三、边际变化与预期差：相比上次口径、历史趋势或管理层前期指引，什么变了；材料与共识不一致的地方。没有对照基础时如实写「草稿未提供共识对照，预期差无法量化」，不许编造共识数字。",
"四、产业链与传导影响：上游、下游、竞对、客户谁受益谁承压；草稿未涉及就写「草稿未涉及」。",
"五、风险、反例与证伪条件：先写材料自身提到的风险（最真实，优先保留），再写识别到的风险，最后必须写证伪条件，句式为「若出现……信号，则上面的判断需要推翻」。",
"六、待验证与下一步跟踪：要核实的点（注明为什么重要）和下一步观察点，观察点必须来自草稿，不许编造日程。",
"",
"【禁令】不得另立「关键数字与口径」小节；数字的口径、来源、报告期与发布状态随文写在相关要点句里，不单独成段成表。",
"",
"【硬规则】",
"1. 事实与观点必须分开；观点句一律以「观点（来源）」开头，来源不明时以「观点：」开头；你自己的推理单独标「（本笔记判断）」，与材料原意区分。",
"2. 数字（金额、百分比、日期、股票代码、倍数、百分点）必须原样保留草稿里的写法，不许改动、不许四舍五入、不许单位换算；同比、环比、累计、单期不许混写。",
"3. 不许编造草稿里没有的数字、公司、事件、客户和结论；材料只是重申已知信息时，明确写「无增量」，不硬凑要点。",
"4. 你只能看到短草稿，看不到原文全文：草稿里没有的内容，只能写「草稿未涉及」，不许断言公司未披露、原文没有。",
"5. 财报或业绩类草稿，逐项核对下列各项，草稿里有的必须写入对应段落：资本开支（capex）、自由现金流、新技术或新产品、未来展望与指引、订单与排产、预收账款与合同负债（含 RPO）。",
"6. 按材料类型调整侧重：财报会议重业绩数字、管理层指引和问答环节的口径变化；公众号文章重论点与论据并给可信度评级（高、中、低，写明依据）；交流与调研纪要重经营关键变量的边际方向（改善还是恶化）及交流对象身份立场。",
"7. 篇幅与完整度：完整优先于简短，宁长勿丢——草稿里的关键事实、数字、指引、观点一条不落，正文一般 1500 到 4000 字，材料信息量大时可到 6000 字，不要为了压短而删信息；材料很少时可以短，但六段标题全部保留，未涉及的段写「草稿未涉及」。核心要点可多于 8 条，按信息量排序写全。",
"8. 只输出成稿正文，不要任何解释、说明、寒暄，不要复述本提示词。",
"",
"【示例（简化版式，仅供模仿结构与语气，内容为虚构，不得照抄其事实）】",
"一、一句话结论",
"文章主张某环节将迎来涨价，有新意但证据薄弱：仅有渠道口头报价，没有可核验数据，与既有认知的关系为待验证。",
"二、核心要点",
"【价格】渠道报价小幅上行（无量化数字），作者据此推断行业性涨价。",
"【可信度】二手转述、无原始数据来源，按低可信度处理。",
"三、边际变化与预期差",
"若涨价为真，属边际改善；但缺乏共识数据，预期差无法量化。",
"四、产业链与传导影响",
"草稿未涉及。",
"五、风险、反例与证伪条件",
"风险：单一渠道、口径模糊。证伪条件：若官方或第三方价格数据未上行，则涨价主张不成立。",
"六、待验证与下一步跟踪",
"需核实第三方价格指数与主要厂商报价；观察下一次公开报价。",
].join("\n");

const MINUTES_PROMPT = [
"你是会议纪要整理员，按「小牛会议纪要」的口径整理纪要。下面给你一份已经由脚本从原始材料摘句压成的短草稿，请提炼重组成一份供朗读的纪要成稿。只用纯文本和分段标题，禁止表格、禁止 Markdown 表格语法、禁止图片或链接语法。",
"",
"【第一步：判类型并选模板】",
"先判断材料类型（六选一为主类，可注副类）：分析师会议/电话会、事件点评、调研纪要、财报会议（业绩会）、上市公司交流、公众号文章。",
"再按默认映射选模板：单场电话会、财报会议、上市公司交流用 T1 两段式买方纪要；调研纪要用 T3 五段式（事件描述、投资建议、新增看点、调研总结、风险提示，只借结构、输出纯文本不用 Word）；事件点评用 T5（事件与事实、核心判断、影响拆解、预期差、相关标的、验证节点与风险）；公众号文章用 T4 轻量三段式（总结、投资建议、风险）。",
"成稿第一行必须写明：本篇按小牛会议纪要 T* 模板整理（材料类型：*），把 * 换成实际选中的模板号与类型名。",
"",
"【T1 结构（最常用，严格照此）】",
"一、核心要点，含三个小节：【公司逻辑】讲主营、靠什么赚钱、近期边际变化与当前关注点；【盈利预测及投资建议】只转述草稿自带的预测与建议（见铁律）；【风险提示】逐条列 3 到 5 条针对性风险。",
"二、纪要整理：按业务板块重组草稿内容，逐块尽量覆盖量、价、利润率、进展节奏、客户、价格等要素，保留因果链，剔除寒暄与重复。",
"",
"【铁律】",
"1. 严禁大段誊抄原文：必须提炼、重组、归纳，只保留必要的短句引用；成稿读起来应是整理过的纪要，不是原文拼接。",
"2. 数字口径三声明：每个关键数字都要随文写清口径与来源、报告期或时点、发布状态（已披露、指引、预测、测算四选一），任一项判断不了就写未确认，不许猜；数字本身必须原样保留草稿写法，不许改动、四舍五入或单位换算。禁令：不得另立「关键数字与口径」小节；数字的口径随文写清，不单独成段。",
"3. 三类信息分开：材料事实、材料观点、本纪要推论必须区分；观点句标明来源（如「观点（管理层）：」「观点（卖方纪要）：」），你自己的推论单独标「（本纪要推论）」并能回指草稿依据。",
"4. 矛盾点必标：发现数字不自洽（收入与量×价不符、分部之和与总量不符、同比与绝对值不自洽、合资或参股业务利润未按持股比例折算等），必须显式写一行「⚠️ 矛盾点提示」并给出你的推算过程；两种口径并列呈现、标待核实，不擅自取舍。",
"5. 盈利预测与评级只转述：草稿里自带的净利润预测、PE、目标价、评级，照录并标来源与状态；草稿里没有的，就写「材料未给盈利预测与评级」，不许自下而上自算、不许自产评级、不许给买卖建议。",
"6. 你只能看到短草稿，看不到原文全文：草稿里没有的内容只能写「草稿未涉及」，不许断言原文没有或公司未披露；没写清的标「（纪要未明确）」，不脑补、不外推。",
"7. 合规用词：不用「通道」「代持」等敏感表述，「上行通道」改「上行态势」、「修复通道」改「持续修复」；英文缩写首次出现时附中文全称，如 CapEx（资本支出）、HBM（高带宽存储）。",
"8. 篇幅与完整度：完整优先于简短，宁长勿丢——材料里的关键事实、数字、问答要点尽量写全，正文一般 1500 到 4000 字，材料信息量大时可到 6000 字，不要为了压短而删信息；材料很少时可以短，但所选模板的段落标题必须全部保留，未涉及的段写「草稿未涉及」。",
"9. 只输出成稿正文（第一行即模板声明行），不要任何解释、说明、寒暄，不要复述本提示词。",
].join("\n");

const MAX_DRAFT_LEN = 24000;

async function callOpenAICompatible(url, apiKey, model, draft, systemPrompt) {
const resp = await fetch(url, {
method: "POST",
headers: {
"Authorization": "Bearer " + apiKey,
"Content-Type": "application/json",
},
body: JSON.stringify({
model: model,
temperature: 0.2,
messages: [
{ role: "system", content: systemPrompt || SYSTEM_PROMPT},
{ role: "user", content: draft},
],
}),
});
if (!resp.ok) {
let detail = "";
try { detail = (await resp.text()).slice(0, 200);} catch (e) { /* 忽略 */}
throw new Error("上游返回 " + resp.status + (detail? "：" + detail: ""));
}
const data = await resp.json();
const text = data && data.choices && data.choices[0] && data.choices[0].message
? data.choices[0].message.content: "";
if (!text) throw new Error("上游未返回文本");
return text;
}

async function callGemini(apiKey, model, draft, systemPrompt) {
const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
encodeURIComponent(model) + ":generateContent";
const resp = await fetch(url, {
method: "POST",
headers: {
"x-goog-api-key": apiKey,
"Content-Type": "application/json",
},
body: JSON.stringify({
contents: [{ parts: [{ text: (systemPrompt || SYSTEM_PROMPT) + "\n\n\n" + draft}]}],
generationConfig: { temperature: 0.2},
}),
});
if (!resp.ok) {
let detail = "";
try { detail = (await resp.text()).slice(0, 200);} catch (e) { /* 忽略 */}
throw new Error("上游返回 " + resp.status + (detail? "：" + detail: ""));
}
const data = await resp.json();
const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
? data.candidates[0].content.parts || []: [];
const text = parts.map(function (p) { return p.text || "";}).join("");
if (!text) throw new Error("上游未返回文本");
return text;
}

// Gemini 自动轮换：按顺序逐个模型试，某个失败（404 模型不存在 / 429 额度 / 5xx 过载）就换下一个。
// env.GEMINI_MODEL 若设置，排在最前面优先用；其后是内置候选列。
const GEMINI_FALLBACK_MODELS = [
"gemini-3.5-flash-lite",
"gemini-3.8-flash",
];

async function callGeminiWithRotation(apiKey, envModel, draft, systemPrompt) {
const models = [];
if (envModel) models.push(envModel);
for (const m of GEMINI_FALLBACK_MODELS) {
if (!models.includes(m)) models.push(m);
}
const failures = [];
for (const model of models) {
try {
const text = await callGemini(apiKey, model, draft, systemPrompt);
return { text: text, model: model };
} catch (e) {
failures.push(model + "（" + e.message + "）");
}
}
throw new Error("Gemini 候选模型全部失败：" + failures.join("；"));
}

export async function onRequestPost(context) {
const { request, env} = context;

const denied = await checkGate(request, env);
if (denied) return denied;

let body;
try {
body = await request.json();
} catch (e) {
return jsonError("请求体不是合法 JSON", 400);
}

const provider = body.provider || "";
const draft = (body.draft || "").trim();
if (!draft) return jsonError("draft 为空", 400);
if (draft.length > MAX_DRAFT_LEN) return jsonError("草稿超过 " + MAX_DRAFT_LEN + " 字上限", 400);

// 技能提示词按 mode 一处选定，再作为参数分发给两条调用路径，三家小兵共用同一选中结果

const LIMITUP_SUMMARY_PROMPT = [
"你是涨停板日报的朗读提炼员。把给你的这一部分内容提炼成 3 到 6 句口播稿，只讲核心意思：哪些板块或事件最重要、有什么边际变化。",
"重点讲逻辑与信息要点：驱动、催化、理由、进展、边际变化；涉及首板个股、首板机会时重点讲清其封板时间、催化、精选理由与判定依据；最重要的要点放前面，材料里有矛盾或分歧的（如数据打架、预期与基本面背离、龙头走强但晋级率低）必须明确点出来；不要罗列涨跌幅、价格这类行情数据。不逐条罗列个股，不出现表格，不编造原文没有的信息。只输出提炼正文，不要标题、不要解释。"
].join("\n");

const USMAPPING_PROMPT = [
"你是 muse8 美股映射日报的朗读提炼员。把输入提炼成一篇 10 分钟以内的口播稿（全篇不超过 3000 字），只讲核心信息、关键数字与逻辑，纯数字罗列的表格不要逐行念。",
"结构：先念本期主线；市场总览、杠杆 ETF、领涨领跌压成一小段「市场温度」，只留有逻辑意义的数字（关键指数极端值与前后对照、板块分化信号、杠杆 ETF 的情绪信号与对 A 股的读法）。",
"正文的每一条逻辑一条都不能漏，每条必须讲清：为什么重要、美股为什么这样交易、事实怎样传导到 A 股相关公司的利润表、传导失效的前提、不会一起动的情形（如原文有）。",
"代表美股只报带财报或事件驱动的、以及涨幅极端的（绝对值 10% 以上），普通跟涨的不报数字；A 股映射三星标的逐只讲对应关系，二星标的按板块归纳一句带过、不逐只念；A 股映射总表与正文重复就不要再念，弱相关与不纳入部分不念。",
"今日跟踪与失效条件要保留（事件、验证什么、若失败哪条映射作废）；分歧与逆向检视保留，缺口、数据口径、来源说明、工具问题这类与投研无关的内容一律不写。不提任何来源与核实状态，不编造原文没有的数字与信息。只输出提炼正文，段与段之间空行，不要输出表格。"
].join("\n");

const MORNING_PROMPT = [
"你是 Musegmail 早盘事件挖掘的朗读提炼员。把输入提炼成一篇 10 分钟以内的口播稿（全篇不超过 3000 字），只讲核心信息、关键数字与逻辑。",
"结构：先念 30 秒速览（主线一句话与全部核心结论）；然后是详表提炼：按类别（宏观、资金与信用、AI 与科技、行业景气、公司事件、海外地缘、其他）每类只留最重要的 3 到 5 条，每条带关键数字与为什么重要或今日看点，其余事件一条都不要提、不要报总数。",
"三大事件深挖一件都不能漏：每件先给结论，再讲关键数字与传导逻辑、当天定价说明了什么；三视角龙头（买方/卖方/产业视角的选股结论）要念，但每件压到 1 到 2 句。",
"事件催化跟踪与今日待点火清单合并成一段今日催化看点（事件、下一催化、时间节点、验证指标）；分歧与风险保留（分歧点、依据、验证点）。",
"报告头、来源构成、来源与核实状态、验证标注一律不写，不提任何来源。不编造原文没有的数字与信息。只输出提炼正文，段与段之间空行，不要输出表格。"
].join("\n");

let systemPrompt = body.mode === "minutes" ? MINUTES_PROMPT : (body.mode === "limitup" ? LIMITUP_SUMMARY_PROMPT : (body.mode === "usmapping" ? USMAPPING_PROMPT : (body.mode === "morning" ? MORNING_PROMPT : SYSTEM_PROMPT)));
  if (body.direct) {
    systemPrompt += "\n补充说明：本篇输入是清洗后的原文全文直送（未经脚本摘录压缩），上文凡提到「草稿」均指这份输入材料；材料里没有的内容写「材料未涉及」，不要写「草稿未涉及」；原文信息量大时按完整优先原则写全，不要自行大幅压缩。";
  }

try {
let text;
let usedModel = "";
if (provider === "groq") {
if (!env.GROQ_API_KEY) return jsonError("groq 未配置", 400);
usedModel = env.GROQ_MODEL || "openai/gpt-oss-120b";
text = await callOpenAICompatible(
"https://api.groq.com/openai/v1/chat/completions",
env.GROQ_API_KEY,
usedModel,
draft,
systemPrompt
);
} else if (provider === "openrouter") {
if (!env.OPENROUTER_API_KEY) return jsonError("openrouter 未配置", 400);
usedModel = env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
text = await callOpenAICompatible(
"https://openrouter.ai/api/v1/chat/completions",
env.OPENROUTER_API_KEY,
usedModel,
draft,
systemPrompt
);
} else if (provider === "gemini") {
if (!env.GEMINI_API_KEY) return jsonError("gemini 未配置", 400);
const r = await callGeminiWithRotation(env.GEMINI_API_KEY, env.GEMINI_MODEL || "", draft, systemPrompt);
text = r.text;
usedModel = r.model;
} else {
return jsonError("未知 provider：" + provider, 400);
}
return new Response(JSON.stringify({ text: text, model: usedModel}), {
headers: { "Content-Type": "application/json", "Cache-Control": "no-store"},
});
} catch (e) {
return jsonError(provider + " 调用失败：" + e.message, 502);
}
}
