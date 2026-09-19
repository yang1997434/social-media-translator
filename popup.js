const $ = id => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function renderPage() {
  const tab = await activeTab();
  const isStatus = /^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(tab?.url || "");
  if (!isStatus) return;
  let s = null;
  try { s = await chrome.tabs.sendMessage(tab.id, { type: "getStats" }); } catch { /* content script not injected yet */ }
  if (!s) { $("detail").textContent = "刷新此页面后生效（插件刚安装或刚更新）"; return; }
  $("hidden").textContent = `已隐藏 ${s.byRule + s.byJev} 条`;
  $("detail").textContent = `扫描 ${s.scanned} 条回复 · 规则 ${s.byRule} · jev ${s.byJev}${s.pending ? ` · 判定中 ${s.pending}` : ""}${s.note ? ` · ${s.note}` : ""}`;
  $("expand").disabled = s.byRule + s.byJev === 0;
  $("expand").onclick = async () => { await chrome.tabs.sendMessage(tab.id, { type: "expandAll" }); renderPage(); };
}

async function renderMode() {
  const { apiKey } = await chrome.storage.sync.get({ apiKey: "" });
  if (apiKey) { $("mode").innerHTML = "<b>自带 key</b> · 直连 OpenRouter，不限量"; return; }
  const q = await chrome.runtime.sendMessage({ type: "getQuota" }).catch(() => null);
  $("mode").innerHTML = q && q.limit ? `<b>免费额度</b> · 今日已用 ${q.used} / ${q.limit} 条` : "<b>免费额度</b> · 每天 300 条回复";
}

async function renderExamples() {
  const { examples, recent } = await chrome.storage.local.get({ examples: { bad: [], good: [] }, recent: [] });
  $("examples").innerHTML = `不想看 <b>${examples.bad.length}</b> · 想保留 <b>${examples.good.length}</b> · 待确认 <b>${recent.length}</b> <a id="viewEx" style="color:#1d9bf0;cursor:pointer;margin-left:6px">查看</a>`;
  $("viewEx").onclick = () => chrome.runtime.openOptionsPage();
}

async function init() {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  $("enabled").checked = enabled;
  $("enabled").onchange = e => chrome.storage.sync.set({ enabled: e.target.checked });
  $("options").onclick = () => chrome.runtime.openOptionsPage();
  renderPage(); renderMode(); renderExamples();
}
init();
