const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e5 ? (n / 1e3).toFixed(0) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
const yuan = v => v >= 100 ? "¥" + v.toFixed(0) : v >= 1 ? "¥" + v.toFixed(2) : "¥" + v.toFixed(3);

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
const site = url => /^https:\/\/(x|twitter)\.com\//.test(url || "") ? "x" : /^https:\/\/([\w-]+\.)?reddit\.com\//.test(url || "") ? "reddit" : null;
const ask = (tab, msg) => chrome.tabs.sendMessage(tab.id, msg).catch(() => null);
const openOptions = () => chrome.runtime.openOptionsPage();
let translateTimer = null;
let price = null;   // [¥/M in, ¥/M out] for the configured model, or null when unknown

const line = (text, cls = "", dot = false) => `<div class="line ${cls}">${dot ? '<span class="dot"></span>' : ""}${text}</div>`;
// Count, then only what needs saying: in-flight, failures, the last error.
const progress = st => `<div class="big">${st.translated}<span class="unit">段已翻译</span></div>`
  + (st.pending || st.failed ? line([st.pending ? `翻译中 ${st.pending}` : "", st.failed ? `<span style="color:var(--bad)">失败 ${st.failed}</span>` : ""].filter(Boolean).join(" · "), "", !!st.pending) : "")
  + (st.lastError ? line(esc(st.lastError), "bad") : "");

async function renderTranslate(tab) {
  clearTimeout(translateTimer);
  const cfg = await chrome.runtime.sendMessage({ type: "trConfig" }).catch(() => null);
  const card = $("trCard"), body = $("trBody");
  price = cfg?.price || null;
  $("trEnabled").checked = !!cfg?.enabled;
  card.classList.toggle("off", !cfg?.enabled);
  if (!cfg?.configured) {
    $("usage").hidden = true;
    $("trSub").textContent = "还没配置翻译 API";
    body.innerHTML = `<div class="cta"><button class="tr" id="setup">填写硅基流动 API Key</button></div>`;
    $("setup").onclick = openOptions;
    return;
  }
  renderUsage();
  const model = (cfg.model || "").split("/").pop();
  $("trSub").innerHTML = `<span>${esc(cfg.providerName || "")}</span><span>·</span><span class="model" title="${esc(cfg.model || "")}">${esc(model)}</span>${cfg.mode === "replace" ? "" : "<span>·</span><span>双语</span>"}`;
  const s = site(tab?.url);
  if (!s) return renderGeneric(tab);
  if (!cfg.enabled) { body.innerHTML = line("已关闭"); return; }
  if (cfg.sites?.[s] === false) { body.innerHTML = line(`${s === "x" ? "X" : "Reddit"} 已在设置中关闭`); return; }
  const st = await ask(tab, { type: "getTrStats" });
  if (!st) { body.innerHTML = line("刷新页面后生效"); return; }
  body.innerHTML = progress(st);
  if (st.pending) translateTimer = setTimeout(() => renderTranslate(tab), 1500);
}

// Any other page: inject on demand (activeTab), toggle with one button.
async function renderGeneric(tab) {
  clearTimeout(translateTimer);
  const body = $("trBody");
  const injectable = /^https?:/.test(tab?.url || "");
  if (!injectable) { body.innerHTML = line("此页面不支持"); return; }
  const st = await ask(tab, { type: "getTrStats" });
  const on = !!st?.enabled;
  body.innerHTML = (on ? progress(st) : "") + `<div class="cta"><button class="${on ? "ghost" : "tr"}" id="pageTr">${on ? "还原此页" : "翻译此页"}</button></div>`;
  $("pageTr").onclick = async () => {
    clearTimeout(translateTimer);
    $("pageTr").disabled = true;
    try {
      if (!st) {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["translator.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lang.js", "translator.js"] });
      }
      const r = await ask(tab, { type: "trTogglePage" });
      if (!r) throw new Error("页面未响应，请刷新后重试");
      if (r && r.configured === false) { openOptions(); return; }
    } catch (e) { body.innerHTML = line(esc(e.message), "bad"); return; }
    translateTimer = setTimeout(() => renderTranslate(tab), 300);
  };
  if (on) translateTimer = setTimeout(() => renderTranslate(tab), 1500);
}

// Usage strip: cost when the model's price is known, tokens otherwise.
async function renderUsage() {
  const { tstats } = await chrome.storage.local.get({ tstats: null });
  const strip = $("usage");
  if (!tstats) { strip.hidden = true; return; }
  const now = new Date().toISOString();
  const buckets = { Today: tstats.day === now.slice(0, 10) ? tstats.today : null, Month: tstats.month === now.slice(0, 7) ? tstats.mon : null, Total: tstats.total };
  for (const [k, b] of Object.entries(buckets)) {
    const v = $("u" + k), s = $("u" + k + "S");
    if (!b || !b.n) { v.textContent = price ? "¥0" : "0"; s.innerHTML = "尚无翻译"; continue; }
    const tokens = (b.in || 0) + (b.out || 0);
    const booked = typeof b.cost === "number";   // pre-0.6.3 buckets only have tokens
    if (booked || price) { v.textContent = yuan(booked ? b.cost : ((b.in || 0) * price[0] + (b.out || 0) * price[1]) / 1e6); s.innerHTML = `${fmt(b.n)} 段<br>${fmt(tokens)} tokens`; }
    else { v.textContent = fmt(tokens); s.innerHTML = `${fmt(b.n)} 段<br><a>填单价算钱</a>`; s.querySelector("a").onclick = openOptions; }
  }
  strip.hidden = false;
}

async function init() {
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  $("gear").onclick = openOptions; $("optLink").onclick = openOptions;
  const tab = await activeTab();
  $("trEnabled").onchange = async e => { const { tr } = await chrome.storage.sync.get({ tr: {} }); await chrome.storage.sync.set({ tr: { ...tr, enabled: e.target.checked } }); renderTranslate(tab); };
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.tstats) renderUsage(); });
  renderTranslate(tab);
}
init();
