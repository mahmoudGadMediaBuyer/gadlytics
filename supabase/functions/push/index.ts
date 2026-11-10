// GADLYTICS — Web Push (iPhone/iPad installed app + desktop Chrome). No external libraries: VAPID JWT (ES256) and
// RFC 8291 aes128gcm payload encryption with WebCrypto. VAPID keys are generated once and kept in public.app_secrets
// (VAPID_PUBLIC / VAPID_PRIVATE_JWK — service role only, never returned except the public key).
// Actions (signed-in user): vapid · subscribe {sub, ua, prefs?} · unsubscribe {endpoint} · prefs {endpoint, prefs} · mine · test.
// Action send (server only — header x-ingest-key, SHA-256 checked): {to:"all"|endpoints[], title, body, url, tag, silent, kind, client, campaign, platform, obj, force}.
// Every test/send is logged in public.alerts_sent with per-device delivery (deliveries[{ep: sha256(endpoint)[0..16], st: sent|failed|held|off}]).
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const INGEST_SHA = "84f033a41a28bb085aab26a037f2f74411eeb86e52bb4b16535e69e6892b6218";
const SITE = "https://mahmoudgadmediabuyer.github.io/gadlytics/";
const te = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ub64 = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function vapid(sb: any) {
  const { data } = await sb.from("app_secrets").select("name,value").in("name", ["VAPID_PUBLIC", "VAPID_PRIVATE_JWK"]);
  const m = Object.fromEntries((data || []).map((r: any) => [r.name, r.value]));
  if (m.VAPID_PUBLIC && m.VAPID_PRIVATE_JWK) return { pub: m.VAPID_PUBLIC as string, jwk: JSON.parse(m.VAPID_PRIVATE_JWK) };
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const now = new Date().toISOString();
  await sb.from("app_secrets").upsert([{ name: "VAPID_PUBLIC", value: pub, updated_at: now }, { name: "VAPID_PRIVATE_JWK", value: JSON.stringify(jwk), updated_at: now }], { onConflict: "name" });
  return { pub, jwk };
}
async function vapidAuth(endpoint: string, V: { pub: string; jwk: JsonWebKey }) {
  const aud = new URL(endpoint).origin;
  const h = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const key = await crypto.subtle.importKey("jwk", V.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + p));
  return "vapid t=" + h + "." + p + "." + b64u(sig) + ", k=" + V.pub;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function encrypt(sub: any, payload: string) {
  const ua = ub64(sub.keys.p256dh), auth = ub64(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const ck = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, ck, cat(te.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function sendOne(sb: any, V: any, row: any, msg: any) {
  const sub = row.sub, body = await encrypt(sub, JSON.stringify(msg));
  const r = await fetch(sub.endpoint, { method: "POST", body, headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "21600", Urgency: msg.urgency || "normal", Authorization: await vapidAuth(sub.endpoint, V), ...(msg.tag ? { Topic: String(msg.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}) } });
  const txt = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200);
  const upd: any = r.ok ? { last_ok: new Date().toISOString(), last_err: null } : { last_err: r.status + " " + txt };
  if (r.status === 404 || r.status === 410) upd.active = false;     // subscription gone (app removed / permission revoked)
  await sb.from("push_subs").update(upd).eq("endpoint", sub.endpoint);
  return { status: r.status, ok: r.ok, err: txt || undefined };
}

// device settings (prefs from the notifications screen): hours are Asia/Riyadh
const RULE_OF: Record<string, string> = { cpa: "cpa", bud: "bud", budget: "bud", roas: "roas", spike: "spike", meta: "meta", token: "meta", stale: "stale", media: "media", dailySummary: "dailySummary" };
function holdReason(pr: any, kind: string): string {
  if (!pr) return "";
  const rk = RULE_OF[kind]; if (rk && pr.rules && pr.rules[rk] === false) return "off";
  const d = new Date(Date.now() + 3 * 3600e3), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const from = Number(pr.from ?? 8) * 60, to = Number(pr.to ?? 24) * 60;
  if (from !== to && (from < to ? m < from || m >= to : m < from && m >= to)) return "held";
  const hm = (s: string) => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return x ? +x[1] * 60 + +x[2] : null; };
  const qa = hm(pr.qFrom), qb = hm(pr.qTo);
  if (qa != null && qb != null && qa !== qb && (qa < qb ? m >= qa && m < qb : m >= qa || m < qb)) return "held";
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  let b: any = {}; try { b = await req.json(); } catch { /* empty */ }
  const action = String(b?.action || "");
  // server-to-server (camp-alerts): the project's own service-role key, which never leaves Supabase; or the ingest key (scripts)
  const ik = req.headers.get("x-ingest-key") || "", bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = (ik ? (await sha256(ik)) === INGEST_SHA : false) || (!!bearer && bearer === env("SUPABASE_SERVICE_ROLE_KEY"));
  let user: any = null;
  if (!admin) {
    const ua = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("authorization") || "" } } });
    const { data } = await ua.auth.getUser().catch(() => ({ data: { user: null } } as any)); user = data?.user;
    if (!user) return json({ ok: false, code: "unauthorized", error: "لازم تسجّل دخول" }, 401);
  }
  const V = await vapid(sb);
  if (action === "vapid") return json({ ok: true, key: V.pub });
  if (action === "subscribe") {
    const s = b?.sub; if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ ok: false, error: "اشتراك ناقص" }, 400);
    const { data: old } = await sb.from("push_subs").select("prefs").eq("endpoint", s.endpoint).maybeSingle();
    const { error } = await sb.from("push_subs").upsert({ endpoint: s.endpoint, user_id: user.id, email: user.email, sub: s, ua: String(b?.ua || "").slice(0, 200), active: true,
      prefs: b?.prefs || old?.prefs || null, last_err: null }, { onConflict: "endpoint" });
    return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true });
  }
  if (action === "unsubscribe") { await sb.from("push_subs").update({ active: false }).eq("endpoint", String(b?.endpoint || "")).eq("user_id", user.id); return json({ ok: true }); }
  if (action === "prefs") { const { error } = await sb.from("push_subs").update({ prefs: b?.prefs || null }).eq("endpoint", String(b?.endpoint || "")).eq("user_id", user.id); return json({ ok: !error, error: error?.message }); }
  if (action === "mine") { const { data } = await sb.from("push_subs").select("endpoint,ua,active,prefs,last_ok,last_err,created_at").eq("user_id", user.id); return json({ ok: true, subs: data || [] }); }
  if (action === "test" || (action === "send" && admin)) {
    let q = sb.from("push_subs").select("*").eq("active", true);
    if (action === "test") { q = q.eq("user_id", user.id); if (b?.endpoint) q = q.eq("endpoint", String(b.endpoint)); }
    else if (Array.isArray(b?.to)) q = q.in("endpoint", b.to);
    const { data: rows } = await q;
    const kind = action === "test" ? "test" : String(b?.kind || b?.rule || "other").slice(0, 20);
    const msg = action === "test"
      ? { title: "GADLYTICS ✓", body: "التنبيهات شغالة على الجهاز ده — هيوصلك هنا أي تنبيه عن حملاتك.", url: SITE + "?p=campperf", tag: "test", silent: !!b?.silent }
      : { title: String(b?.title || "GADLYTICS"), body: String(b?.body || ""), url: String(b?.url || SITE), tag: b?.tag, silent: !!b?.silent, urgency: b?.urgency };
    const res: any[] = [], dl: any[] = [];
    for (const r of rows || []) {
      const ep = (await sha256(r.endpoint)).slice(0, 16);
      // server alerts respect each device's settings: type switched off → "off"; outside delivery window / quiet hours → "held"
      const hold = action === "send" && !b?.force ? holdReason(r.prefs, kind) : "";
      if (hold) { dl.push({ ep, st: hold }); continue; }
      try { const x = await sendOne(sb, V, r, { ...msg, silent: msg.silent || !!r.prefs?.silent }); res.push(x); dl.push({ ep, st: x.ok ? "sent" : "failed", code: x.ok ? undefined : x.status }); }
      catch (e) { const err = String((e as Error)?.message || e).slice(0, 120); res.push({ ok: false, err }); dl.push({ ep, st: "failed" }); }
    }
    const st = dl.some((d) => d.st === "sent") ? "sent" : dl.some((d) => d.st === "failed") ? "failed" : dl.some((d) => d.st === "held") ? "held" : dl.length ? "off" : "none";
    // «سجل التنبيهات» on the notifications screen reads this (row security: user_id null = everyone, else only that user)
    await sb.from("alerts_sent").insert({ client_id: b?.client ? String(b.client) : null, campaign: b?.campaign ? String(b.campaign).slice(0, 40) : null, platform: b?.platform || null,
      kind, rule: b?.rule || kind, obj: b?.obj ? String(b.obj) : null, day: new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), level: b?.level ?? null,
      title: msg.title, body: msg.body, url: msg.url, status: st, deliveries: dl, user_id: action === "test" ? user.id : (b?.user_id || null) }).then(() => {}, () => {});
    return json({ ok: res.some((x: any) => x.ok), sent: res.length, held: dl.filter((d) => d.st === "held").length, results: res });
  }
  return json({ ok: false, error: "action" }, 400);
});
