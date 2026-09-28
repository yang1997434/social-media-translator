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
let PROVIDERS = {};   // from the worker (trDefaults): host, default model, thinking switch, list prices
// A stale worker (files updated on disk, extension not yet reloaded) answers without a provider table: render an
// inert page with a hint instead of throwing on the first field.
const STALE = { name: "", baseUrl: "", model: "", thinking: "", keyHint: "请先在 chrome://extensions 重新加载扩展", keyUrl: "#", prices: {} };
const P = () => PROVIDERS[tr.provider] || Object.values(PROVIDERS)[0] || STALE;
const curModel = () => tr.models?.[tr.provider] || P().model;
async function saveTr(patch) {
  const { tr: cur } = await chrome.storage.sync.get({ tr: {} });   // popup may have flipped the switch meanwhile
  tr = { ...tr, ...cur, ...patch, sites: { ...tr.sites, ...(cur.sites || {}), ...(patch.sites || {}) },
    keys: { ...tr.keys, ...(cur.keys || {}), ...(patch.keys || {}) }, models: { ...tr.models, ...(cur.models || {}), ...(patch.models || {}) } };
  await chrome.storage.sync.set({ tr });
  toast();
}
// The provider row as llm.js wants it (thinking switch, temperature rule, extra headers). The key is the one stored for this
// provider, never a just-pasted one whose owner isn't settled: that one must not reach another company's host.
const provider = () => ({ ...P(), baseUrl: tr.provider === "custom" ? $("tr_base").value.trim() : P().baseUrl, apiKey: tr.keys?.[tr.provider] || "", model: $("tr_model").value.trim() });
// What is typed in the key field but not yet stored for the current provider.
const pendingKey = () => { const k = $("tr_apiKey").value.trim(); return k !== (tr.keys?.[tr.provider] || "") ? k : ""; };

