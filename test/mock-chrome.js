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
  const DEFAULTS = { enabled: true, baseUrl: "https://api.siliconflow.cn/v1", apiKey: "", model: "Qwen/Qwen3.5-35B-A3B", mode: "replace", sites: { x: true, reddit: true }, concurrency: 3, batch: 6 };
  if (qs.get("configured") !== "0") sync.mem.tr = { apiKey: "sk-mock", mode: qs.get("mode") || "replace" };
  local.mem.recent = [{ id: "201", t: "Great insights! Leveraging AI to unlock efficiency is truly the future of work.", h: "growthguru", reason: "AI 套话", p: 0.91, ts: 1 },
    { id: "202", t: "Honest question: does the fix apply to the CLI too?", h: "dev_amy", reason: "跑题", p: 0.76, ts: 2 }];
  local.mem.examples = { bad: [{ id: "9", t: "Reset pls", h: "someone", ts: 0 }], good: [{ id: "10", t: "Thanks, the cache hit-rate explanation was the missing piece.", h: "tibo", ts: 1 }] };
  local.mem.stats = { calls: 41, replies: 328, input_tokens: 61500, output_tokens: 3900, cost: 0.0246 };
  local.mem.tstats = { day: new Date().toISOString().slice(0, 10), today: { n: 57, in: 12400, out: 6100 }, total: { n: 1893, in: 402000, out: 197000 } };
  local.mem.quota = { used: 42, limit: 300 };
  sync.mem.blockedHandles = ["spammer123", "growth_guru"];
  const tr = async () => ({ ...DEFAULTS, ...(await sync.get({ tr: {} })).tr });
  // Canned translations for the translator fixture: keep [[n]] placeholders where the source had them.
  const CANNED = { "Update on rate limits in Codex. We found some inefficiencies when using images in long sessions and shipped fixes.": "Codex 速率限制的最新进展：我们发现长会话中使用图片时存在一些低效问题，已经修复上线。",
    "Does the compaction fix also apply to the CLI or only the desktop app? [[0]]": "压缩修复也适用于 CLI 吗，还是只有桌面端？[[0]]",
    "Great insights! Leveraging AI to unlock efficiency is truly the future of work. Thanks for sharing!": "见解很棒！用 AI 释放效率确实是未来的工作方式，感谢分享！",
    "[[0]] honestly the image path was always the slow one, nice to see it fixed [[1]] more here: [[2]]": "[[0]] 说实话图片那条路径一直是最慢的，很高兴看到修好了 [[1]] 详见：[[2]]" };
  const handlers = {
    trDefaults: async () => ({ defaults: DEFAULTS }),
    trConfig: async () => { const t = await tr(); return { configured: !!t.apiKey, enabled: t.enabled !== false, sites: t.sites, mode: t.mode, concurrency: t.concurrency, batch: t.batch, model: t.model }; },
    getQuota: async () => ({ used: 42, limit: 300 }),
    trTest: async () => { await new Promise(r => setTimeout(r, 600)); return { ok: true, sample: "说实话这是我见过对整件事最好的解读，[[0]] 一针见血 😂", ttfbMs: 412, totalMs: 1380, tps: 96.4 }; },
    trModels: async () => ({ models: ["Qwen/Qwen3.5-35B-A3B", "Qwen/Qwen3-8B", "deepseek-ai/DeepSeek-V3", "THUDM/GLM-4-9B-0414"] }),
    trClearCache: async () => ({ ok: true }),
    openOptions: async () => ({ ok: true }), count: async () => ({ ok: true }),
    translate: async msg => { await new Promise(r => setTimeout(r, 300)); return { translations: msg.texts.map(t => CANNED[t] || "（译）" + t) }; },
  };
  let onMessage = null;
  window.__mock = { sync, local, listeners };
  window.chrome = {
    storage: { sync, local, onChanged: { addListener: fn => listeners.push(fn) } },
    runtime: { id: "mock", getManifest: () => ({ version: "0.6.0-mock" }), openOptionsPage: () => alert("openOptionsPage()"),
      sendMessage: async msg => { const h = handlers[msg.type]; if (!h) throw new Error("no handler " + msg.type); return h(msg); },
      onMessage: { addListener: fn => { onMessage = fn; } } },
    tabs: { query: async () => [{ id: 1, url: qs.get("url") || "https://x.com/thsottiaux/status/100" }],
      sendMessage: async (_id, m) => m.type === "getStats" ? { scanned: 34, byRule: 2, byJev: 5, pending: 1, note: "", enabled: true }
        : m.type === "getTrStats" ? { enabled: true, site: "x", translated: 23, failed: 0, pending: 3 } : { ok: true } },
    permissions: { contains: async () => true, request: async () => true },
  };
})();
