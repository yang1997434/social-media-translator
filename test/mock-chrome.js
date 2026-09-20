// In-memory chrome.* shim so popup.html / options.html / translator.js run as plain pages (python3 -m http.server).
// Query params: ?url=<active tab url>  ?configured=0 (no translation key)  ?mode=bilingual
(() => {
  const qs = new URLSearchParams((document.currentScript?.src || "").split("?")[1] || location.search);  // srcdoc iframe: params ride on the script src
  const listeners = [];
  const store = area => {
    const mem = {};
    const norm = k => { const d = k && typeof k === "object" && !Array.isArray(k) ? k : {}; const keys = typeof k === "string" ? [k] : Array.isArray(k) ? k : k == null ? Object.keys(mem) : Object.keys(k); return { d, keys }; };
    return { mem,
      get: async k => { const { d, keys } = norm(k); return Object.fromEntries(keys.filter(x => x in mem || x in d).map(x => [x, x in mem ? structuredClone(mem[x]) : d[x]])); },
      set: async o => { Object.assign(mem, structuredClone(o)); const ch = Object.fromEntries(Object.keys(o).map(x => [x, { newValue: o[x] }])); listeners.forEach(fn => fn(ch, area)); },
      remove: async k => { (Array.isArray(k) ? k : [k]).forEach(x => delete mem[x]); } };
  };
  const sync = store("sync"), local = store("local");
  const USD = 7.1;
  const PROVIDERS = {
    siliconflow: { name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3.6-35B-A3B", thinking: "enable_thinking", keyHint: "粘贴硅基流动 API Key（sk-…）", keyUrl: "https://cloud.siliconflow.cn/account/ak", prices: { "Qwen/Qwen3.6-35B-A3B": [1.8, 10.8], "Qwen/Qwen3.5-122B-A10B": [0.8, 6.4] } },
    cerebras: { name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", model: "qwen-3.8-27b", thinking: "reasoning_effort", keyHint: "粘贴 Cerebras API Key（csk-…）", keyUrl: "https://cloud.cerebras.ai/", prices: { "qwen-3.8-27b": [0.99 * USD, 1.49 * USD] } },
    openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-3.1-flash-lite", thinking: "openrouter", keyHint: "粘贴 OpenRouter API Key（sk-or-…）", keyUrl: "https://openrouter.ai/keys", prices: { "google/gemini-3.1-flash-lite": [0.25 * USD, 1.5 * USD] } },
  };
  const DEFAULTS = { enabled: true, provider: "siliconflow", keys: {}, models: {}, mode: "replace", sites: { x: true, reddit: true }, fab: qs.get("fab") !== "0", concurrency: 3, batch: 6, priceIn: null, priceOut: null };
  if (qs.get("configured") !== "0") sync.mem.tr = { provider: qs.get("provider") || "siliconflow", keys: { siliconflow: "sk-mock", cerebras: "csk-mock" }, mode: qs.get("mode") || "replace" };
  local.mem.recent = [{ id: "201", t: "Great insights! Leveraging AI to unlock efficiency is truly the future of work.", h: "growthguru", reason: "AI 套话", p: 0.91, ts: 1 },
    { id: "202", t: "Honest question: does the fix apply to the CLI too?", h: "dev_amy", reason: "跑题", p: 0.76, ts: 2 }];
  local.mem.examples = { bad: [{ id: "9", t: "Reset pls", h: "someone", ts: 0 }], good: [{ id: "10", t: "Thanks, the cache hit-rate explanation was the missing piece.", h: "tibo", ts: 1 }] };
  local.mem.stats = { calls: 41, replies: 328, input_tokens: 61500, output_tokens: 3900, cost: 0.0246 };
  local.mem.tstats = { day: new Date().toISOString().slice(0, 10), today: { n: 57, in: 12400, out: 6100 }, month: new Date().toISOString().slice(0, 7), mon: { n: 1240, in: 268000, out: 131000 }, total: { n: 1893, in: 402000, out: 197000 } };
  local.mem.quota = { used: 42, limit: 300 };
  sync.mem.blockedHandles = ["spammer123", "growth_guru"];
  const tr = async () => { const t = { ...DEFAULTS, ...(await sync.get({ tr: {} })).tr }; const P = PROVIDERS[t.provider] || PROVIDERS.siliconflow; return { ...t, apiKey: t.keys?.[t.provider] || "", model: t.models?.[t.provider] || P.model, providerName: P.name, price: qs.get("price") === "0" ? null : P.prices[t.models?.[t.provider] || P.model] || null }; };
  // Canned translations for the translator fixture: keep [[n]] placeholders where the source had them.
  const CANNED = { "Update on rate limits in Codex. We found some inefficiencies when using images in long sessions and shipped fixes.": "Codex 速率限制的最新进展：我们发现长会话中使用图片时存在一些低效问题，已经修复上线。",
    "Does the compaction fix also apply to the CLI or only the desktop app? [[0]]": "压缩修复也适用于 CLI 吗，还是只有桌面端？[[0]]",
    "Great insights! Leveraging AI to unlock efficiency is truly the future of work. Thanks for sharing!": "见解很棒！用 AI 释放效率确实是未来的工作方式，感谢分享！",
    "[[0]] honestly the image path was always the slow one, nice to see it fixed [[1]] more here: [[2]]": "[[0]] 说实话图片那条路径一直是最慢的，很高兴看到修好了 [[1]] 详见：[[2]]" };
  const handlers = {
    trDefaults: async () => ({ defaults: DEFAULTS, providers: PROVIDERS }),
    trConfig: async () => { const t = await tr(); return { configured: !!t.apiKey, enabled: t.enabled !== false, sites: t.sites, fab: t.fab !== false, mode: t.mode, concurrency: t.concurrency, batch: t.batch, provider: t.provider, providerName: t.providerName, model: t.model, price: t.price }; },
    getQuota: async () => ({ used: 42, limit: 300 }),
    trTest: async () => { await new Promise(r => setTimeout(r, 600)); return { ok: true, sample: "说实话这是我见过对整件事最好的解读，[[0]] 一针见血 😂", ttfbMs: 412, totalMs: 1380, tps: 96.4 }; },
    trModels: async () => ({ models: ["Qwen/Qwen3.6-35B-A3B", "Qwen/Qwen3.5-122B-A10B", "zai-org/GLM-4.5-Air", "Qwen/Qwen3.8-27B", "qwen-3.8-27b", "gpt-oss-120b"] }),
    trClearCache: async () => ({ ok: true }),
    jevTest: async () => { await new Promise(r => setTimeout(r, 500)); return { ok: true, ms: 640, model: "jev-1.13.0", spam: 0.97, usage: { input_tokens: 310, output_tokens: 20 } }; },
    openOptions: async () => ({ ok: true }), count: async () => ({ ok: true }),
    translate: async msg => { await new Promise(r => setTimeout(r, 100 + Math.random() * 900)); return { translations: msg.texts.map(t => CANNED[t] || "（译）" + t) }; },
  };
  let onMessage = null;
  window.__mock = { sync, local, listeners };
  window.chrome = {
    storage: { sync, local, onChanged: { addListener: fn => listeners.push(fn) } },
    runtime: { id: "mock", getManifest: () => ({ version: "0.6.0-mock" }), openOptionsPage: () => alert("openOptionsPage()"), getURL: p => "/" + p,
      sendMessage: async msg => { const h = handlers[msg.type]; if (!h) throw new Error("no handler " + msg.type); return h(msg); },
      onMessage: { addListener: fn => { onMessage = fn; window.__mock.onMessage = fn; } } },
    tabs: { query: async () => [{ id: 1, url: qs.get("url") || "https://x.com/thsottiaux/status/100" }],
      sendMessage: async (_id, m) => m.type === "getStats" ? { scanned: 34, byRule: 2, byJev: 5, pending: 1, note: "", enabled: true }
        : m.type === "getTrStats" ? (window.__pageOn ? { enabled: true, site: "generic", translated: 12, failed: 0, pending: 2 } : /x\.com|reddit/.test(qs.get("url") || "x.com") ? { enabled: true, site: "x", translated: 23, failed: 0, pending: 3 } : null)
        : m.type === "trTogglePage" ? { enabled: (window.__pageOn = !window.__pageOn), configured: true } : { ok: true } },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { insertCSS: async () => {}, executeScript: async () => {} },
  };
})();
