-- muse19 飞书 webhook v1 用表（2026-11-18）
-- 用法：Supabase Dashboard -> SQL Editor -> 粘贴 -> Run
-- 注意：muse19_memo 已存在（id bigint），这里只补列，不重建。

-- 1. 记事本：补提醒相关列
alter table if exists public.muse19_memo
  add column if not exists remind_at timestamptz,
  add column if not exists status text not null default 'pending',
  add column if not exists source text,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists muse19_memo_remind_idx
  on public.muse19_memo (remind_at) where status = 'pending';

-- 2. 定期任务
create table if not exists public.muse19_scheduled_task (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cron text not null,
  task_type text not null,
  payload jsonb,
  target_chat text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

-- 3. 指令审计
create table if not exists public.muse19_feishu_command_log (
  id uuid primary key default gen_random_uuid(),
  sender text,
  chat_id text,
  command text not null,
  result text,
  created_at timestamptz not null default now()
);

-- 4. 研读 URL 缓存
create table if not exists public.muse19_url_cache (
  url_hash text primary key,
  url text not null,
  advice text not null,
  created_at timestamptz not null default now()
);

-- 5. 聊天收件箱：非指令消息、文件消息都先进这里，由 Muse 本人查收回复
create table if not exists public.muse19_chat_inbox (
  id uuid primary key default gen_random_uuid(),
  chat_id text,
  chat_type text,
  message_id text,
  sender_id text,
  sender_name text,
  content text,
  replied boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists muse19_chat_inbox_unreplied_idx
  on public.muse19_chat_inbox (created_at) where replied = false;

-- 6. 授权：数据面 service_role 读写需要显式 grant（否则报 403 42501）
grant all on public.muse19_memo to service_role, anon, authenticated;
grant all on public.muse19_scheduled_task to service_role, anon, authenticated;
grant all on public.muse19_feishu_command_log to service_role, anon, authenticated;
grant all on public.muse19_url_cache to service_role, anon, authenticated;
grant all on public.muse19_chat_inbox to service_role, anon, authenticated;
