// Service worker. Two jobs:
//  1. reply classification: free proxy (default) or direct OpenRouter jev (BYO key)
//  2. translation: any OpenAI-compatible endpoint (SiliconFlow by default), streamed back to the tab paragraph by paragraph
importScripts("shared.js", "llm.js");
const { verdicts, callJev } = JEV_SHARED;

const DEFAULTS = { apiKey: "", threshold: 0.75, proxyUrl: "https://xrf.ship2market.ai",
  categories: { spam: true, bait: true, offtopic: true, slop: true } };
const EMPTY_STATS = { calls: 0, replies: 0, input_tokens: 0, output_tokens: 0, cost: 0 };

const TR_DEFAULTS = { enabled: true, baseUrl: "https://api.siliconflow.cn/v1", apiKey: "", model: "Qwen/Qwen3.5-35B-A3B",
  mode: "replace", sites: { x: true, reddit: true }, concurrency: 3, batch: 6 };
const TR_CACHE_MAX = 2000;
const TR_EMPTY_STATS = { day: "", today: { n: 0, in: 0, out: 0 }, total: { n: 0, in: 0, out: 0 } };

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s, categories: { ...DEFAULTS.categories, ...(s.categories || {}) } };
}
async function getTr() {
  const { tr } = await chrome.storage.sync.get({ tr: {} });
  return { ...TR_DEFAULTS, ...tr, baseUrl: TR_DEFAULTS.baseUrl, sites: { ...TR_DEFAULTS.sites, ...(tr?.sites || {}) } };
}

// chrome.storage has no transactions: concurrent read-modify-write of stats/cache would drop updates. Serialize them.
let writeChain = Promise.resolve();
function serialize(fn) { const p = writeChain.then(fn, fn); writeChain = p.then(() => {}, () => {}); return p; }

async function installId() {
  const { installId } = await chrome.storage.local.get("installId");
  if (installId) return installId;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ installId: id });
  return id;
}

// ---------------- reply filter ----------------
async function getExamples() {
  const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
  return JEV_SHARED.sanitizeExamples(examples);
}

async function viaProxy(settings, original, replies, examples) {
  const res = await fetch(settings.proxyUrl.replace(/\/$/, "") + "/classify", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installId: await installId(), original, replies, categories: settings.categories, examples }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === "quota" || data.error === "budget" ? "quota" : `proxy ${res.status}: ${data.error || ""}`);
  if (data.quota) await chrome.storage.local.set({ quota: data.quota });
  return data;
}

function recordUsage(usage, n) {
  return serialize(async () => {
    const { stats } = await chrome.storage.local.get({ stats: EMPTY_STATS });
    stats.calls += 1; stats.replies += n;
    stats.input_tokens += usage?.input_tokens || 0; stats.output_tokens += usage?.output_tokens || 0; stats.cost += usage?.cost || 0;
    await chrome.storage.local.set({ stats });
  });
}

async function classify(msg) {
  const settings = await getSettings();
  const examples = await getExamples();
  const resp = settings.apiKey
    ? await callJev(settings.apiKey, msg.original, msg.replies, settings.categories, examples)
    : await viaProxy(settings, msg.original, msg.replies, examples);
  await recordUsage(resp.usage, msg.replies.length);
  return { verdicts: verdicts(resp.answers || {}, msg.replies.length, settings.threshold), mode: settings.apiKey ? "byok" : "proxy" };
}

async function getQuota() {
  const settings = await getSettings();
  const res = await fetch(`${settings.proxyUrl.replace(/\/$/, "")}/quota?id=${await installId()}`);
  return res.ok ? res.json() : null;
}

