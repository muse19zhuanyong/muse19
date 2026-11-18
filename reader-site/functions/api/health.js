// GET /api/health
// 只返回各功能是否已配置（布尔值），绝不返回任何密钥内容。

export async function onRequestGet(context) {
  const env = context.env || {};
  return new Response(
    JSON.stringify({
      fish: !!env.FISH_API_KEY,
      groq: !!env.GROQ_API_KEY,
      openrouter: !!env.OPENROUTER_API_KEY,
      gemini: !!env.GEMINI_API_KEY,
      gate: !!env.ACCESS_PASSWORD,
      inbox: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY),
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
