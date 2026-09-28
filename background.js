// Service worker. Two jobs:
//  1. reply classification: the user's own TypeSafe jev key; without one the page uses its local rules only
//  2. translation: any OpenAI-compatible endpoint (SiliconFlow by default), streamed back to the tab paragraph by paragraph
importScripts("shared.js", "llm.js", "lang.js", "providers.js");
const { verdicts, callJev, JEV_TYPESAFE } = JEV_SHARED;

const DEFAULTS = { apiKey: "", threshold: 0.75,
  categories: { spam: true, bait: true, offtopic: true, slop: true } };
const EMPTY_STATS = { calls: 0, replies: 0, input_tokens: 0, output_tokens: 0, cost: 0 };

// The provider table (hosts, key shapes, default models, prices) lives in providers.js.
const { USD, PROVIDERS } = XRF_PROVIDERS;
const TR_DEFAULTS = { enabled: true, provider: "siliconflow", keys: {}, models: {}, mode: "replace", sites: { x: true, reddit: true }, fab: true, concurrency: 3, batch: 6, priceIn: null, priceOut: null };
const LEGACY_MODELS = { "Qwen/Qwen3.5-35B-A3B": PROVIDERS.siliconflow.model };
const TR_CACHE_MAX = 2000;
const TR_EMPTY_STATS = { day: "", today: { n: 0, in: 0, out: 0, cost: 0 }, month: "", mon: { n: 0, in: 0, out: 0, cost: 0 }, total: { n: 0, in: 0, out: 0, cost: 0 } };
const priceOf = tr => (Number(tr.priceIn) || Number(tr.priceOut)) ? [Number(tr.priceIn) || 0, Number(tr.priceOut) || 0] : PROVIDERS[tr.provider].prices[tr.model] || null;

// Which provider a pasted key belongs to. `key` in the table is the shape a provider's keys take (several can share one:
// a bare sk-<32 hex> fits more than one company). A key only ever goes to hosts of the company its shape points to:
// when the shape fits several companies the user picks one, it is never tried on the others. A company with regional
// hosts (China / global) is asked on each, since an account exists on one of them; GET /models is free and also gives
// the model list the default is picked from.
function detectKey(key, company) {
  key = String(key || "").trim();
  const ids = Object.keys(PROVIDERS).filter(id => id !== "custom" && (company ? PROVIDERS[id].company === company : PROVIDERS[id].key && new RegExp(PROVIDERS[id].key).test(key)));
  if (!ids.length) return Promise.resolve({ error: "unknown" });
  const companies = [...new Set(ids.map(id => PROVIDERS[id].company))];
  if (companies.length > 1) return Promise.resolve({ choices: companies.map(c => ({ company: c, name: brandOf(ids.find(id => PROVIDERS[id].company === c)) })) });
  // 400/401/403: this host doesn't know the key (xAI and Gemini answer a bad key with 400). 404/405: the key got past auth
  // but the host has no model list (Zhipu, Ark). Anything else (5xx, network): can't tell, trust the shape.
  const REJECT = [400, 401, 403];
  return Promise.all(ids.map(id => XRF_LLM.listModels({ ...PROVIDERS[id], apiKey: key }, { timeoutMs: 8000 })
    .then(models => ({ id, models }), e => ({ id, error: e.message, status: e.status })))).then(tries => {
    const hit = tries.find(t => t.models) || tries.find(t => t.status === 404 || t.status === 405);
    if (hit) return { provider: hit.id, model: hit.models ? pickModel(hit.id, hit.models) : PROVIDERS[hit.id].model, models: hit.models || null };
    if (tries.every(t => REJECT.includes(t.status))) return { provider: ids[0], error: "rejected", detail: tries[0].error };
    const up = tries.find(t => !REJECT.includes(t.status));
    return { provider: up.id, model: PROVIDERS[up.id].model, unverified: up.error };
  });
}
const hostOf = url => { try { return new URL(url).host; } catch { return "自定义接口"; } };
const brandOf = id => PROVIDERS[id].brand || PROVIDERS[id].name;
// The table's default when the account offers it, else the first available model matching the provider's preferences.
function pickModel(id, models) {
  const P = PROVIDERS[id];
  if (!models?.length || models.includes(P.model)) return P.model;
  for (const re of P.prefer || []) { const m = models.find(x => new RegExp(re, "i").test(x)); if (m) return m; }
  return P.model;
}

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s, categories: { ...DEFAULTS.categories, ...(s.categories || {}) } };
}
// Settings as stored: { provider, keys: {siliconflow, cerebras}, models: {…}, … }. Resolved here into the flat provider
// object llm.js expects ({ baseUrl, apiKey, model, thinking }). Pre-0.6.3 installs kept a single apiKey/model; read those too.
function resolveTr(tr) {
  const legacyModel = LEGACY_MODELS[tr?.model] || tr?.model;
  const t = { ...TR_DEFAULTS, ...tr, keys: { ...(tr?.keys || {}) }, models: { ...(tr?.models || {}) }, sites: { ...TR_DEFAULTS.sites, ...(tr?.sites || {}) } };
  if (!PROVIDERS[t.provider]) t.provider = "siliconflow";
  if (tr?.apiKey && !t.keys.siliconflow) t.keys.siliconflow = tr.apiKey;
  if (legacyModel && !t.models.siliconflow) t.models.siliconflow = legacyModel;
  const P = PROVIDERS[t.provider];
  return { ...t, baseUrl: t.provider === "custom" ? String(t.customBase || "").trim() : P.baseUrl, apiKey: t.keys[t.provider] || "", model: t.models[t.provider] || P.model, thinking: P.thinking };
}
async function getTr() { return resolveTr((await chrome.storage.sync.get({ tr: {} })).tr); }
// Persist the schema migration so the options page shows what is actually being called.
async function migrateTr() {
  const { tr } = await chrome.storage.sync.get({ tr: {} });
  if (!tr || (!("apiKey" in tr) && !("model" in tr))) return;
  const t = resolveTr(tr);
  const { apiKey, model, baseUrl, thinking, ...rest } = t;
  await chrome.storage.sync.set({ tr: { ...rest, priceIn: null, priceOut: null } });
}

