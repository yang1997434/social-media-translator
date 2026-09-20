const $ = id => document.getElementById(id);
const CATS = ["spam", "bait", "offtopic", "slop"];
const KEY_LINKS = { siliconflow: ["cloud.siliconflow.cn/account/ak", "https://cloud.siliconflow.cn/account/ak"], openrouter: ["openrouter.ai/keys", "https://openrouter.ai/keys"], custom: ["服务商控制台", "#"] };
let PRESETS = {}, tr = {};
let toastTimer = null;
function toast(msg = "已保存") { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1400); }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const lines = id => $(id).value.split("\n").map(x => x.trim()).filter(Boolean);
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(n);

// ---------------- translation ----------------
async function saveTr(patch) {
  const { tr: cur } = await chrome.storage.sync.get({ tr: {} });   // popup may have flipped a switch meanwhile
  tr = { ...tr, ...cur, ...patch, sites: { ...tr.sites, ...(cur.sites || {}), ...(patch.sites || {}) } };
  await chrome.storage.sync.set({ tr });
  toast();
}
const trProvider = () => ({ baseUrl: $("tr_baseUrl").value.trim(), apiKey: $("tr_apiKey").value.trim(), model: $("tr_model").value.trim() });

function renderTrForm() {
  $("tr_enabled").checked = tr.enabled !== false;
  $("tr_preset").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === tr.preset));
  $("tr_baseUrl").value = tr.baseUrl || ""; $("tr_baseUrl").readOnly = tr.preset !== "custom";
  $("tr_urlHint").textContent = tr.preset === "custom" ? "任何 OpenAI 兼容接口（/chat/completions），填到 /v1 为止" : "预设地址，选「自定义」可改";
  $("tr_apiKey").value = tr.apiKey || ""; $("tr_model").value = tr.model || "";
  const [txt, href] = KEY_LINKS[tr.preset] || KEY_LINKS.custom; $("tr_keyLink").textContent = txt; $("tr_keyLink").href = href;
  $("tr_mode").querySelectorAll("label").forEach(l => { const on = l.dataset.v === tr.mode; l.classList.toggle("on", on); l.querySelector("input").checked = on; });
  for (const s of ["x", "reddit"]) { const cb = $("tr_site_" + s); cb.checked = tr.sites?.[s] !== false; cb.closest(".chip").classList.toggle("on", cb.checked); }
  $("tr_concurrency").value = tr.concurrency; $("tr_batch").value = tr.batch; $("tr_priceIn").value = tr.priceIn || 0; $("tr_priceOut").value = tr.priceOut || 0;
  checkPermission();
}

// Custom base URLs need a host permission that isn't in the manifest; request it from a click (test button) when missing.
async function originOf(url) { try { return new URL(url).origin + "/*"; } catch { return null; } }
async function checkPermission() {
  const note = $("tr_permNote"); note.textContent = "";
  const origin = await originOf($("tr_baseUrl").value.trim());
  if (!origin || !chrome.permissions) return;
  const ok = await chrome.permissions.contains({ origins: [origin] }).catch(() => true);
  if (!ok) note.textContent = "首次使用自定义地址需要授权访问，点「测试连接」会弹出授权";
}
async function ensurePermission() {
  const origin = await originOf($("tr_baseUrl").value.trim());
  if (!origin || !chrome.permissions) return true;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  checkPermission();
  return granted;
}

function showResult(id, ok, html) { const r = $(id); r.className = "result show " + (ok ? "ok" : "bad"); r.innerHTML = html; }

