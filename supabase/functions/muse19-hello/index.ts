// muse19-hello: muse19 的第一个 Supabase Edge Function，用于验证
// GitHub Actions 自动部署链路（push -> Actions -> Supabase）。
Deno.serve((_req) => {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "hello from muse19",
      deployed_via: "github-actions",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
