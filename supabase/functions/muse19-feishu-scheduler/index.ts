/**
 * 飞书定时调度器 — Supabase Edge Function (Deno / TypeScript)
 *
 * 由外部每分钟触发一次（pg_cron + pg_net，见 migrations/20260930_scheduler_cron.sql）。
 * 做两件事：
 *  1. 扫 muse19_memo：remind_at <= now 且 status='pending' → 推飞书 → status 置 'reminded'
 *  2. 扫 muse19_scheduled_task：enabled 且 cron 命中当前分钟（北京时间）→ 按 task_type 执行
 *     - api_pull：GET api_url，正文截断 6000 字符；payload.no_llm=true 则原文推送（零 token），
 *       否则 LLM 摘要；按 payload.template 做 {data}/{date} 替换后推送
 *     - custom：直接推送 payload.text
 *     - memo_sweep：占位，全局 muse19_memo 扫描已在上面处理
 *   一次性任务：payload.once=true 的任务执行后自动 enabled=false，只发一次
 *     执行后更新 last_run_at
 *
 * 安全：调用方必须在 Authorization 头携带 service_role key（与 MUSE19_SUPABASE_SERVICE_ROLE_KEY 比对）。
 * 必需 secrets：MUSE19_SUPABASE_URL / MUSE19_SUPABASE_SERVICE_ROLE_KEY / MUSE19_FEISHU_APP_ID / MUSE19_FEISHU_APP_SECRET
 * 可选 secrets：MUSE19_LLM_BASE_URL / MUSE19_LLM_API_KEY / MUSE19_LLM_MODEL（api_pull 摘要用）
 */

import { timingSafeEqual, cut } from "../_shared/utils.ts";
import { sendTextToChat } from "../_shared/feishu.ts";
import { getSb } from "../_shared/supabase.ts";
import { llmConfigured, llmChat } from "../_shared/llm.ts";
import { shanghaiParts, cronMatches } from "../_shared/time.ts";

const SERVICE_ROLE_KEY = Deno.env.get("MUSE19_SUPABASE_SERVICE_ROLE_KEY") ?? "";

function todayStr(): string {
  const p = shanghaiParts();
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function applyTemplate(
  template: string | undefined,
  data: string,
): string {
  const tpl = template || "{data}";
  return tpl
    .replaceAll("{data}", data)
    .replaceAll("{date}", todayStr())
    .slice(0, 7000);
}

/** api_pull：拉接口 → 截断 6000 → 可选 LLM 摘要 → 模板替换 */
async function runApiPull(payload: Record<string, unknown>): Promise<string> {
  const apiUrl = String(payload.api_url ?? "");
  if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
    return "定时任务配置错误：api_pull 缺少合法的 api_url。";
  }
  let raw: string;
  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Scheduler/1.0)" },
      signal: AbortSignal.timeout(25000),
      redirect: "follow",
    });
    if (!res.ok) return `接口请求失败 HTTP ${res.status}：${apiUrl}`;
    raw = (await res.text()).slice(0, 6000);
  } catch (e) {
    return `接口请求异常：${e instanceof Error ? e.message : "未知错误"}`;
  }
  if (!raw.trim()) return "接口返回为空。";

  // no_llm=true → 原文推送，零 token
  if (payload.no_llm === true) {
    return applyTemplate(
      payload.template as string | undefined,
      raw.slice(0, 3000),
    );
  }
  // 默认走 LLM 摘要（正文已截断 6000）
  let summary = raw;
  if (llmConfigured()) {
    try {
      summary = await llmChat(
        "你是数据摘要助手。用简体中文把以下接口返回数据摘要成不超过200字的要点，只输出摘要。",
        raw,
      );
    } catch (e) {
      console.error("[scheduler] api_pull LLM failed, fallback to raw:", e);
      summary = raw.slice(0, 1500);
    }
  }
  return applyTemplate(payload.template as string | undefined, summary);
}

async function runTask(task: any): Promise<string> {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  switch (task.task_type) {
    case "api_pull":
      return await runApiPull(payload);
    case "custom":
      return cut(String(payload.text ?? task.name ?? ""), 7000);
    case "memo_sweep":
      return ""; // 占位：全局 muse19_memo 扫描已统一处理
    default:
      return `未知任务类型：${task.task_type}`;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (
    !SERVICE_ROLE_KEY ||
    !timingSafeEqual(auth, `Bearer ${SERVICE_ROLE_KEY}`)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sb = getSb();
  const now = new Date();
  const nowIso = now.toISOString();

  // ---- 1) muse19_memo 到期提醒
  let memoPushed = 0;
  const { data: memos, error: memoErr } = await sb
    .from("muse19_memo")
    .select("id,content,source")
    .eq("status", "pending")
    .lte("remind_at", nowIso)
    .limit(50);
  if (memoErr) {
    console.error("[scheduler] muse19_memo query failed:", memoErr);
  } else {
    for (const m of memos ?? []) {
      try {
        let chatId = "";
        try {
          chatId = JSON.parse(m.source ?? "{}").chat_id ?? "";
        } catch {
          chatId = "";
        }
        if (chatId) {
          await sendTextToChat(chatId, `⏰ 提醒：${m.content}`);
        }
        await sb
          .from("muse19_memo")
          .update({ status: "reminded", updated_at: nowIso })
          .eq("id", m.id);
        memoPushed++;
      } catch (e) {
        console.error("[scheduler] muse19_memo push failed:", m.id, e);
      }
    }
  }

  // ---- 2) muse19_scheduled_task
  let tasksRun = 0;
  const { data: tasks, error: taskErr } = await sb
    .from("muse19_scheduled_task")
    .select("*")
    .eq("enabled", true)
    .limit(100);
  if (taskErr) {
    console.error("[scheduler] task query failed:", taskErr);
  } else {
    for (const t of tasks ?? []) {
      if (!cronMatches(String(t.cron ?? ""), now)) continue;
      try {
        const msg = await runTask(t);
        if (msg && t.target_chat) {
          await sendTextToChat(t.target_chat, msg);
        }
      } catch (e) {
        console.error("[scheduler] task run failed:", t.id, e);
      }
      const taskUpdate: Record<string, unknown> = { last_run_at: nowIso };
      if ((t.payload as Record<string, unknown> | null)?.once === true) {
        taskUpdate.enabled = false; // 一次性任务：发完即关闭
      }
      await sb
        .from("muse19_scheduled_task")
        .update(taskUpdate)
        .eq("id", t.id);
      tasksRun++;
    }
  }

  return Response.json({ ok: true, memoPushed, tasksRun });
});
