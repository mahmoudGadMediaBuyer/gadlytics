// GADLYTICS assistant proxy: the signed-in site sends {messages, tools, tier}; we call the Claude Messages API
// with the ANTHROPIC_API_KEY secret (set in Supabase → Edge Functions → Secrets) and return the raw response.
// verify_jwt is on, so only logged-in users of this project can use it. Tools run in the browser, not here.
const MODELS: Record<string, string> = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY is not set", code: "no_key" });
  let b: { messages?: unknown[]; tools?: unknown[]; tier?: string; system?: string };
  try { b = await req.json(); } catch { return json({ error: "bad body", code: "bad" }, 400); }
  if (!Array.isArray(b.messages) || !b.messages.length) return json({ error: "no messages", code: "bad" }, 400);
  const body: Record<string, unknown> = { model: MODELS[b.tier || "default"] || MODELS.default, max_tokens: 2500, messages: b.messages };
  if (b.system) body.system = b.system;
  if (Array.isArray(b.tools) && b.tools.length) body.tools = b.tools.slice(0, 12);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: (out as any)?.error?.message || ("Claude API " + r.status), code: r.status === 429 ? "rate_limited" : r.status === 401 ? "bad_key" : "api" });
  return json({ content: (out as any).content || [], stop_reason: (out as any).stop_reason, usage: (out as any).usage });
});
