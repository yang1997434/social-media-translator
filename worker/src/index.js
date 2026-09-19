// Free-tier proxy: holds the OpenRouter key, enforces per-install and global daily quotas, forwards to jev.
import shared from "../../shared.js";

const { MAX_REPLIES, callJev } = shared;
const ID_RE = /^[a-f0-9]{32}$/;
const DAY_TTL_S = 60 * 60 * 26;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const today = () => new Date().toISOString().slice(0, 10);

function validate(body) {
  if (!body || !ID_RE.test(body.installId || "")) return "bad_install_id";
  if (!body.original || typeof body.original.text !== "string") return "bad_original";
  if (!Array.isArray(body.replies) || !body.replies.length || body.replies.length > MAX_REPLIES) return "bad_replies";
  if (body.replies.some(r => typeof r.text !== "string" || typeof r.handle !== "string")) return "bad_replies";
  if (body.examples !== undefined && (typeof body.examples !== "object" || body.examples === null)) return "bad_examples";
  return null;
}

// installId is client-generated, so it can be rotated freely. The per-IP cap is what actually stops one
// person from draining the shared daily budget; the IP is hashed so raw addresses are never stored.
async function ipKey(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`xrf:${today()}:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, "0")).join("");
}

async function readCounters(env, id, ip) {
  const [used, spent, ipUsed] = await Promise.all([env.QUOTA.get(`q:${today()}:${id}`), env.QUOTA.get(`budget:${today()}`), ip ? env.QUOTA.get(`ip:${today()}:${ip}`) : null]);
  return { used: Number(used || 0), spent: Number(spent || 0), ipUsed: Number(ipUsed || 0) };
}

async function bump(env, id, ip, n, cost) {
  const { used, spent, ipUsed } = await readCounters(env, id, ip);
  await Promise.all([
    env.QUOTA.put(`q:${today()}:${id}`, String(used + n), { expirationTtl: DAY_TTL_S }),
    env.QUOTA.put(`ip:${today()}:${ip}`, String(ipUsed + n), { expirationTtl: DAY_TTL_S }),
    env.QUOTA.put(`budget:${today()}`, String(spent + cost), { expirationTtl: DAY_TTL_S }),
  ]);
  return used + n;
}

async function classify(body, env, req) {
  const perId = Number(env.DAILY_PER_ID), perIp = Number(env.DAILY_PER_IP), budget = Number(env.DAILY_BUDGET_USD);
  const ip = await ipKey(req);
  const { used, spent, ipUsed } = await readCounters(env, body.installId, ip);
  if (used + body.replies.length > perId) return json({ error: "quota", used, limit: perId }, 429);
  if (ipUsed + body.replies.length > perIp) return json({ error: "quota", scope: "ip", limit: perIp }, 429);
  if (spent >= budget) return json({ error: "budget" }, 429);
  const resp = await callJev(env.OPENROUTER_API_KEY, body.original, body.replies, body.categories, body.examples);
  const nowUsed = await bump(env, body.installId, ip, body.replies.length, resp.usage?.cost || 0);
  return json({ answers: resp.answers, usage: resp.usage, model: resp.model, quota: { used: nowUsed, limit: perId } });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" } });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/quota") {
      const id = url.searchParams.get("id") || "";
      if (!ID_RE.test(id)) return json({ error: "bad_install_id" }, 400);
      const { used } = await readCounters(env, id);
      return json({ used, limit: Number(env.DAILY_PER_ID) });
    }
    if (req.method !== "POST" || url.pathname !== "/classify") return json({ error: "not_found" }, 404);
    let body; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const err = validate(body);
    if (err) return json({ error: err }, 400);
    try { return await classify(body, env, req); }
    catch (e) { return json({ error: "upstream", detail: String(e.message || e).slice(0, 200) }, 502); }
  },
};
