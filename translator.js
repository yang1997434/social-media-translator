// Content script: viewport-lazy translation of X / Reddit into Chinese. Default mode replaces the text in place so the
// page reads as if it were written in Chinese; the original stays in the DOM (hidden) and is one hover+click away.
(() => {
  if (window.__xrfTr) return;
  window.__xrfTr = true;

  const SITE = /(^|\.)reddit\.com$/.test(location.hostname) ? "reddit" : "x";
  const SELECTOR = SITE === "x"
    ? '[data-testid="tweetText"], [data-testid="UserDescription"]'
    : ['h1[slot="title"]', 'a[slot="title"]', 'div[slot="text-body"] p', 'div[slot="text-body"] li', '[slot="comment"] p', '[slot="comment"] li',
       "a.title", ".usertext-body p", ".usertext-body li"].join(", ");
  // Inline pieces we never send to the model: they become [[n]] placeholders and are put back verbatim.
  const ATOM = "a, img, code, video, button";
  const OURS = ".xrf-tr, .xrf-tr-toggle";

  let cfg = { mode: "replace", concurrency: 3, batch: 6 };
  let enabled = false, inflight = 0, io = null, mo = null, dead = false;
  const queue = [];
  const pending = new Map();           // reqId -> items, for streamed partial results
  const stats = { translated: 0, failed: 0 };

  const alive = () => !dead && !!chrome.runtime?.id;
  function teardown() { if (dead) return; dead = true; io?.disconnect(); mo?.disconnect(); }
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
      if (el.querySelector(SELECTOR)) continue;   // innermost only, else nested li>p would be translated twice
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
    stats.translated++;
  }

  function renderError(item, msg) {
    const { el } = item;
    el.classList.remove("xrf-tr-loading");
    el.dataset.xrfTr = "error";
    stats.failed++;
    const n = document.createElement("span");
    n.className = "xrf-tr-toggle xrf-tr-err"; n.textContent = "⟳ 翻译失败"; n.title = msg + "，点击重试";
    n.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); reset(el); el.dataset.xrfTr = "seen"; io?.observe(el); });
    el.appendChild(n);
  }

  function clearOurs(el) { el.querySelectorAll(":scope > .xrf-tr, :scope > .xrf-tr-toggle").forEach(n => n.remove()); }
  function reset(el) { clearOurs(el); el.classList.remove("xrf-replaced", "xrf-show-orig", "xrf-tr-loading"); delete el.dataset.xrfTr; }

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
      if (!text || !XRF_LANG.shouldTranslate(text, el.getAttribute("lang"))) { el.dataset.xrfTr = "skip"; continue; }
      el.dataset.xrfTr = "queued";
      queue.push({ el, text, atoms });
    }
    pump();
  }

  const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  function pump() {
    if (queue.length > 1) queue.sort((a, b) => (follows(a.el, b.el) ? -1 : 1));
    while (enabled && inflight < cfg.concurrency && queue.length) {
      const batch = queue.splice(0, cfg.batch);
      inflight++;
      translateBatch(batch).finally(() => { inflight--; pump(); });
    }
  }

  const translateBatch = guard(async function translateBatchImpl(items) {
    items = items.filter(it => it.el.isConnected);
    if (!items.length) return;
    items.forEach(it => { it.status = "waiting"; it.el.classList.add("xrf-tr-loading"); });
    const reqId = Math.random().toString(36).slice(2);
    pending.set(reqId, items);
    let resp;
    try { resp = await chrome.runtime.sendMessage({ type: "translate", texts: items.map(it => it.text), reqId }); }
    catch (e) { resp = { error: String(e?.message || e) }; }
    pending.delete(reqId);
    items.forEach((it, i) => {
      if (it.status !== "waiting") return;
      const t = resp?.translations?.[i];
      if (t) render(it, t); else renderError(it, resp?.error || "翻译失败");
    });
  });

  // React/Lit re-rendered a translated node (e.g. "Show more"): drop our copy and translate the new content.
  function onMutations(muts) {
    let dirty = false;
    for (const m of muts) {
      const changed = [...m.addedNodes, ...m.removedNodes];
      if (!changed.length) continue;
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (target?.closest?.(OURS)) continue;                                              // inside our own nodes (toggle label etc.)
      if (changed.every(n => n.nodeType === 1 && n.matches?.(OURS))) continue;            // we added/removed our own nodes
      const host = target?.closest?.("[data-xrf-tr]");
      if (host && host.dataset.xrfTr !== "seen") { reset(host); host.dataset.xrfTr = "seen"; io?.observe(host); }
      dirty = true;
    }
    if (dirty) scheduleScan();
  }
  let scanTimer = null;
  const scheduleScan = () => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 300); };

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
    detectTheme();
    io = new IntersectionObserver(onIntersect, { rootMargin: "300px 0px" });
    mo = new MutationObserver(onMutations);
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  function stop() {
    enabled = false;
    io?.disconnect(); mo?.disconnect(); io = mo = null;
    queue.length = 0; pending.clear();
    document.querySelectorAll("[data-xrf-tr]").forEach(reset);
  }

  const applyConfig = guard(async function applyConfigImpl() {
    const c = await chrome.runtime.sendMessage({ type: "trConfig" });
    if (!c) return;
    const modeChanged = c.mode !== cfg.mode;
    cfg = { mode: c.mode, concurrency: c.concurrency, batch: c.batch };
    const want = c.configured && c.enabled && c.sites?.[SITE] !== false;
    if (want && !enabled) start();
    else if (!want && enabled) stop();
    else if (want && modeChanged) { stop(); start(); }   // re-render from cache in the new mode
  });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "getTrStats") sendResponse({ enabled, site: SITE, translated: stats.translated, failed: stats.failed, pending: queue.length + [...pending.values()].flat().filter(i => i.status === "waiting").length });
    else if (msg.type === "trPartial") {
      const item = pending.get(msg.reqId)?.[msg.index];
      if (enabled && item && item.status === "waiting") { item.status = "done"; render(item, msg.text); }
    }
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "sync" && ch.tr) applyConfig(); });
  applyConfig();
})();