// chrome.storage has no transactions: concurrent read-modify-write of stats/cache would drop updates. Serialize them.
let writeChain = Promise.resolve();
function serialize(fn) { const p = writeChain.then(fn, fn); writeChain = p.then(() => {}, () => {}); return p; }

// Memoized: two first-time callers racing would mint two ids, and the usage mirror below would then count this device twice.
let installIdLoad = null;
function installId() {
  return installIdLoad ||= (async () => {
    const { installId } = await chrome.storage.local.get("installId");
    if (installId) return installId;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    await chrome.storage.local.set({ installId: id });
    return id;
  })();
}

// ---------------- usage, summed across devices ----------------
// Local calendar day, so 今日 turns over at the user's midnight (toISOString turned it over at 09:00 in Japan).
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Usage follows the Chrome account across devices. Each device keeps its own counters in local storage (translation
// `tstats`, reply filter `stats`, written on every request) and mirrors them to sync as `<name>_<installId>`, so two
// machines never write the same item; usage() sums them. storage.sync allows 120 writes a minute, so the mirror is
// throttled, and it re-runs on every worker start in case the browser quit before a pending write.
const MIRRORED = ["tstats", "stats"], MIRROR_MS = 10000;
let mirrorTimer = null, mirroredAt = 0;
function mirrorUsage() {
  if (mirrorTimer) return;
  mirrorTimer = setTimeout(async () => {
    mirrorTimer = null;
    try {
      const [local, id] = await Promise.all([chrome.storage.local.get(MIRRORED), installId()]);
      const keys = MIRRORED.map(k => `${k}_${id}`), synced = await chrome.storage.sync.get(keys), changed = {};
      // The synced copy carries when it was written, so the other devices can show how fresh this one's numbers are.
      const bare = o => o && JSON.stringify({ ...o, ts: 0 });
      MIRRORED.forEach((k, i) => { if (local[k] && bare(synced[keys[i]]) !== bare(local[k])) changed[keys[i]] = { ...local[k], ts: Date.now() }; });
      if (!Object.keys(changed).length) return;
      mirroredAt = Date.now();
      await chrome.storage.sync.set(changed);
    } catch (e) { console.warn("[xrf] usage sync", e); }
  }, Math.max(0, mirroredAt + MIRROR_MS - Date.now()));
}
mirrorUsage();

// Every device summed, each in the same shape as one device's counters. This device's come from local storage, which is
// ahead of its own synced copy. Translation buckets from before 0.6.3 have no booked cost; then the reader estimates it.
async function usage() {
  const [synced, local, id] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(MIRRORED), installId()]);
  const rows = name => {
    const out = Object.keys(synced).filter(k => k.startsWith(name + "_") && k !== `${name}_${id}`).map(k => synced[k]);
    if (local[name]) out.push(local[name]);
    return out;
  };
  const sum = buckets => {
    const s = { n: 0, in: 0, out: 0, cost: 0 };
    let booked = true;
    for (const b of buckets) {
      if (!b?.n) continue;
      s.n += b.n; s.in += b.in || 0; s.out += b.out || 0;
      if (typeof b.cost === "number") s.cost += b.cost; else booked = false;
    }
    if (!booked) delete s.cost;
    return s;
  };
  const day = today(), month = day.slice(0, 7), tr = rows("tstats"), filter = rows("stats");
  const others = Object.keys(synced).filter(k => k.startsWith("tstats_") && k !== `tstats_${id}`).map(k => synced[k].ts || 0);
  return {
    devices: { tstats: tr.length, stats: filter.length, others },   // others: when each other device last synced (0: before 0.9)
    tstats: tr.length ? { day, month, today: sum(tr.filter(d => d.day === day).map(d => d.today)),
      mon: sum(tr.filter(d => d.month === month).map(d => d.mon)), total: sum(tr.map(d => d.total)) } : null,
    stats: filter.length ? filter.reduce((s, d) => { for (const k in s) s[k] += d[k] || 0; return s; }, { ...EMPTY_STATS }) : null,
  };
}