// The provider list, grouped: 国内厂商 / 海外厂商 / 其他 (the custom OpenAI-compatible endpoint).
function buildProviders() {
  const groups = { cn: "国内厂商", intl: "海外厂商", other: "其他" };
  $("tr_provider").innerHTML = Object.entries(groups).map(([g, label]) => {
    const opts = Object.entries(PROVIDERS).filter(([, p]) => (p.group || "other") === g).map(([id, p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join("");
    return opts ? `<optgroup label="${label}">${opts}</optgroup>` : "";
  }).join("");
}

function renderTr() {
  $("tr_enabled").checked = tr.enabled !== false;
  $("tr_provider").value = tr.provider;
  $("tr_apiKey").value = tr.keys?.[tr.provider] || "";
  $("tr_keyUrl").href = P().keyUrl || "#"; $("tr_keyUrl").hidden = !P().keyUrl;
  $("tr_baseRow").hidden = tr.provider !== "custom"; $("tr_base").value = tr.customBase || "";
  $("tr_model").value = curModel();
  $("tr_mode").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === tr.mode));
  for (const s of ["x", "reddit"]) { const cb = $("tr_site_" + s); cb.checked = tr.sites?.[s] !== false; setChip(cb); }
  $("tr_fab").checked = tr.fab !== false; setChip($("tr_fab"));
}

// Model names autocomplete from the provider's /models, fetched quietly once a key is present.
const loadModels = debounce(async () => {
  const p = provider();
  $("tr_models").innerHTML = "";
  if (!p.apiKey || !p.baseUrl) return;
  const r = await chrome.runtime.sendMessage({ type: "trModels", provider: p }).catch(() => null);
  if (r?.models) setModels(r.models);
}, 400);
const setModels = models => { $("tr_models").innerHTML = models.map(m => `<option value="${esc(m)}">`).join(""); };

// ---- which provider a pasted key belongs to ----
// Resolves true once the key is stored for a provider; false while the user still has to say whose it is.
function setDetect(cls, html = "") { const d = $("tr_detect"); d.className = "detect " + cls; d.innerHTML = html; }
let detectSeq = 0;
async function onKey() {
  const key = $("tr_apiKey").value.trim();
  if (key === (tr.keys?.[tr.provider] || "")) return;
  // Cleared, or typed for the custom endpoint the user chose: stored as is. Too short to be a key yet: wait.
  if (!key || tr.provider === "custom") { await saveTr({ keys: { [tr.provider]: key } }); loadModels(); return; }
  if (key.length >= 16) detect(key);
}
async function detect(key, company) {
  const seq = ++detectSeq;
  setDetect("", "识别中…");
  const r = await chrome.runtime.sendMessage({ type: "trDetect", key, company }).catch(e => ({ error: e.message }));
  if (seq !== detectSeq || key !== $("tr_apiKey").value.trim()) return false;   // the field changed meanwhile
  if (r?.choices) {
    // The shape fits several companies: the key is not sent anywhere until the user says whose it is.
    setDetect("", `这个 Key 可能来自<span class="pick">${r.choices.map(c => `<button type="button" data-c="${esc(c.company)}">${esc(c.name)}</button>`).join("")}</span>`);
    $("tr_detect").querySelectorAll("button").forEach(b => b.onclick = () => detect(key, b.dataset.c));
    return false;
  }
  if (!r?.provider) {
    // Not stored under whatever happens to be selected: picking a provider below carries the key over.
    setDetect("warn", "没认出这个 Key 的格式：在下面选一下它属于哪家服务商；列表里没有就选「其他（OpenAI 兼容）」填接口地址");
    return false;
  }
  const id = r.provider, switched = id !== tr.provider;
  await saveTr({ provider: id, keys: { [id]: key }, models: { [id]: tr.models?.[id] || r.model || PROVIDERS[id].model }, ...(switched ? { priceIn: null, priceOut: null } : {}) });
  renderTr(); $("tr_result").className = "result";
  if (r.models) setModels(r.models); else loadModels();
  applyKnownPrice(curModel()); renderTrFoot();
  const name = esc(PROVIDERS[id].name);
  if (r.error === "rejected") setDetect("bad", `是${name}的 Key，但被拒绝了：${esc(r.detail || "")}。检查一下是否复制完整`);
  else if (r.unverified) setDetect("warn", `按格式识别为${name}，暂时没能连上验证（${esc(r.unverified)}），可以点「测试」`);
  else setDetect("ok", `✓ ${name}${switched ? "，已切换" : ""} · ${r.models ? r.models.length + " 个可用模型" : ""}`);
  return r.error !== "rejected";
}

async function testTr() {
  const typed = pendingKey();   // pasted and Test clicked before detection ran: settle whose key it is first
  if (typed) { if (tr.provider === "custom") await saveTr({ keys: { custom: typed } }); else if (!(await detect(typed))) return; }
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
  $("tr_provider").onchange = async e => {
    const id = e.target.value;
    if (id === tr.provider) return;
    const typed = pendingKey();   // a key pasted before picking its provider belongs to the one just picked
    detectSeq++; setDetect("");
    await saveTr({ provider: id, priceIn: null, priceOut: null, ...(typed ? { keys: { [id]: typed } } : {}) });
    renderTr(); $("tr_result").className = "result"; loadModels(); applyKnownPrice(curModel()); renderTrFoot();
  };
  const keyChanged = debounce(onKey, 600);
  $("tr_apiKey").oninput = () => { detectSeq++; setDetect(""); keyChanged(); };   // the old verdict is about the old key
  $("tr_base").oninput = debounce(() => { saveTr({ customBase: $("tr_base").value.trim() }); loadModels(); }, 600);
  const saveModel = async () => { const m = $("tr_model").value.trim(); await saveTr({ models: { [tr.provider]: m } }); applyKnownPrice(m); };
  $("tr_model").onchange = saveModel;
  $("tr_model").oninput = debounce(saveModel, 600);
  $("tr_priceToggle").onclick = () => { $("tr_priceRow").hidden = !$("tr_priceRow").hidden; };
  for (const k of ["priceIn", "priceOut"]) $("tr_" + k).onchange = e => saveTr({ [k]: Math.max(0, Number(e.target.value) || 0) }).then(renderTrFoot);
  $("tr_test").onclick = testTr;
  $("tr_mode").querySelectorAll("button").forEach(b => b.onclick = () => { saveTr({ mode: b.dataset.v }); $("tr_mode").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
  for (const s of ["x", "reddit"]) $("tr_site_" + s).onchange = e => { setChip(e.target); saveTr({ sites: { [s]: e.target.checked } }); };
  $("tr_fab").onchange = e => { setChip(e.target); saveTr({ fab: e.target.checked }); };
}

const price = () => { const p = (Number(tr.priceIn) || Number(tr.priceOut)) ? [Number(tr.priceIn) || 0, Number(tr.priceOut) || 0] : P().prices[curModel()] || [0, 0]; return { pin: p[0], pout: p[1] }; };
const cost = b => { if (typeof b.cost === "number") return b.cost; const { pin, pout } = price(); return (b.in * pin + b.out * pout) / 1e6; };

const ago = ts => { if (!ts) return "较早"; const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`; };
async function renderTrFoot() {
  const { tstats, devices } = await chrome.runtime.sendMessage({ type: "usage" }).catch(() => null) || {};   // every device on this Chrome account
  const zero = { n: 0, in: 0, out: 0 };
  const t = tstats?.today || zero, tot = tstats?.total || zero;
  const { pin, pout } = price();
  const line = (k, b) => `${k} ${fmt(b.n)} 段 · ${fmt(b.in + b.out)} tokens${pin || pout || typeof b.cost === "number" ? ` · ¥${cost(b).toFixed(3)}` : ""}`;
  $("tr_foot").textContent = `${line("今日", t)}　${line("累计", tot)}`;
  // Whether other computers are being counted, and how fresh their numbers are.
  const others = devices?.others || [];
  $("tr_sync").textContent = others.length
    ? `${others.length + 1} 台设备合计：另${others.length > 1 ? ` ${others.length} 台分别` : "一台"} ${others.map(ago).join("、")}更新`
    : "只统计到本机。多台电脑合计需要：登录同一个 Chrome 账号、同步里开启「扩展程序」、装的是同一个版本（商店版和本地加载的测试版互不相通）";
  $("tr_priceIn").value = pin ? +pin.toFixed(2) : ""; $("tr_priceOut").value = pout ? +pout.toFixed(2) : "";
}
// Known model → clear any typed override so the list price applies; unknown → keep whatever the user typed.
function applyKnownPrice(model) { if (P().prices[model]) return saveTr({ priceIn: null, priceOut: null }).then(renderTrFoot); }

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
  const u = await chrome.runtime.sendMessage({ type: "usage" }).catch(() => null);   // every device on this Chrome account
  const stats = u?.stats || { calls: 0, replies: 0, input_tokens: 0, output_tokens: 0, cost: 0 }, n = u?.devices?.stats || 0;
  const { apiKey } = await chrome.storage.sync.get({ apiKey: "" });
  $("f_foot").textContent = `已判定 ${fmt(stats.replies)} 条 · ${fmt(stats.input_tokens + stats.output_tokens)} tokens${stats.cost ? ` · $${stats.cost.toFixed(4)}` : ""}${n > 1 ? `（${n} 台设备合计）` : ""}　${apiKey ? "TypeSafe 直连" : "未填 Key · 仅规则过滤"}`;
}

// ---------------- init ----------------
async function init() {
  const { defaults = {}, providers } = await chrome.runtime.sendMessage({ type: "trDefaults" }).catch(() => ({})) || {};
  PROVIDERS = providers || {};
  buildProviders();
  if (!providers) showResult(false, "扩展后台还是旧版本：请到 chrome://extensions 点「重新加载」，再打开设置页");
  const { tr: saved } = await chrome.storage.sync.get({ tr: {} });
  tr = { ...defaults, ...saved, sites: { ...defaults.sites, ...(saved.sites || {}) }, keys: { ...(saved.keys || {}) }, models: { ...(saved.models || {}) } };
  if (!PROVIDERS[tr.provider]) tr.provider = defaults.provider || "siliconflow";
  renderTr(); bindTr(); renderTrFoot(); loadModels();
  await renderF(); bindF(); renderFFoot();
  // Live updates: marking a reply on x.com or a translation finishing shows up here without reloading.
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local") { if (ch.stats) renderFFoot(); if (ch.tstats) renderTrFoot(); }
    if (area === "sync") { if (Object.keys(ch).some(k => k.startsWith("tstats_"))) renderTrFoot(); if (Object.keys(ch).some(k => k.startsWith("stats_"))) renderFFoot(); }
    if (area === "sync" && ch.blockedHandles) renderF();
  });
}
init();
