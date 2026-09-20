const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
const site = url => /^https:\/\/(x|twitter)\.com\//.test(url || "") ? "x" : /^https:\/\/([\w-]+\.)?reddit\.com\//.test(url || "") ? "reddit" : null;
const isStatus = url => /^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(url || "");
const ask = (tab, msg) => chrome.tabs.sendMessage(tab.id, msg).catch(() => null);
const openOptions = () => chrome.runtime.openOptionsPage();

async function renderTranslate(tab) {
  const cfg = await chrome.runtime.sendMessage({ type: "trConfig" }).catch(() => null);
  const card = $("trCard"), body = $("trBody");
  $("trEnabled").checked = !!cfg?.enabled;
  card.classList.toggle("off", !cfg?.enabled);
  if (!cfg?.configured) {
    $("trSub").textContent = "还没配置翻译 API";
    body.innerHTML = `<div class="line">填一个硅基流动 / OpenRouter 的 API Key，打开 X 或 Reddit 就会自动把外文帖子和评论变成中文。</div><div class="cta"><button class="tr" id="setup">去配置</button></div>`;
    $("setup").onclick = openOptions;
    return;
  }
  const model = (cfg.model || "").split("/").pop();
  $("trSub").textContent = `${cfg.mode === "replace" ? "原地替换" : "双语对照"} · ${model}`;
  const s = site(tab?.url);
  if (!s) { body.innerHTML = `<div class="line">在 X 或 Reddit 页面上自动生效。</div>`; return; }
  if (!cfg.enabled) { body.innerHTML = `<div class="line">已关闭。打开开关后刷新页面即可。</div>`; return; }
  if (cfg.sites?.[s] === false) { body.innerHTML = `<div class="line">${s === "x" ? "X" : "Reddit"} 已在设置里关闭自动翻译。</div>`; return; }
  const st = await ask(tab, { type: "getTrStats" });
  if (!st) { body.innerHTML = `<div class="line">刷新此页面后生效（插件刚安装或刚更新）</div>`; return; }
  body.innerHTML = `<div class="big num">${st.translated} <span style="font-size:13px;font-weight:500">段已翻译</span></div><div class="line">${st.pending ? `翻译中 ${st.pending} · ` : ""}滚动到哪翻到哪${st.failed ? ` · <span style="color:var(--bad)">失败 ${st.failed}</span>` : ""}</div>`;
}

async function renderFilter(tab) {
  const { enabled, apiKey } = await chrome.storage.sync.get({ enabled: true, apiKey: "" });
  $("fEnabled").checked = enabled;
  $("fCard").classList.toggle("off", !enabled);
  const q = apiKey ? null : await chrome.runtime.sendMessage({ type: "getQuota" }).catch(() => null);
  $("fSub").textContent = apiKey ? "自带 key · 不限量" : q?.limit ? `免费额度 · 今日 ${q.used} / ${q.limit}` : "免费额度 · 每天 300 条";
  const body = $("fBody");
  if (!isStatus(tab?.url)) { body.innerHTML = `<div class="line">打开一条推文的详情页，评论区会自动折叠推广、互动饵、跑题和 AI 套话。</div>`; return; }
  if (!enabled) { body.innerHTML = `<div class="line">已关闭。</div>`; return; }
  const s = await ask(tab, { type: "getStats" });
  if (!s) { body.innerHTML = `<div class="line">刷新此页面后生效（插件刚安装或刚更新）</div>`; return; }
  const n = s.byRule + s.byJev;
  body.innerHTML = `<div class="big num">${n} <span style="font-size:13px;font-weight:500">条已隐藏</span></div><div class="line">扫描 ${s.scanned} · 规则 ${s.byRule} · AI ${s.byJev}${s.pending ? ` · 判定中 ${s.pending}` : ""}${s.note ? ` · <span style="color:var(--warn)">${esc(s.note)}</span>` : ""}</div>
    <div class="cta"><button class="ghost sm" id="expand" ${n ? "" : "disabled"}>全部展开</button><a class="small" id="learn">教它你的口味 ›</a></div>`;
  $("expand").onclick = async () => { await ask(tab, { type: "expandAll" }); renderFilter(tab); };
  $("learn").onclick = openOptions;
}

async function init() {
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  $("gear").onclick = openOptions; $("optLink").onclick = openOptions;
  const tab = await activeTab();
  $("trEnabled").onchange = async e => { const { tr } = await chrome.storage.sync.get({ tr: {} }); await chrome.storage.sync.set({ tr: { ...tr, enabled: e.target.checked } }); renderTranslate(tab); };
  $("fEnabled").onchange = e => { chrome.storage.sync.set({ enabled: e.target.checked }); $("fCard").classList.toggle("off", !e.target.checked); setTimeout(() => renderFilter(tab), 200); };
  renderTranslate(tab); renderFilter(tab);
}
init();