// ---------------- reply filter ----------------
async function getExamples() {
  const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
  return JEV_SHARED.sanitizeExamples(examples);
}

function recordUsage(usage, n) {
  return serialize(async () => {
    const { stats } = await chrome.storage.local.get({ stats: EMPTY_STATS });
    stats.calls += 1; stats.replies += n;
    stats.input_tokens += usage?.input_tokens || 0; stats.output_tokens += usage?.output_tokens || 0; stats.cost += usage?.cost || 0;
    await chrome.storage.local.set({ stats });
    mirrorUsage();
  });
}

// No free proxy: the upstream one is paid for by its author. Without a key the page keeps its local rules.
async function classify(msg) {
  const settings = await getSettings();
  if (!settings.apiKey) return { error: "nokey" };
  const examples = await getExamples();
  const resp = await callJev(settings.apiKey, msg.original, msg.replies, settings.categories, examples, fetch, JEV_TYPESAFE);
  await recordUsage(resp.usage, msg.replies.length);
  return { verdicts: verdicts(resp.answers || {}, msg.replies.length, settings.threshold), mode: "byok" };
}

// ---------------- translation ----------------
function hash(s) {   // FNV-1a, cache key
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Cost is booked here, per request, at the price of the model that actually served it (OpenRouter reports the exact USD
// figure; the other hosts use the list price), so switching providers mid-month never re-prices earlier usage.
function addTrStats(n, tokIn, tokOut, cost) {
  return serialize(async () => {
    const { tstats } = await chrome.storage.local.get({ tstats: TR_EMPTY_STATS });
    const s = { ...TR_EMPTY_STATS, ...tstats };
    const empty = () => ({ n: 0, in: 0, out: 0, cost: 0 });
    if (s.day !== today()) { s.day = today(); s.today = empty(); }
    if (s.month !== today().slice(0, 7)) { s.month = today().slice(0, 7); s.mon = empty(); }
    for (const b of [s.today, s.mon, s.total]) { b.n += n; b.in += tokIn; b.out += tokOut; b.cost = (b.cost || 0) + cost; }
    await chrome.storage.local.set({ tstats: s });
    mirrorUsage();
  });
}
const costOf = (tr, usage) => usage.cost != null ? usage.cost * USD
  : (() => { const p = priceOf(tr); return p ? ((usage.prompt_tokens || 0) * p[0] + (usage.completion_tokens || 0) * p[1]) / 1e6 : 0; })();

// notify(index, text) fires as soon as each paragraph is complete in the stream; the full array is returned at the end.
let translationRunning = 0;
const translationWaiters = [];
async function withTranslationSlot(task) {
  if (translationRunning >= 3) await new Promise((resolve, reject) => {
    const entry = { resolve: () => { clearTimeout(timer); resolve(); } };
    // Several tabs share these slots. Queue time is not model execution time.
    const timer = setTimeout(() => { const index = translationWaiters.indexOf(entry); if (index >= 0) translationWaiters.splice(index, 1); reject(new Error("翻译排队超时，请稍后重试")); }, 120000);
    translationWaiters.push(entry);
  }); else translationRunning++;
  try { return await task(); }
  finally { const next = translationWaiters.shift(); if (next) next.resolve(); else translationRunning--; }
}

// Translation cache lives in memory for the worker's lifetime and is written through to storage shortly after each
// change. Reading and re-serialising the whole 2000-entry object on every batch was measurable latency under 3-way
// concurrency and is pointless while the worker is alive.
let cacheLoad = null, cacheMem = null, cacheFlush = null;
function loadCache() {
  return cacheLoad ||= chrome.storage.local.get("tcache").then(({ tcache }) => (cacheMem = tcache || {}));
}
function putCache(entries) {
  Object.assign(cacheMem, entries);
  const keys = Object.keys(cacheMem);
  if (keys.length > TR_CACHE_MAX) keys.sort((a, b) => cacheMem[a].ts - cacheMem[b].ts).slice(0, keys.length - TR_CACHE_MAX).forEach(k => delete cacheMem[k]);
  clearTimeout(cacheFlush);
  cacheFlush = setTimeout(() => serialize(() => chrome.storage.local.set({ tcache: cacheMem })), 800);
}
function clearCache() {
  cacheMem = {}; cacheLoad = Promise.resolve(cacheMem); clearTimeout(cacheFlush);
  return serialize(() => chrome.storage.local.remove("tcache"));
}

// The model kept an item in its source language (happens with terse slang: "W", "ratio"). Detected the same way the
// page decided to send it: text that would still be sent for translation is not a translation.
const untranslated = (src, out) => !/\p{Script=Han}/u.test(out) && XRF_LANG.shouldTranslate(src);

async function translate(texts, notify) {
  const tr = await getTr();
  if (!tr.apiKey) return { error: "未配置翻译 API Key" };
  if (!tr.baseUrl || !tr.model) return { error: "未配置接口地址或模型" };
  const keyOf = t => hash(`zh-Hans-v2|${tr.baseUrl}|${tr.model}|${t}`);
  const tcache = await loadCache();
  const out = new Array(texts.length).fill(null);
  const miss = [];
  texts.forEach((t, i) => { const hit = tcache[keyOf(t)]; if (hit) { out[i] = hit.t; notify?.(i, hit.t); } else miss.push(i); });
  if (!miss.length) return { translations: out };

  let notified = 0, r;
  try {
    r = await withTranslationSlot(() => XRF_LLM.chat(tr, miss.map(i => texts[i]), { stream: true, onContent: content => {
      if (!notify) return;
      const partial = XRF_LLM.parsePartial(content, miss.length);
      for (; notified < partial.length; notified++) { out[miss[notified]] = partial[notified]; notify(miss[notified], partial[notified]); }
    } }));
  } catch (e) { return { error: e.message, translations: out }; }
  let arr = XRF_LLM.parseBatch(r.content, miss.length);
  if (!arr) { const partial = XRF_LLM.parsePartial(r.content, miss.length); if (partial.length === miss.length) arr = partial; }
  const usage = r.usage ? { ...r.usage } : { prompt_tokens: XRF_LLM.approxTokens(JSON.stringify(miss.map(i => texts[i]))), completion_tokens: XRF_LLM.approxTokens(r.content) };
  if (typeof usage.cost !== "number") delete usage.cost;
  // A malformed multi-item JSON response used to turn every paragraph in the
  // batch red. Retry each item alone; single-item parsing also accepts plain text.
  if (!arr && miss.length > 1) {
    const singles = await Promise.all(miss.map(async (sourceIndex) => {
      try {
        const one = await withTranslationSlot(() => XRF_LLM.chat(tr, [texts[sourceIndex]], { stream: true }));
        const parsed = XRF_LLM.parseBatch(one.content, 1);
        if (!parsed?.[0]) throw new Error("模型返回的格式无法解析，请重试或换个模型");
        out[sourceIndex] = parsed[0]; notify?.(sourceIndex, parsed[0]);
        usage.prompt_tokens += one.usage?.prompt_tokens || 0; usage.completion_tokens += one.usage?.completion_tokens || 0;
        if (usage.cost != null) usage.cost += one.usage?.cost || 0;
        return { text: parsed[0] };
      } catch (e) { return { error: e.message }; }
    }));
    const failed = singles.find(x => x.error);
    if (failed) return { error: failed.error, translations: out };
    arr = singles.map(x => x.text);
  }
  if (!arr) return { error: "模型返回的格式无法解析，请重试或换个模型", translations: out };

  // Items echoed back in the source language get one more, explicitly strict, pass. Whatever comes back is final.
  const stale = miss.map((i, j) => j).filter(j => untranslated(texts[miss[j]], arr[j]));
  if (stale.length) {
    try {
      const again = await withTranslationSlot(() => XRF_LLM.chat(tr, stale.map(j => texts[miss[j]]), { stream: false, strict: true, timeoutMs: 20000 }));
      const fixed = XRF_LLM.parseBatch(again.content, stale.length);
      if (fixed) stale.forEach((j, k) => { if (/\p{Script=Han}/u.test(fixed[k])) arr[j] = fixed[k]; });
      usage.prompt_tokens += again.usage?.prompt_tokens || 0; usage.completion_tokens += again.usage?.completion_tokens || 0;
      if (usage.cost != null) usage.cost += again.usage?.cost || 0;
    } catch { /* keep the first answer */ }
  }

  const fresh = {};
  miss.forEach((i, j) => { out[i] = arr[j]; fresh[keyOf(texts[i])] = { t: arr[j], ts: Date.now() }; });
  putCache(fresh);
  await addTrStats(miss.length, usage.prompt_tokens || 0, usage.completion_tokens || 0, costOf(tr, usage));
  return { translations: out };
}

const TEST_TEXT = ["Honestly this is the best take I've seen on the whole thing, [[0]] nailed it 😂"];
async function trTest(provider) {
  const t0 = Date.now();
  try {
    const r = await XRF_LLM.chat(provider, TEST_TEXT, { stream: true, timeoutMs: 30000 });
    const arr = XRF_LLM.parseBatch(r.content, 1);
    const tokOut = r.usage?.completion_tokens ?? XRF_LLM.approxTokens(r.content);
    const gen = r.totalMs - (r.ttfbMs ?? 0);
    const sample = (arr ? arr[0] : r.content).slice(0, 120);
    return { ok: true, sample, keepsPlaceholders: sample.includes("[[0]]"), ttfbMs: r.ttfbMs ?? r.totalMs, totalMs: r.totalMs, tps: gen > 0 ? +(tokOut / (gen / 1000)).toFixed(1) : null };
  } catch (e) { return { ok: false, error: e.message, totalMs: Date.now() - t0 }; }
}

async function trConfig() {
  const tr = await getTr();
  return { configured: !!(tr.apiKey && tr.baseUrl && tr.model), enabled: tr.enabled !== false, sites: tr.sites, fab: tr.fab !== false, mode: tr.mode, concurrency: tr.concurrency, batch: tr.batch,
    provider: tr.provider, providerName: tr.provider === "custom" ? hostOf(tr.baseUrl) : PROVIDERS[tr.provider].name, model: tr.model, price: priceOf(tr) };
}

// One tiny real call so the options page can confirm the key before the user goes browsing.
async function jevTest(apiKey) {
  const t0 = Date.now();
  try {
    const resp = await callJev(apiKey, { handle: "op", text: "Shipped the fix for image compaction in long sessions." },
      [{ handle: "shill", text: "Our AI trading bot made 40% this week, join the waitlist 👉", verified: false }], undefined, undefined, fetch, JEV_TYPESAFE);
    const p = resp.answers?.r0_spam?.noul;
    return { ok: true, ms: Date.now() - t0, model: resp.model, spam: p, usage: resp.usage };
  } catch (e) { return { ok: false, error: e.message, ms: Date.now() - t0 }; }
}

function setBadge(tabId, n) {
  chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0", tabId });
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : "", tabId });
}

