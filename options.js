const $ = id => document.getElementById(id);
const CATS = ["spam", "bait", "offtopic", "slop"];
let tr = {};
let toastTimer = null;
function toast(msg = "已保存") { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1400); }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setChip = cb => cb.closest(".chip").classList.toggle("on", cb.checked);
function showResult(ok, html, id = "tr_result") { const r = $(id); r.className = "result show " + (ok ? "ok" : "bad"); r.innerHTML = html; }

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
  const saveModel = async () => { const m = $("tr_model").value.trim(); await saveTr({ model: m }); applyKnownPrice(m); };
  $("tr_model").onchange = saveModel;
  $("tr_model").oninput = debounce(saveModel, 600);
  $("tr_priceToggle").onclick = () => { $("tr_priceRow").hidden = !$("tr_priceRow").hidden; };
  for (const k of ["priceIn", "priceOut"]) $("tr_" + k).onchange = e => saveTr({ [k]: Math.max(0, Number(e.target.value) || 0) }).then(renderTrFoot);
  $("tr_test").onclick = testTr;
  $("tr_mode").querySelectorAll("button").forEach(b => b.onclick = () => { saveTr({ mode: b.dataset.v }); $("tr_mode").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
  for (const s of ["x", "reddit"]) $("tr_site_" + s).onchange = e => { setChip(e.target); saveTr({ sites: { [s]: e.target.checked } }); };
}

// SiliconFlow list prices, ¥ per million tokens (siliconflow.cn/pricing, 2026-09). Other models: type them in.
const PRICES = { "Qwen/Qwen3.5-35B-A3B": [0.4, 3.2], "Qwen/Qwen3.6-35B-A3B": [1.8, 10.8] };
const price = () => ({ pin: Number(tr.priceIn) || 0, pout: Number(tr.priceOut) || 0 });
const cost = b => { const { pin, pout } = price(); return (b.in * pin + b.out * pout) / 1e6; };

async function renderTrFoot() {
  const { tstats } = await chrome.storage.local.get({ tstats: { day: "", today: { n: 0, in: 0, out: 0 }, total: { n: 0, in: 0, out: 0 } } });
  const t = tstats.day === new Date().toISOString().slice(0, 10) ? tstats.today : { n: 0, in: 0, out: 0 };
  const tot = tstats.total || { n: 0, in: 0, out: 0 };
  const { pin, pout } = price();
  const line = (k, b) => `${k} ${fmt(b.n)} 段 · ${fmt(b.in + b.out)} tokens${pin || pout ? ` · ¥${cost(b).toFixed(3)}` : ""}`;
  $("tr_foot").textContent = `${line("今日", t)}　${line("累计", tot)}`;
  $("tr_priceIn").value = pin || ""; $("tr_priceOut").value = pout || "";
}
// Known model → fill its list price; unknown → keep whatever the user typed.
function applyKnownPrice(model) { const p = PRICES[model]; if (p) return saveTr({ priceIn: p[0], priceOut: p[1] }).then(renderTrFoot); }

// ---------------- filter ----------------
async function saveF(patch) { await chrome.storage.sync.set(patch); toast(); }

async function renderF() {
  const s = await chrome.storage.sync.get({ enabled: true, apiKey: "", threshold: 0.75, categories: {}, blockedHandles: [] });
  $("f_enabled").checked = s.enabled !== false; $("f_apiKey").value = s.apiKey;
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
  $("f_apiKey").oninput = debounce(() => saveF({ apiKey: $("f_apiKey").value.trim() }).then(renderFFoot), 500);
  $("f_test").onclick = async () => {
    const apiKey = $("f_apiKey").value.trim();
    if (!apiKey) return showResult(false, "先填 jev Key", "f_result");
    const btn = $("f_test"); btn.disabled = true; btn.textContent = "测试中…";
    const r = await chrome.runtime.sendMessage({ type: "jevTest", apiKey }).catch(e => ({ ok: false, error: e.message }));
    btn.disabled = false; btn.textContent = "测试";
    if (!r?.ok) return showResult(false, "✗ " + esc(r?.error || "未知错误"), "f_result");
    showResult(true, `✓ ${r.model || "jev"} · ${r.ms}ms · 样例回复「AI 交易机器人本周赚了 40%」判定为推广的概率 ${Math.round((r.spam || 0) * 100)}%`, "f_result");
  };
  $("f_threshold").oninput = e => { $("f_thresholdOut").value = Number(e.target.value).toFixed(2); };
  $("f_threshold").onchange = e => saveF({ threshold: Number(e.target.value) });
  CATS.forEach(c => $("c_" + c).onchange = async e => { setChip(e.target);
    const { categories } = await chrome.storage.sync.get({ categories: {} }); saveF({ categories: { ...categories, [c]: e.target.checked } }); });
}
async function renderFFoot() {
  const { stats, quota } = await chrome.storage.local.get({ stats: { calls: 0, replies: 0, input_tokens: 0, output_tokens: 0, cost: 0 }, quota: null });
  const { apiKey } = await chrome.storage.sync.get({ apiKey: "" });
  $("f_foot").textContent = `已判定 ${fmt(stats.replies)} 条 · ${fmt(stats.input_tokens + stats.output_tokens)} tokens${stats.cost ? ` · $${stats.cost.toFixed(4)}` : ""}　${apiKey ? "TypeSafe 直连 · 不限量" : `免费额度${quota ? ` 今日 ${quota.used} / ${quota.limit}` : " 每天 300 条"}`}`;
}

// ---------------- init ----------------
async function init() {
  const { defaults } = await chrome.runtime.sendMessage({ type: "trDefaults" });
  const { tr: saved } = await chrome.storage.sync.get({ tr: {} });
  tr = { ...defaults, ...saved, baseUrl: defaults.baseUrl, sites: { ...defaults.sites, ...(saved.sites || {}) } };
  if (tr.priceIn == null && PRICES[tr.model]) [tr.priceIn, tr.priceOut] = PRICES[tr.model];
  renderTr(); bindTr(); renderTrFoot(); loadModels();
  await renderF(); bindF(); renderFFoot();
  // Live updates: marking a reply on x.com or a translation finishing shows up here without reloading.
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local") { if (ch.stats || ch.quota) renderFFoot(); if (ch.tstats) renderTrFoot(); }
    if (area === "sync" && ch.blockedHandles) renderF();
  });
}
init();