async function testTr() {
  const p = trProvider();
  if (!p.baseUrl || !p.apiKey || !p.model) return showResult("tr_result", false, "请先填 Base URL、API Key 和模型");
  if (!(await ensurePermission())) return showResult("tr_result", false, "未授权访问该地址");
  const btn = $("tr_test"); btn.disabled = true; btn.textContent = "测试中…";
  const r = await chrome.runtime.sendMessage({ type: "trTest", provider: p }).catch(e => ({ ok: false, error: e.message }));
  btn.disabled = false; btn.textContent = "测试连接";
  if (r?.ok) showResult("tr_result", true, `✓ 可用 · 首字 ${r.ttfbMs}ms · 总耗时 ${r.totalMs}ms${r.tps ? ` · ${r.tps} tok/s` : ""}<br><span class="muted">样例：${escapeHtml(r.sample).replace("[[0]]", "<b>@某人</b>")}</span>${r.keepsPlaceholders === false ? `<br><span style="color:var(--warn)">⚠ 该模型没有保留占位符，链接 / 表情可能会跑到句尾，建议换个模型</span>` : ""}`);
  else showResult("tr_result", false, "✗ " + escapeHtml(r?.error || "未知错误"));
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

async function listModels() {
  const p = trProvider();
  if (!p.baseUrl || !p.apiKey) return showResult("tr_result", false, "先填 Base URL 和 API Key");
  if (!(await ensurePermission())) return showResult("tr_result", false, "未授权访问该地址");
  const btn = $("tr_listModels"); btn.disabled = true; btn.textContent = "获取中…";
  const r = await chrome.runtime.sendMessage({ type: "trModels", provider: p }).catch(e => ({ error: e.message }));
  btn.disabled = false; btn.textContent = "获取模型列表";
  if (r?.error) return showResult("tr_result", false, "✗ " + escapeHtml(r.error));
  $("tr_models").innerHTML = r.models.map(m => `<option value="${escapeHtml(m)}">`).join("");
  const cur = p.model, has = r.models.includes(cur);
  const qwen = r.models.filter(m => /qwen3\.5|qwen3/i.test(m)).slice(0, 6);
  showResult("tr_result", true, `✓ 共 ${r.models.length} 个模型，输入框已可补全${cur && !has ? `<br><span style="color:var(--warn)">当前填的「${escapeHtml(cur)}」不在列表里，检查拼写</span>` : ""}${qwen.length ? `<br><span class="muted">Qwen 系：${qwen.map(escapeHtml).join(" · ")}</span>` : ""}`);
}

function bindTr() {
  $("tr_enabled").onchange = e => saveTr({ enabled: e.target.checked });
  $("tr_preset").querySelectorAll("button").forEach(b => b.onclick = () => {
    const v = b.dataset.v, p = PRESETS[v] || {};
    saveTr({ preset: v, baseUrl: v === "custom" ? tr.baseUrl : p.baseUrl, model: p.model || tr.model }).then(renderTrForm);
  });
  $("tr_baseUrl").oninput = debounce(() => { saveTr({ baseUrl: $("tr_baseUrl").value.trim() }); checkPermission(); }, 500);
  $("tr_apiKey").oninput = debounce(() => saveTr({ apiKey: $("tr_apiKey").value.trim() }), 500);
  $("tr_model").onchange = () => saveTr({ model: $("tr_model").value.trim() });
  $("tr_model").oninput = debounce(() => saveTr({ model: $("tr_model").value.trim() }), 600);
  $("tr_eye").onclick = () => togglePw("tr_apiKey", "tr_eye");
  $("tr_test").onclick = testTr; $("tr_listModels").onclick = listModels;
  $("tr_mode").querySelectorAll("input").forEach(r => r.onchange = () => { saveTr({ mode: r.value }); renderTrForm(); });
  for (const s of ["x", "reddit"]) $("tr_site_" + s).onchange = e => { e.target.closest(".chip").classList.toggle("on", e.target.checked); saveTr({ sites: { [s]: e.target.checked } }); };
  for (const k of ["concurrency", "batch"]) $("tr_" + k).onchange = e => saveTr({ [k]: Math.max(1, Number(e.target.value) || 1) });
  for (const k of ["priceIn", "priceOut"]) $("tr_" + k).onchange = e => { saveTr({ [k]: Math.max(0, Number(e.target.value) || 0) }); renderTrStats(); };
  $("tr_clearCache").onclick = async () => { await chrome.runtime.sendMessage({ type: "trClearCache" }); toast("翻译缓存已清空"); };
}
function togglePw(inputId, btnId) { const i = $(inputId); i.type = i.type === "password" ? "text" : "password"; $(btnId).textContent = i.type === "password" ? "显示" : "隐藏"; }

async function renderTrStats() {
  const { tstats } = await chrome.storage.local.get({ tstats: { today: { n: 0, in: 0, out: 0 }, total: { n: 0, in: 0, out: 0 }, day: "" } });
  const todayIs = new Date().toISOString().slice(0, 10);
  const t = tstats.day === todayIs ? tstats.today : { n: 0, in: 0, out: 0 };
  const cost = b => (b.in * (tr.priceIn || 0) + b.out * (tr.priceOut || 0)) / 1e6;
  const box = (k, b) => `<div class="stat"><div class="v num">${fmt(b.n)} <span style="font-size:13px;font-weight:500">段</span></div><div class="k">${k} · ${fmt(b.in + b.out)} tokens${tr.priceIn || tr.priceOut ? ` · ≈¥${cost(b).toFixed(3)}` : ""}</div></div>`;
  $("tr_stats").innerHTML = box("今日", t) + box("累计", tstats.total || { n: 0, in: 0, out: 0 });
}

// ---------------- filter ----------------
async function saveF(patch) { await chrome.storage.sync.set(patch); toast(); renderFMode(); }

async function renderFForm() {
  const s = await chrome.storage.sync.get({ enabled: true, apiKey: "", threshold: 0.75, categories: {}, customKeywords: [], blockedHandles: [] });
  $("f_enabled").checked = s.enabled !== false; $("f_apiKey").value = s.apiKey;
  $("f_threshold").value = s.threshold; $("f_thresholdOut").value = s.threshold.toFixed(2);
  CATS.forEach(c => { const cb = $("c_" + c); cb.checked = s.categories[c] !== false; cb.closest(".chip").classList.toggle("on", cb.checked); });
  $("f_keywords").value = s.customKeywords.join("\n"); $("f_handles").value = s.blockedHandles.join("\n");
  renderFMode();
}
async function renderFMode() {
  const { apiKey } = await chrome.storage.sync.get({ apiKey: "" });
  const { quota } = await chrome.storage.local.get({ quota: null });
  $("f_mode").innerHTML = apiKey ? `<span class="tag acc">自带 key</span> 直连 OpenRouter · TypeSafe jev · 不限量`
    : `<span class="tag ok">免费额度</span> 经 xrf.ship2market.ai 中转${quota ? ` · 今日已用 <b>${quota.used}</b> / ${quota.limit} 条` : " · 每天 300 条回复"}`;
}
function bindF() {
  $("f_enabled").onchange = e => saveF({ enabled: e.target.checked });
  $("f_apiKey").oninput = debounce(() => saveF({ apiKey: $("f_apiKey").value.trim() }), 500);
  $("f_eye").onclick = () => togglePw("f_apiKey", "f_eye");
  $("f_threshold").oninput = e => { $("f_thresholdOut").value = Number(e.target.value).toFixed(2); };
  $("f_threshold").onchange = e => saveF({ threshold: Number(e.target.value) });
  CATS.forEach(c => $("c_" + c).onchange = async e => { e.target.closest(".chip").classList.toggle("on", e.target.checked);
    const { categories } = await chrome.storage.sync.get({ categories: {} }); saveF({ categories: { ...categories, [c]: e.target.checked } }); });
  $("f_keywords").oninput = debounce(() => saveF({ customKeywords: lines("f_keywords") }), 600);
  $("f_handles").oninput = debounce(() => saveF({ blockedHandles: lines("f_handles").map(h => h.replace(/^@/, "")) }), 600);
}

async function renderFStats() {
  const { stats } = await chrome.storage.local.get({ stats: { calls: 0, replies: 0, input_tokens: 0, output_tokens: 0, cost: 0 } });
  $("f_stats").innerHTML = `<div class="stat"><div class="v num">${fmt(stats.replies)}</div><div class="k">判定回复 · ${stats.calls} 次调用</div></div>
    <div class="stat"><div class="v num">${fmt(stats.input_tokens + stats.output_tokens)}</div><div class="k">tokens · $${stats.cost.toFixed(4)}</div></div>`;
}

async function exportLog() {
  const { stats } = await chrome.storage.local.get("stats");
  const rec = { ts: new Date().toISOString(), label: "x-reply-filter", channel: "openrouter", id: null, model: "~typesafe/jev-latest",
    input_tokens: stats?.input_tokens || 0, output_tokens: stats?.output_tokens || 0, cost: stats?.cost || 0, questions: stats?.replies || 0 };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(rec) + "\n"], { type: "application/json" }));
  a.download = "x-reply-filter.jsonl"; a.click();
}
async function clearVerdicts() {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith("v:")));
  toast("判定缓存已清空");
}