const HANDLERS = {
  classify: msg => classify(msg),
  openOptions: () => { chrome.runtime.openOptionsPage(); return Promise.resolve({ ok: true }); },
  count: (msg, sender) => { if (sender.tab) setBadge(sender.tab.id, msg.n); return Promise.resolve({ ok: true }); },
  translate: (msg, sender) => {
    const tabId = sender?.tab?.id;
    const frame = sender?.frameId != null ? { frameId: sender.frameId } : undefined;
    const send = tabId != null && msg.reqId ? payload => chrome.tabs.sendMessage(tabId, { ...payload, reqId: msg.reqId }, frame).catch(() => {}) : null;
    const notify = send ? (index, text) => send({ type: "trPartial", index, text }) : null;
    // Keep the content-script watchdog alive during a healthy queue/request.
    // If the worker disappears, these stop and the page can offer a retry.
    const heartbeat = send ? setInterval(() => send({ type: "trProgress" }), 10000) : null;
    return translate(msg.texts || [], notify).finally(() => clearInterval(heartbeat));
  },
  trConfig: () => trConfig(),
  // Page translation spans iframes (claude.ai artifacts live in one): the top frame's toggle reaches every frame, a late
  // frame asks the top frame whether to join, and child counts go up to the top frame's side tab / popup.
  trFrames: (msg, sender) => { if (sender.tab) chrome.tabs.sendMessage(sender.tab.id, { type: "trFrames", on: !!msg.on }).catch(() => {}); return Promise.resolve({ ok: true }); },
  trFrameHello: (_msg, sender) => sender.tab ? chrome.tabs.sendMessage(sender.tab.id, { type: "trFrameOn" }, { frameId: 0 }).then(r => ({ on: !!r?.on }), () => ({ on: false })) : Promise.resolve({ on: false }),
  trFrameStats: (msg, sender) => { if (sender.tab) chrome.tabs.sendMessage(sender.tab.id, { type: "trFrameStats", frameId: sender.frameId, stats: msg.stats }, { frameId: 0 }).catch(() => {}); return Promise.resolve({ ok: true }); },
  usage: () => usage(),
  trDefaults: () => Promise.resolve({ defaults: TR_DEFAULTS, providers: PROVIDERS }),
  trTest: msg => trTest(msg.provider),
  trModels: msg => XRF_LLM.listModels(msg.provider).then(models => ({ models }), e => ({ error: e.message })),
  trDetect: msg => detectKey(msg.key, msg.company),
  trCss: () => fetch(chrome.runtime.getURL("translator.css")).then(r => r.text()).then(css => ({ css })),   // for shadow roots
  trClearCache: () => clearCache().then(() => ({ ok: true })),
  jevTest: msg => jevTest(msg.apiKey),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, e => sendResponse({ error: String(e.message || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Remove credentials and usage left by retired features (video; the free proxy's quota) on update/reload.
  await Promise.all([chrome.storage.sync.remove("video"), chrome.storage.local.remove(["vstats", "vaudio", "quota"]), migrateTr()]);
  if (reason === "install") chrome.runtime.openOptionsPage();
});
