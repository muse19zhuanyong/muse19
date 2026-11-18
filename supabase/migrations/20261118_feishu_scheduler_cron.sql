-- 飞书 scheduler 每分钟触发器（2026-11-18）
-- 用法：先把下面 <SUPABASE_SERVICE_ROLE_KEY> 换成真实的 service_role key，
-- 再去 Supabase Dashboard -> SQL Editor -> 粘贴 -> Run。
-- 不要不替换就跑，否则 pg_cron 调 scheduler 会报 401。
-- pg_cron / pg_net 若未启用，先去 Database -> Extensions 手动启用。

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('muse19-feishu-scheduler-every-minute')
where exists (select 1 from cron.job where jobname = 'muse19-feishu-scheduler-every-minute');

select cron.schedule(
  'muse19-feishu-scheduler-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://enrczmszubgzksfarvqv.supabase.co/functions/v1/muse19-feishu-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- 验证：select * from cron.job; 应该能看到 muse19-feishu-scheduler-every-minute