// ---------------- translation ----------------
function hash(s) {   // FNV-1a, cache key
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const today = () => new Date().toISOString().slice(0, 10);

function addTrStats(n, tokIn, tokOut) {
  return serialize(async () => {
    const { tstats } = await chrome.storage.local.get({ tstats: TR_EMPTY_STATS });
    const s = { ...TR_EMPTY_STATS, ...tstats };
    if (s.day !== today()) { s.day = today(); s.today = { n: 0, in: 0, out: 0 }; }
    for (const b of [s.today, s.total]) { b.n += n; b.in += tokIn; b.out += tokOut; }
    await chrome.storage.local.set({ tstats: s });
  });
}

// notify(index, text) fires as soon as each paragraph is complete in the stream; the full array is returned at the end.
async function translate(texts, notify) {
  const tr = await getTr();
  if (!tr.apiKey) return { error: "未配置翻译 API Key" };
  const keyOf = t => hash(`${tr.baseUrl}|${tr.model}|${t}`);
  const { tcache = {} } = await chrome.storage.local.get("tcache");
  const out = new Array(texts.length).fill(null);
  const miss = [];
  texts.forEach((t, i) => { const hit = tcache[keyOf(t)]; if (hit) { out[i] = hit.t; notify?.(i, hit.t); } else miss.push(i); });
  if (!miss.length) return { translations: out };

  let notified = 0, r;
  try {
    r = await XRF_LLM.chat(tr, miss.map(i => texts[i]), { stream: true, onContent: content => {
      if (!notify) return;
      const partial = XRF_LLM.parsePartial(content, miss.length);
      for (; notified < partial.length; notified++) { out[miss[notified]] = partial[notified]; notify(miss[notified], partial[notified]); }
    } });
  } catch (e) { return { error: e.message, translations: out }; }
  let arr = XRF_LLM.parseBatch(r.content, miss.length);
  if (!arr) { const partial = XRF_LLM.parsePartial(r.content, miss.length); if (partial.length === miss.length) arr = partial; }
  if (!arr) return { error: "模型返回的格式无法解析，请重试或换个模型", translations: out };

  const fresh = {};
  miss.forEach((i, j) => { out[i] = arr[j]; fresh[keyOf(texts[i])] = { t: arr[j], ts: Date.now() }; });
  await serialize(async () => {
    const { tcache: latest = {} } = await chrome.storage.local.get("tcache");
    Object.assign(latest, fresh);
    const keys = Object.keys(latest);
    if (keys.length > TR_CACHE_MAX) keys.sort((a, b) => latest[a].ts - latest[b].ts).slice(0, keys.length - TR_CACHE_MAX).forEach(k => delete latest[k]);
    await chrome.storage.local.set({ tcache: latest });
  });
  const usage = r.usage || { prompt_tokens: XRF_LLM.approxTokens(JSON.stringify(miss.map(i => texts[i]))), completion_tokens: XRF_LLM.approxTokens(r.content) };
  await addTrStats(miss.length, usage.prompt_tokens || 0, usage.completion_tokens || 0);
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
  return { configured: !!tr.apiKey, enabled: tr.enabled !== false, sites: tr.sites, mode: tr.mode, concurrency: tr.concurrency, batch: tr.batch, model: tr.model };
}

function setBadge(tabId, n) {
  chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0", tabId });
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : "", tabId });
}

const HANDLERS = {
  classify: msg => classify(msg),
  getQuota: () => getQuota(),
  openOptions: () => { chrome.runtime.openOptionsPage(); return Promise.resolve({ ok: true }); },
  count: (msg, sender) => { if (sender.tab) setBadge(sender.tab.id, msg.n); return Promise.resolve({ ok: true }); },
  translate: (msg, sender) => {
    const tabId = sender?.tab?.id;
    const notify = tabId != null && msg.reqId ? (index, text) => chrome.tabs.sendMessage(tabId, { type: "trPartial", reqId: msg.reqId, index, text }).catch(() => {}) : null;
    return translate(msg.texts || [], notify);
  },
  trConfig: () => trConfig(),
  trDefaults: () => Promise.resolve({ defaults: TR_DEFAULTS }),
  trTest: msg => trTest(msg.provider),
  trModels: msg => XRF_LLM.listModels(msg.provider).then(models => ({ models }), e => ({ error: e.message })),
  trClearCache: () => serialize(() => chrome.storage.local.remove("tcache")).then(() => ({ ok: true })),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, e => sendResponse({ error: String(e.message || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => { if (reason === "install") chrome.runtime.openOptionsPage(); });