// ---------------- learning: review queue + examples ----------------
function row(tagText, tagCls, text, acts) {
  const r = document.createElement("div"); r.className = "list-row";
  const tag = document.createElement("span"); tag.className = "tag " + tagCls; tag.textContent = tagText;
  const t = document.createElement("span"); t.className = "txt"; t.textContent = text;
  const a = document.createElement("span"); a.className = "acts";
  acts.forEach(([label, color, fn]) => { const x = document.createElement("a"); x.textContent = label; x.style.color = color; x.onclick = fn; a.appendChild(x); });
  r.append(tag, t, a); return r;
}

async function renderExamples() {
  const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
  const box = $("examples"); box.textContent = "";
  $("exCount").textContent = `· 不想看 ${examples.bad.length} · 想保留 ${examples.good.length}`;
  const all = [...examples.bad.map(e => ["bad", e]), ...examples.good.map(e => ["good", e])].sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  if (!all.length) { box.innerHTML = `<div class="empty">还没有例子。在推文页把鼠标悬停在一条回复上，点右上角的「隐藏」；或在上面的待确认列表里点「对，不想看」。</div>`; return; }
  all.forEach(([k, e]) => box.appendChild(row(k === "bad" ? "不想看" : "想保留", k === "bad" ? "bad" : "ok", `@${e.h}: ${e.t}`, [["删除", "var(--muted)", async () => {
    const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
    examples[k] = examples[k].filter(x => x.id !== e.id);
    await chrome.storage.local.set({ examples, ["v:" + e.id]: null, ["keep:" + e.id]: false }); renderExamples(); }]])));
}

