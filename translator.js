// Content script: viewport-lazy translation of X / Reddit into Chinese. Default mode replaces the text in place so the
// page reads as if it were written in Chinese; the original stays in the DOM (hidden) and is one hover+click away.
(() => {
  if (window.__xrfTr) return;
  window.__xrfTr = true;

  const host = location.hostname;
  // x / reddit start on their own (content_scripts in the manifest); any other page is "generic" and only translates
  // when the popup's 翻译此页 button injects this script and sends trTogglePage.
  const SITE = (host === "localhost" && document.documentElement.dataset.xrfSite)   // fixtures only
    || (/(^|\.)(x\.com|twitter\.com)$/.test(host) ? "x" : /(^|\.)reddit\.com$/.test(host) ? "reddit" : "generic");
  const AUTO = SITE !== "generic";
  const SELECTOR = {
    x: '[data-testid="tweetText"], [data-testid="UserDescription"], [data-testid="trend"] span',   // trend rows: only the leaf span with the name survives the innermost-only filter
    // recent-posts (右栏「近期帖子」) is a shadow host, but its list is slotted light DOM: take the leaf text nodes inside it.
    reddit: ['h1[slot="title"]', 'a[slot="title"]', '[slot="text-body"]', 'shreddit-post-text-body', '[slot="text-body"] p', '[slot="text-body"] li', '[slot="comment"] p', '[slot="comment"] li',
      'recent-posts [slot="posts"] :is(a, span, h1, h2, h3, p, div)', "a.title", ".usertext-body p", ".usertext-body li"].join(", "),
    generic: "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, td, th, summary, div",
  }[SITE];
  const BLOCKS = "p, div, ul, ol, li, dd, dt, figcaption, td, th, summary, table, section, article, h1, h2, h3, h4, h5, h6, blockquote, pre, form, nav, header, footer";
  const SKIP_INSIDE = "nav, header, footer, aside, form, pre, code, script, style, noscript, textarea, button, select, [contenteditable], [aria-hidden=true], .xrf-bar, .xrf-pill, .xrf-toast, .xrf-fab";
  // Inline pieces we never send to the model: they become [[n]] placeholders and are put back verbatim.
  const ATOM = "a, img, code, video, button, kbd, svg, input, select, textarea, iframe";
  const OURS = ".xrf-tr, .xrf-tr-toggle";
  let scanTimer = null;

  let cfg = { mode: "replace", concurrency: 3, batch: 6 };
  let enabled = false, inflight = 0, io = null, mo = null, dead = false, generation = 0, routeTimer = null, lastHref = "";
  const activeItems = new WeakMap();
  const queue = [];
  const pending = new Map();           // reqId -> items, for streamed partial results
  const watchdogs = new Map();         // reqId -> reset the lost-worker watchdog
  const autoRetries = new WeakMap();   // el -> automatic retries after transient failures (stall, 5xx, 429, network)
  const TRANSIENT = /超时|无响应|繁忙|限速|网络|后台未响应|\b(?:429|50[0-9])\b/;
  const stats = { translated: 0, failed: 0, lastError: "" };

  const alive = () => !dead && !!chrome.runtime?.id;
  function teardown() {
    if (dead) return;
    dead = true; io?.disconnect(); mo?.disconnect();
    clearTimeout(scanTimer); clearInterval(routeTimer);
  }
  const guard = fn => async (...a) => {
    if (!alive()) return teardown();
    try { return await fn(...a); }
    catch (e) { if (/context invalidated/i.test(String(e?.message || e))) return teardown(); console.warn("[xrf-tr]", e); }
  };

  // ---- extraction: text with [[n]] placeholders for links / mentions / emoji images ----
  function extract(el) {
    const atoms = [];
    let text = "";
    const walk = node => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { text += n.nodeValue; continue; }
        if (n.nodeType !== 1 || n.matches(OURS)) continue;
        if (n.tagName === "BR") { text += "\n"; continue; }
        if (n.matches(ATOM)) { text += `[[${atoms.length}]]`; atoms.push(n); continue; }
        walk(n);
      }
    };
    walk(el);
    return { text: text.replace(/[ \t]+\n/g, "\n").trim(), atoms };
  }

  function collect() {
    const out = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (el.dataset.xrfTr || el.closest(OURS)) continue;
      if (SITE === "generic") {
        if (el.closest(SKIP_INSIDE)) continue;
        if (el.querySelector(BLOCKS)) continue;                    // only leaf blocks: a div that merely wraps other blocks has no text of its own
      } else if (el.querySelector(SELECTOR)) continue;           // innermost only, else nested li>p would be translated twice
      out.push(el);
    }
    return out;
  }

  // ---- rendering ----
  function forwardClick(clone, orig) {
    // The clone has no React/Lit handlers; a click on it re-dispatches on the hidden original so SPA navigation still works.
    clone.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); orig.click(); });
  }

  function build(translated, atoms) {
    const node = document.createElement("span");
    node.className = "xrf-tr";
    const used = new Set();
    translated.split(/\[\[(\d+)\]\]/).forEach((part, i) => {
      if (i % 2 === 0) { if (part) node.appendChild(document.createTextNode(part)); return; }
      const atom = atoms[Number(part)];
      if (!atom || used.has(atom)) return;
      used.add(atom);
      const clone = atom.cloneNode(true);
      forwardClick(clone, atom);
      node.appendChild(clone);
    });
    atoms.forEach(atom => {   // the model dropped a placeholder: keep the link/emoji anyway, at the end
      if (used.has(atom)) return;
      node.appendChild(document.createTextNode(" "));
      const clone = atom.cloneNode(true); forwardClick(clone, atom); node.appendChild(clone);
    });
    return node;
  }

  function render(item, translated) {
    const { el, atoms } = item;
    clearOurs(el);
    el.classList.remove("xrf-tr-loading");
    const node = build(translated, atoms);
    if (cfg.mode === "replace") {
      const cs = getComputedStyle(el);
      node.style.fontSize = cs.fontSize;
      node.style.lineHeight = cs.lineHeight;
      if (el.tagName === "LI") el.style.setProperty("--xrf-fs", cs.fontSize);   // ::marker sizes off the li itself, keep the bullet visible
      const toggle = document.createElement("span");
      toggle.className = "xrf-tr-toggle"; toggle.textContent = "原文"; toggle.title = "查看原文 / 译文";
      toggle.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); el.classList.toggle("xrf-show-orig"); toggle.textContent = el.classList.contains("xrf-show-orig") ? "译文" : "原文"; });
      el.classList.add("xrf-replaced");
      el.append(node, toggle);
    } else {
      node.classList.add("xrf-tr-below");
      el.appendChild(node);
    }
    el.dataset.xrfTr = "done";
    item.translation = translated;
    autoRetries.delete(el);
    if (!item.rendered) { item.rendered = true; stats.translated++; }
  }

  function renderError(item, msg) {
    const { el } = item;
    el.classList.remove("xrf-tr-loading");
    el.dataset.xrfTr = "error";
    stats.failed++;
    stats.lastError = msg || "未收到译文";
    const status = String(msg).match(/\b(?:400|401|402|403|404|429|50[0-9])\b/)?.[0];
    const label = status ? `翻译失败 (${status})` : /排队/.test(msg) ? "翻译排队超时" : /超时/.test(msg) ? "翻译超时" : /未配置/.test(msg) ? "未配置翻译 Key" : /格式|解析/.test(msg) ? "译文格式异常" : "翻译失败";
    const n = document.createElement("span");
    n.className = "xrf-tr-toggle xrf-tr-err"; n.textContent = "⟳ " + label; n.title = stats.lastError + "，点击重试";
    n.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); retry(el); });
    el.appendChild(n);
    // Provider hiccups clear up on their own; retry twice (3s, 6s) before leaving it to the user's click.
    const tries = autoRetries.get(el) || 0;
    if (TRANSIENT.test(msg) && tries < 2) {
      autoRetries.set(el, tries + 1);
      const gen = generation;
      setTimeout(() => { if (enabled && gen === generation && el.isConnected && el.dataset.xrfTr === "error") retry(el); }, 3000 * 2 ** tries);
    }
  }
  function retry(el) { reset(el); el.dataset.xrfTr = "seen"; io?.observe(el); }

  function clearOurs(el) { el.querySelectorAll(":scope > .xrf-tr, :scope > .xrf-tr-toggle").forEach(n => n.remove()); }
  function reset(el) {
    activeItems.delete(el);
    clearOurs(el); el.classList.remove("xrf-replaced", "xrf-show-orig", "xrf-tr-loading");
    el.style.removeProperty("--xrf-fs"); delete el.dataset.xrfTr;
  }
  const current = it => enabled && it.generation === generation && it.el.isConnected && activeItems.get(it.el) === it;

  // X's own Grok translation ("翻译自 英语 · 显示原文" / "Translated from English · Show original") sits next to the tweet text.
  // Such a tweet is X's to handle in both states: it already reads Chinese, and when the user clicks 显示原文 they want the
  // original — re-translating it would undo the click.
  const X_OWN = /翻译自|显示原文|显示译文|显示翻译|Translated (?:from|by)|Show (?:original|translation)/;
  function ownedBySite(el) {
    if (SITE !== "x" || el.getAttribute("data-testid") !== "tweetText" || !el.parentElement) return false;
    for (const sib of el.parentElement.children) if (sib !== el && X_OWN.test(sib.textContent || "")) return true;
    return false;
  }

  // ---- pipeline: observe -> queue (document order) -> batch -> background -> stream back ----
  function scan() {
    if (!enabled) return;
    for (const el of collect()) { el.dataset.xrfTr = "seen"; io.observe(el); }
  }

  function onIntersect(entries) {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const el = en.target;
      if (el.dataset.xrfTr !== "seen") continue;
      const { text, atoms } = extract(el);
      if (!text || ownedBySite(el) || !XRF_LANG.shouldTranslate(text, el.getAttribute("lang"))) { el.dataset.xrfTr = "skip"; continue; }
      el.dataset.xrfTr = "queued";
      const item = { el, text, atoms, generation };
      activeItems.set(el, item);
      queue.push(item);
    }
    pump();
  }

  const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const visible = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const priority = el => SITE !== "generic" ? 0 : el.closest("article, main, [role=main]") ? 0 : /^(H[1-6]|P|LI|BLOCKQUOTE)$/.test(el.tagName) ? 1 : 2;
  function pump() {
    if (queue.length > 1) queue.sort((a, b) => Number(visible(b.el)) - Number(visible(a.el)) || priority(a.el) - priority(b.el) || (follows(a.el, b.el) ? -1 : 1));
    while (enabled && inflight < cfg.concurrency && queue.length) {
      const batch = [];
      let chars = 0;
      while (queue.length && batch.length < (SITE === "generic" ? Math.min(cfg.batch, 3) : cfg.batch)) {
        const next = queue[0];
        if (!current(next)) { queue.shift(); continue; }
        // Social feeds keep the original fast path: up to six items per request.
        // Generic pages cap long mixed paragraphs to keep a huge article section
        // from delaying everything behind it.
        if (batch.length && ((SITE === "generic" && chars + next.text.length > 900) || visible(next.el) !== visible(batch[0].el))) break;
        batch.push(queue.shift()); chars += next.text.length;
      }
      if (!batch.length) continue;
      inflight++;
      translateBatch(batch).finally(() => { inflight--; pump(); });
    }
    updateFab();
  }

  function settle(item, text, err, final = false) {
    if (!current(item)) return;
    // A malformed batch may have streamed one apparently complete item before
    // the worker detects the wrong array length and repairs it with single-item
    // requests. Let the authoritative final result replace that early preview.
    if (item.status !== "waiting") {
      if (final && text && item.status === "done" && text !== item.translation) render(item, text);
      return;
    }
    if (text) { item.status = "done"; render(item, text); }
    else { item.status = "error"; renderError(item, err || "翻译失败"); }
  }

  const translateBatch = guard(async function translateBatchImpl(items) {
    items = items.filter(current);
    if (!items.length) return;
    items.forEach(it => { it.status = "waiting"; it.el.classList.add("xrf-tr-loading"); });
    const reqId = Math.random().toString(36).slice(2);
    pending.set(reqId, items);
    let resp, timeout;
    const lostWorker = new Promise(resolve => {
      const touch = () => { clearTimeout(timeout); timeout = setTimeout(() => resolve({ error: "翻译后台未响应，请刷新页面后重试" }), 45000); };
      watchdogs.set(reqId, touch);
      touch();
    });
    try { resp = await Promise.race([
      chrome.runtime.sendMessage({ type: "translate", texts: items.map(it => it.text), reqId }),
      lostWorker,
    ]); }
    catch (e) { resp = { error: String(e?.message || e) }; }
    finally { clearTimeout(timeout); watchdogs.delete(reqId); }
    pending.delete(reqId);
    items.forEach((it, i) => settle(it, resp?.translations?.[i], resp?.error, true));
  });

  // React/Lit re-rendered a translated node (e.g. "Show more"): drop our copy and translate the new content.
  function onMutations(muts) {
    let dirty = false;
    for (const m of muts) {
      const changed = m.type === "childList" ? [...m.addedNodes, ...m.removedNodes] : [];
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (target?.closest?.(OURS + ", .xrf-fab")) continue;                                // inside our own nodes (toggle label, side tab)
      if (changed.length && changed.every(n => n.nodeType === 1 && n.matches?.(OURS))) continue; // we added/removed our own nodes
      const host = target?.closest?.("[data-xrf-tr]");
      // X sometimes reuses the same tweetText element and only changes its text node.
      // Invalidate every completed/skipped/in-flight result when its source changes.
      if (host && host.dataset.xrfTr !== "seen") {
        reset(host); host.dataset.xrfTr = "seen"; io?.observe(host);
      }
      dirty = true;
    }
    if (dirty) scheduleScan();
  }
  // Throttle rather than debounce. X mutates continuously (metrics, media and
  // recommendations); resetting the timer on every mutation can starve scanning forever.
  const scheduleScan = () => {
    if (scanTimer || !enabled) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 200);
  };

  // Sites pick their own theme independent of the OS: light body text means a dark page.
  function detectTheme() {
    try {
      const [r, g, b] = getComputedStyle(document.body).color.match(/\d+/g).map(Number);
      document.documentElement.classList.toggle("xrf-dark", (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5);
    } catch { /* keep light default */ }
  }

  function start() {
    if (enabled || !alive()) return;
    enabled = true;
    stats.translated = 0; stats.failed = 0; stats.lastError = "";
    detectTheme();
    io = new IntersectionObserver(onIntersect, { rootMargin: "600px 0px" });   // ~two tweets ahead: translated before they scroll in
    mo = new MutationObserver(onMutations);
    mo.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    // Route changes (Reddit sidebar, X tabs) as a second trigger in case the swap happened outside what we observed.
    lastHref = location.href;
    routeTimer = setInterval(() => { if (!alive()) return teardown(); if (location.href !== lastHref) { lastHref = location.href; scheduleScan(); } }, 800);
    scan();
    updateFab();
  }

  function stop() {
    enabled = false;
    clearTimeout(scanTimer); clearInterval(routeTimer);
    scanTimer = null; routeTimer = null;
    generation++;
    io?.disconnect(); mo?.disconnect(); io = mo = null;
    queue.length = 0; pending.clear(); watchdogs.clear();
    document.querySelectorAll("[data-xrf-tr]").forEach(reset);
    updateFab();
  }

  // ---- side tab: a logo peeking from the right edge of every page; hover slides it out, click translates / restores ----
  let fab = null;
  function ensureFab(show) {
    if (!show) { fab?.remove(); fab = null; return; }
    if (fab?.isConnected) return updateFab();
    fab = document.createElement("div");
    fab.className = "xrf-fab"; fab.setAttribute("role", "button"); fab.setAttribute("aria-label", "翻译此页");
    fab.innerHTML = `<img alt="" src="${chrome.runtime.getURL("icons/logo.svg")}"><span class="xrf-fab-label"></span>`;
    fab.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); togglePage(); });
    (document.body || document.documentElement).appendChild(fab);
    detectTheme(); updateFab();
  }
  function updateFab() {
    if (!fab) return;
    const busy = enabled && (inflight > 0 || queue.length > 0);
    fab.classList.toggle("on", enabled); fab.classList.toggle("busy", busy);
    fab.querySelector(".xrf-fab-label").textContent = enabled ? (busy ? `翻译中 · ${stats.translated}` : `还原此页 · ${stats.translated} 段`) : "翻译此页";
  }
  // Same toggle for the popup button and the side tab: restores when running, otherwise starts (and flips the global
  // switch back on if it was off). No key yet → open the options page.
  async function togglePage() {
    if (enabled) { stop(); return { enabled: false }; }
    const configured = await applyConfig();
    if (configured === false) { chrome.runtime.sendMessage({ type: "openOptions" }).catch(() => {}); return { enabled: false, configured: false }; }
    if (configured) {
      const { tr = {} } = await chrome.storage.sync.get({ tr: {} });
      if (tr.enabled === false) await chrome.storage.sync.set({ tr: { ...tr, enabled: true } });
      start();
    }
    return { enabled, configured };
  }

  const applyConfig = guard(async function applyConfigImpl() {
    const c = await chrome.runtime.sendMessage({ type: "trConfig" });
    if (!c) return false;
    const modeChanged = c.mode !== cfg.mode;
    cfg = { mode: c.mode, concurrency: c.concurrency, batch: c.batch };
    const want = c.configured && c.enabled && (AUTO ? c.sites?.[SITE] !== false : enabled);
    if (want && !enabled) start();
    else if (!want && enabled) stop();
    else if (want && modeChanged) { stop(); start(); }   // re-render from cache in the new mode
    ensureFab(c.fab !== false);
    return c.configured;
  });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "getTrStats") sendResponse({ enabled, site: SITE, translated: stats.translated, failed: stats.failed, lastError: stats.lastError,
      pending: queue.filter(current).length + [...pending.values()].flat().filter(it => current(it) && it.status === "waiting").length });
    else if (msg.type === "trTogglePage") { togglePage().then(sendResponse); return true; }
    else if (msg.type === "trPartial") {
      watchdogs.get(msg.reqId)?.();
      const item = pending.get(msg.reqId)?.[msg.index];
      if (enabled && item) settle(item, msg.text);
    }
    else if (msg.type === "trProgress") watchdogs.get(msg.reqId)?.();
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "sync" && ch.tr) applyConfig(); });
  applyConfig();
})();
