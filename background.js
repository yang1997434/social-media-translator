// Service worker: routes classification either to the free proxy (default) or directly to OpenRouter (BYO key).
importScripts("shared.js");
const { verdicts, callJev } = JEV_SHARED;

const DEFAULTS = { apiKey: "", threshold: 0.75, proxyUrl: "https://xrf.ship2market.ai",
  categories: { spam: true, bait: true, offtopic: true, slop: true } };
const EMPTY_STATS = { calls: 0, replies: 0, input_tokens: 0, output_tokens: 0, cost: 0 };

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s, categories: { ...DEFAULTS.categories, ...(s.categories || {}) } };
}

async function installId() {
  const { installId } = await chrome.storage.local.get("installId");
  if (installId) return installId;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ installId: id });
  return id;
}

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

async function recordUsage(usage, n) {
  const { stats } = await chrome.storage.local.get({ stats: EMPTY_STATS });
  stats.calls += 1; stats.replies += n;
  stats.input_tokens += usage?.input_tokens || 0; stats.output_tokens += usage?.output_tokens || 0; stats.cost += usage?.cost || 0;
  await chrome.storage.local.set({ stats });
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

function setBadge(tabId, n) {
  chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0", tabId });
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : "", tabId });
}

const HANDLERS = {
  classify: msg => classify(msg),
  getQuota: () => getQuota(),
  openOptions: () => { chrome.runtime.openOptionsPage(); return Promise.resolve({ ok: true }); },
  count: (msg, sender) => { if (sender.tab) setBadge(sender.tab.id, msg.n); return Promise.resolve({ ok: true }); },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, e => sendResponse({ error: String(e.message || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => { if (reason === "install") chrome.runtime.openOptionsPage(); });
