const $ = id => document.getElementById(id);
const CATS = ["spam", "bait", "offtopic", "slop"];
let tr = {};
let toastTimer = null;
function toast(msg = "已保存") { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1400); }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setChip = cb => cb.closest(".chip").classList.toggle("on", cb.checked);
function showResult(ok, html) { const r = $("tr_result"); r.className = "result show " + (ok ? "ok" : "bad"); r.innerHTML = html; }

// ---------------- translation ----------------
async function saveTr(patch) {
  const { tr: cur } = await chrome.storage.sync.get({ tr: {} });   // popup may have flipped the switch meanwhile
  tr = { ...tr, ...cur, ...patch, sites: { ...tr.sites, ...(cur.sites || {}), ...(patch.sites || {}) } };
  await chrome.storage.sync.set({ tr });
  toast();
}
const provider = () => ({ baseUrl: tr.baseUrl, apiKey: $("tr_apiKey").value.trim(), model: $("tr_model").value.trim() });

function renderTr() {
  $("tr_enabled").checked = tr.enabled !== false;
  $("tr_apiKey").value = tr.apiKey || ""; $("tr_model").value = tr.model || "";
  $("tr_mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === tr.mode));
  for (const s of ["x", "reddit"]) { const cb = $("tr_site_" + s); cb.checked = tr.sites?.[s] !== false; setChip(cb); }
}

// Model names autocomplete from the provider's /models, fetched quietly once a key is present.
const loadModels = debounce(async () => {
  const p = provider();
  if (!p.apiKey) return;
  const r = await chrome.runtime.sendMessage({ type: "trModels", provider: p }).catch(() => null);
  if (r?.models) $("tr_models").innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join("");
}, 400);

async function testTr() {
  const p = provider();
  if (!p.apiKey) return showResult(false, "先填 API Key");
  if (!p.model) return showResult(false, "先填模型名");
  const btn = $("tr_test"); btn.disabled = true; btn.textContent = "测试中…";
  const r = await chrome.runtime.sendMessage({ type: "trTest", provider: p }).catch(e => ({ ok: false, error: e.message }));
  btn.disabled = false; btn.textContent = "测试";
  if (!r?.ok) return showResult(false, "✗ " + esc(r?.error || "未知错误"));
  showResult(true, `✓ ${(r.totalMs / 1000).toFixed(1)}s · ${esc(r.sample).replace("[[0]]", "<b>@某人</b>")}${r.keepsPlaceholders === false ? `<br><span style="color:var(--warn)">该模型没保留占位符，链接 / 表情可能跑位，建议换模型</span>` : ""}`);
}

function bindTr() {
  $("tr_enabled").onchange = e => saveTr({ enabled: e.target.checked });
  $("tr_apiKey").oninput = debounce(() => { saveTr({ apiKey: $("tr_apiKey").value.trim() }); loadModels(); }, 500);
  $("tr_model").onchange = () => saveTr({ model: $("tr_model").value.trim() });
  $("tr_model").oninput = debounce(() => saveTr({ model: $("tr_model").value.trim() }), 600);
  $("tr_test").onclick = testTr;
  $("tr_mode").querySelectorAll("button").forEach(b => b.onclick = () => { saveTr({ mode: b.dataset.v }); $("tr_mode").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
  for (const s of ["x", "reddit"]) $("tr_site_" + s).onchange = e => { setChip(e.target); saveTr({ sites: { [s]: e.target.checked } }); };
}

async function renderTrFoot() {
  const { tstats } = await chrome.storage.local.get({ tstats: { day: "", today: { n: 0, in: 0, out: 0 }, total: { n: 0, in: 0, out: 0 } } });
  const t = tstats.day === new Date().toISOString().slice(0, 10) ? tstats.today : { n: 0, in: 0, out: 0 };
  const tot = tstats.total || { n: 0, in: 0, out: 0 };
  $("tr_foot").textContent = `今日翻译 ${fmt(t.n)} 段 · ${fmt(t.in + t.out)} tokens　累计 ${fmt(tot.n)} 段 · ${fmt(tot.in + tot.out)} tokens`;
}

// ---------------- filter ----------------
async function saveF(patch) { await chrome.storage.sync.set(patch); toast(); }

async function renderF() {
  const s = await chrome.storage.sync.get({ enabled: true, threshold: 0.75, categories: {}, blockedHandles: [] });
  $("f_enabled").checked = s.enabled !== false;
  $("f_threshold").value = s.threshold; $("f_thresholdOut").value = s.threshold.toFixed(2);
  CATS.forEach(c => { const cb = $("c_" + c); cb.checked = s.categories[c] !== false; setChip(cb); });
  const box = $("f_blocked"); box.textContent = "";
  $("f_blockedRow").hidden = !s.blockedHandles.length;
  s.blockedHandles.forEach(h => {
    const chip = document.createElement("span"); chip.className = "chip on"; chip.title = "取消屏蔽";
    chip.innerHTML = `@${esc(h)}<span class="x">×</span>`;
    chip.onclick = async () => { await saveF({ blockedHandles: s.blockedHandles.filter(x => x !== h) }); renderF(); };
    box.appendChild(chip);
  });
}
function bindF() {
  $("f_enabled").onchange = e => saveF({ enabled: e.target.checked });
  $("f_threshold").oninput = e => { $("f_thresholdOut").value = Number(e.target.value).toFixed(2); };
  $("f_threshold").onchange = e => saveF({ threshold: Number(e.target.value) });
  CATS.forEach(c => $("c_" + c).onchange = async e => { setChip(e.target);
    const { categories } = await chrome.storage.sync.get({ categories: {} }); saveF({ categories: { ...categories, [c]: e.target.checked } }); });
}
async function renderFFoot() {
  const { stats, quota } = await chrome.storage.local.get({ stats: { calls: 0, replies: 0 }, quota: null });
  $("f_foot").textContent = `已判定 ${fmt(stats.replies)} 条回复　免费额度${quota ? ` 今日 ${quota.used} / ${quota.limit}` : " 每天 300 条"}`;
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

async function confirmRecent(r, kind) {
  const { examples, recent } = await chrome.storage.local.get({ examples: { bad: [], good: [] }, recent: [] });
  const other = kind === "bad" ? "good" : "bad";
  examples[other] = examples[other].filter(e => e.id !== r.id);
  examples[kind] = [...examples[kind].filter(e => e.id !== r.id), { id: r.id, t: r.t, h: r.h, ts: Date.now() }].slice(-30);
  await chrome.storage.local.set({ examples, recent: recent.filter(x => x.id !== r.id), ["v:" + r.id]: kind === "bad" ? { cat: "user", p: 1 } : null, ["keep:" + r.id]: kind === "good" });
}

async function renderLearn() {
  const { examples, recent } = await chrome.storage.local.get({ examples: { bad: [], good: [] }, recent: [] });
  const all = [...examples.bad.map(e => ["bad", e]), ...examples.good.map(e => ["good", e])].sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  $("learn").hidden = !recent.length && !all.length;
  $("recentWrap").hidden = !recent.length; $("examplesWrap").hidden = !all.length;
  const rb = $("recent"); rb.textContent = "";
  [...recent].reverse().forEach(r => rb.appendChild(row(r.reason + (r.p ? ` ${Math.round(r.p * 100)}%` : ""), "", `@${r.h}: ${r.t}`,
    [["对，不想看", "var(--bad)", () => confirmRecent(r, "bad")], ["判错了，保留", "var(--ok)", () => confirmRecent(r, "good")]])));
  const eb = $("examples"); eb.textContent = "";
  all.forEach(([k, e]) => eb.appendChild(row(k === "bad" ? "不想看" : "想保留", k === "bad" ? "bad" : "ok", `@${e.h}: ${e.t}`, [["删除", "var(--muted)", async () => {
    const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
    examples[k] = examples[k].filter(x => x.id !== e.id);
    await chrome.storage.local.set({ examples, ["v:" + e.id]: null, ["keep:" + e.id]: false }); }]])));
}

// ---------------- init ----------------
async function init() {
  const { defaults } = await chrome.runtime.sendMessage({ type: "trDefaults" });
  const { tr: saved } = await chrome.storage.sync.get({ tr: {} });
  tr = { ...defaults, ...saved, baseUrl: defaults.baseUrl, sites: { ...defaults.sites, ...(saved.sites || {}) } };
  renderTr(); bindTr(); renderTrFoot(); loadModels();
  await renderF(); bindF(); renderFFoot();
  renderLearn();
  // Live updates: marking a reply on x.com or a translation finishing shows up here without reloading.
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local") { if (ch.examples || ch.recent) renderLearn(); if (ch.stats || ch.quota) renderFFoot(); if (ch.tstats) renderTrFoot(); }
    if (area === "sync" && ch.blockedHandles) renderF();
  });
}
init();