async function confirmRecent(r, kind) {
  const { examples, recent } = await chrome.storage.local.get({ examples: { bad: [], good: [] }, recent: [] });
  const other = kind === "bad" ? "good" : "bad";
  examples[other] = examples[other].filter(e => e.id !== r.id);
  examples[kind] = [...examples[kind].filter(e => e.id !== r.id), { id: r.id, t: r.t, h: r.h, ts: Date.now() }].slice(-30);
  await chrome.storage.local.set({ examples, recent: recent.filter(x => x.id !== r.id), ["v:" + r.id]: kind === "bad" ? { cat: "user", p: 1 } : null, ["keep:" + r.id]: kind === "good" });
}
async function renderRecent() {
  const { recent } = await chrome.storage.local.get({ recent: [] });
  const box = $("recent"); box.textContent = "";
  if (!recent.length) { box.innerHTML = `<div class="empty">暂无。打开一条推文的评论区，被自动折叠的回复会出现在这里。</div>`; return; }
  [...recent].reverse().forEach(r => box.appendChild(row(r.reason + (r.p ? ` ${Math.round(r.p * 100)}%` : ""), "", `@${r.h}: ${r.t}`,
    [["对，不想看", "var(--bad)", () => confirmRecent(r, "bad")], ["判错了，保留", "var(--ok)", () => confirmRecent(r, "good")]])));
}

// ---------------- init ----------------
async function init() {
  const { presets, defaults } = await chrome.runtime.sendMessage({ type: "trPresets" });
  PRESETS = presets;
  const { tr: saved } = await chrome.storage.sync.get({ tr: {} });
  tr = { ...defaults, ...saved, sites: { ...defaults.sites, ...(saved.sites || {}) } };
  renderTrForm(); bindTr(); renderTrStats();
  await renderFForm(); bindF(); renderFStats();
  renderRecent(); renderExamples();
  $("clearExamples").onclick = async () => { await chrome.storage.local.set({ examples: { bad: [], good: [] } }); renderExamples(); toast("例子已清空"); };
  $("export").onclick = exportLog; $("clearVerdicts").onclick = clearVerdicts;
  // Live updates: marking a reply on x.com, or a translation finishing, shows up here without reloading.
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.examples || ch.recent) { renderExamples(); renderRecent(); }
    if (ch.stats) renderFStats(); if (ch.tstats) renderTrStats(); if (ch.quota) renderFMode();
  });
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}
init();
