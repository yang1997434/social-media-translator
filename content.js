// Content script: watch the conversation timeline, run local rules, batch the rest to jev, collapse hits.
(() => {
  const REASON_LABEL = { spam: "推广/垃圾", bait: "互动饵", offtopic: "跑题", slop: "AI 套话", user: "同类（你标记过）" };
  const MAX_STORED_EXAMPLES = 30;
  const MAX_RECENT = 50;
  const EXAMPLE_TEXT = 200;
  const BATCH_DELAY_MS = 600;
  const BATCH_SIZE = 8;
  const MAX_TEXT = 600;
  const VERSION = chrome.runtime?.getManifest?.().version || "dev";
  document.documentElement.dataset.xrfVersion = VERSION;  // visible from page context: proves the script is injected

  const stats = { scanned: 0, byRule: 0, byJev: 0, pending: 0, note: "" };
  let seen = new WeakSet();
  let pending = [];
  let timer = null;
  let enabled = true;
  let pill = null;
  let custom = { keywords: [], handles: [] };
  let observer = null;
  let routeTimer = null;
  let dead = false;
  let filterGeneration = 0;

  // After the extension is reloaded/updated, this already-injected script loses its connection to the extension
  // ("Extension context invalidated"). Detect that and unload quietly instead of throwing on every chrome.* call.
  const alive = () => !dead && !!chrome.runtime?.id;
  function teardown() {
    if (dead) return;
    dead = true;
    observer?.disconnect(); clearInterval(routeTimer); clearTimeout(timer);
    pending = []; pill?.remove();
    console.info("[xrf] extension was reloaded; this tab keeps its current state. Refresh the page to use the new version.");
  }
  const guard = fn => async (...args) => {
    if (!alive()) return teardown();
    try { return await fn(...args); }
    catch (e) { if (/context invalidated/i.test(String(e?.message || e))) return teardown(); console.warn("[xrf]", e); }
  };

  const q = (el, sel) => el.querySelector(sel);
  const text = el => {
    const node = q(el, '[data-testid="tweetText"]')?.cloneNode(true);
    node?.querySelectorAll(".xrf-tr, .xrf-tr-toggle").forEach(n => n.remove());
    return (node?.textContent || "").slice(0, MAX_TEXT);
  };
  const handle = el => (q(el, '[data-testid="User-Name"] a[href^="/"]')?.getAttribute("href") || "").replace("/", "");
  const tweetId = el => (q(el, 'a[href*="/status/"]')?.getAttribute("href") || "").split("/status/")[1]?.split(/[/?]/)[0] || "";
  const isReplyPage = () => /\/status\/\d+/.test(location.pathname);
  const hiddenCount = () => stats.byRule + stats.byJev;

  function extract(article) {
    return { id: tweetId(article), text: text(article), handle: handle(article),
      displayName: (q(article, '[data-testid="User-Name"] a[href^="/"]')?.textContent || "").trim().slice(0, 100),
      verified: !!q(article, 'svg[data-testid="icon-verified"]'), hasLink: !!q(article, 'a[href^="http"], a[href*="t.co/"]') };
  }

  function originalTweet() {
    const id = location.pathname.match(/\/status\/(\d+)/)?.[1];
    const original = [...document.querySelectorAll('article[data-testid="tweet"]')].find(el => tweetId(el) === id);
    return original ? extract(original) : { handle: "", text: "" };
  }

  function report() {
    if (!alive()) return teardown();
    try { chrome.runtime.sendMessage({ type: "count", n: hiddenCount() }).catch(() => {}); } catch { return teardown(); }
    renderPill();
  }

  function renderPill() {
    if (!pill) { pill = document.createElement("div"); pill.className = "xrf-pill"; document.body.appendChild(pill); }
    const n = document.querySelectorAll("article.xrf-hidden").length;
    pill.style.display = enabled && (n > 0 || stats.pending > 0) ? "flex" : "none";
    pill.innerHTML = `<b>Reply Filter</b><span>已隐藏 ${n} 条${stats.pending ? ` · 判定中 ${stats.pending}` : ""}</span>${n ? '<a data-xrf-expand>全部展开</a>' : ""}`;
    pill.querySelector("[data-xrf-expand]")?.addEventListener("click", expandAll);
  }

  function expandAll() {
    document.querySelectorAll(".xrf-bar").forEach(b => b.remove());
    document.querySelectorAll("article.xrf-hidden").forEach(a => a.classList.remove("xrf-hidden"));
    renderPill();
  }

  const saveExample = guard(async function saveExampleImpl(kind, data) {
    const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
    const other = kind === "bad" ? "good" : "bad";
    examples[other] = examples[other].filter(e => e.id !== data.id);
    examples[kind] = [...examples[kind].filter(e => e.id !== data.id), { id: data.id, t: data.text.slice(0, EXAMPLE_TEXT), h: data.handle, ts: Date.now() }].slice(-MAX_STORED_EXAMPLES);
    await chrome.storage.local.set({ examples, ["v:" + data.id]: kind === "bad" ? { cat: "user", p: 1 } : null, ["keep:" + data.id]: kind === "good" });
    await dropRecent(data.id);
    return true;
  });

  // Review queue: everything hidden automatically is logged so the user can confirm or reject it in the options page.
  async function dropRecent(id) {
    const { recent } = await chrome.storage.local.get({ recent: [] });
    await chrome.storage.local.set({ recent: recent.filter(r => r.id !== id) });
  }
  // Several replies collapse in the same tick; chain the read-modify-write so concurrent writes don't overwrite each other.
  let storeQueue = Promise.resolve();
  const logRecent = (...args) => (storeQueue = storeQueue.then(() => logRecentNow(...args)));
  const logRecentNow = guard(async function logRecentImpl(data, reason, p) {
    const { recent } = await chrome.storage.local.get({ recent: [] });
    const row = { id: data.id, t: data.text.slice(0, EXAMPLE_TEXT), h: data.handle, reason, p: p || null, ts: Date.now() };
    await chrome.storage.local.set({ recent: [...recent.filter(r => r.id !== data.id), row].slice(-MAX_RECENT) });
  });

  const blockHandle = guard(async function blockHandleImpl(h) {
    const { blockedHandles } = await chrome.storage.sync.get({ blockedHandles: [] });
    if (!blockedHandles.includes(h)) await chrome.storage.sync.set({ blockedHandles: [...blockedHandles, h] });
  });

  // Immediate confirmation after the user teaches the AI something, with a way to see the full list.
  async function toast(kind) {
    const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } });
    document.querySelector(".xrf-toast")?.remove();
    const el = document.createElement("div");
    el.className = "xrf-toast";
    el.innerHTML = `<span>已记为「${kind === "bad" ? "不想看" : "想保留"}」的例子 · 不想看 ${examples.bad.length} 条 · 想保留 ${examples.good.length} 条</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function expandOne(article, bar) { article.classList.remove("xrf-hidden"); bar.remove(); renderPill(); }

  function collapse(article, reason, p, data, manual) {
    if (article.dataset.xrf) return;
    article.dataset.xrf = "1";
    p ? stats.byJev++ : stats.byRule++;
    const bar = document.createElement("div");
    bar.className = "xrf-bar";
    const tail = manual ? `<a data-act="block">屏蔽 @${data.handle}</a><a data-act="undo">撤销</a>` : `<a data-act="wrong">误判</a>`;
    bar.innerHTML = `<b>${manual ? "已标记" : "已隐藏"}</b><span class="xrf-tag">${reason}</span><span>${manual ? "" : p ? Math.round(p * 100) + "%" : "规则"}</span><span>· 点击展开</span><span class="xrf-acts">${tail}</span>`;
    bar.addEventListener("click", async e => {
      const act = e.target?.dataset?.act;
      if (act === "block") { await blockHandle(data.handle); e.target.textContent = "已屏蔽"; return; }
      if (act === "wrong" && data && await saveExample("good", data)) toast("good");
      if (act === "undo" && data) { const { examples } = await chrome.storage.local.get({ examples: { bad: [], good: [] } }); examples.bad = examples.bad.filter(x => x.id !== data.id); await chrome.storage.local.set({ examples, ["v:" + data.id]: null }); }
      expandOne(article, bar);
    });
    article.classList.add("xrf-hidden");
    article.parentElement.insertBefore(bar, article);
    if (!manual && data) logRecent(data, reason, p);
    report();
  }

  function addMarkButton(article, data) {
    if (q(article, ".xrf-mark")) return;
    const btn = document.createElement("button");
    btn.className = "xrf-mark"; btn.type = "button"; btn.textContent = "隐藏"; btn.title = "不想看这类回复：立即折叠，并记成例子，让 AI 以后把类似的也折叠";
    btn.addEventListener("click", async e => {
      e.preventDefault(); e.stopPropagation();
      const saved = await saveExample("bad", data);
      if (!saved) { btn.textContent = "未保存：请刷新页面"; btn.style.display = "block"; btn.style.background = "#f4212e"; return; }  // never pretend it worked
      collapse(article, "你标记的", 1, data, true);
      toast("bad");
    });
    article.classList.add("xrf-host");
    article.appendChild(btn);
  }

  async function cached(ids) {
    const got = await chrome.storage.local.get(ids.map(i => "v:" + i));
    return Object.fromEntries(ids.map(i => [i, got["v:" + i]]));
  }

  async function classifyBatch(fresh, generation, path) {
    const res = await chrome.runtime.sendMessage({ type: "classify", original: originalTweet(), replies: fresh.map(b => b.data) });
    if (!enabled || generation !== filterGeneration || path !== location.pathname) return;
    if (!res || res.error) {
      stats.note = res?.error === "nokey" ? "未填 jev Key，仅规则过滤" : "jev 暂不可用，仅规则过滤";
      if (res?.error !== "nokey") console.warn("[xrf]", stats.note, res?.error || "");
      return;
    }
    stats.note = "";
    console.info(`[xrf] jev(${res.mode}) batch ${fresh.length} replies -> ${res.verdicts.filter(Boolean).length} hidden`);
    const store = {};
    res.verdicts.forEach((v, i) => { store["v:" + fresh[i].data.id] = v || null; if (v) collapse(fresh[i].el, REASON_LABEL[v.cat], v.p, fresh[i].data); });
    await chrome.storage.local.set(store);
  }

  const flush = guard(async function flushImpl() {
    const generation = filterGeneration, path = location.pathname;
    if (!enabled || !isReplyPage()) return;
    const batch = pending.splice(0, BATCH_SIZE);
    if (!batch.length) return;
    const cache = await cached(batch.map(b => b.data.id));
    if (!enabled || generation !== filterGeneration || path !== location.pathname) return;
    const fresh = batch.filter(b => { const v = cache[b.data.id]; if (v === undefined) return true; if (v) collapse(b.el, REASON_LABEL[v.cat] || "你标记的", v.p, b.data); return false; });
    if (fresh.length) await classifyBatch(fresh, generation, path).catch(e => console.warn("[xrf]", e));
    if (!enabled || generation !== filterGeneration || path !== location.pathname) return;
    stats.pending = pending.length;
    report();
    if (pending.length) timer = setTimeout(flush, BATCH_DELAY_MS);
  });

  function consider(article) {
    if (!alive()) return teardown();
    if (!enabled || seen.has(article)) return;
    seen.add(article);
    if (isReplyPage() && tweetId(article) === location.pathname.match(/\/status\/(\d+)/)?.[1]) return;
    const data = extract(article);
    if (!data.id || (!data.text && !data.displayName)) return;
    stats.scanned++;
    addMarkButton(article, data);
    considerRules(article, data);
  }

  const considerRules = guard(async function considerRulesImpl(article, data) {
    const path = location.pathname, generation = filterGeneration;
    const got = await chrome.storage.local.get("keep:" + data.id);
    if (!enabled || generation !== filterGeneration || path !== location.pathname || !article.isConnected) return;
    if (got["keep:" + data.id]) return;  // user said "误判": never hide this one again
    const rule = (isReplyPage() ? XRF_RULES.classify : XRF_RULES.classifyTimeline)(data, custom);
    if (rule) { console.debug("[xrf] rule hit", rule, data.handle); return collapse(article, rule, null, data); }
    if (!isReplyPage()) return;
    pending.push({ el: article, data });
    stats.pending = pending.length;
    clearTimeout(timer); timer = setTimeout(flush, BATCH_DELAY_MS);
  });

  function scan(root) {
    if (root.matches?.('article[data-testid="tweet"]')) consider(root);
    root.querySelectorAll?.('article[data-testid="tweet"]').forEach(consider);
  }

  function setEnabled(on) {
    filterGeneration++;
    clearTimeout(timer); pending = [];
    enabled = on;
    if (!on) { expandAll(); pending = []; stats.pending = 0; chrome.runtime.sendMessage({ type: "count", n: 0 }).catch(() => {}); renderPill(); return; }
    seen = new WeakSet();
    document.querySelectorAll("article[data-xrf]").forEach(a => delete a.dataset.xrf);
    Object.assign(stats, { scanned: 0, byRule: 0, byJev: 0, pending: 0 });
    scan(document.body);
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "getStats") sendResponse({ ...stats, enabled });
    if (msg.type === "expandAll") { expandAll(); sendResponse({ ok: true }); }
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "sync") return;
    if (ch.enabled) setEnabled(ch.enabled.newValue !== false);
    if (ch.customKeywords) { custom.keywords = ch.customKeywords.newValue || []; if (enabled) { expandAll(); setEnabled(true); } }
    if (ch.blockedHandles) { custom.handles = ch.blockedHandles.newValue || []; if (enabled) setEnabled(true); }
  });
  let lastPath = location.pathname;  // X is an SPA: reset per-page stats when the route changes
  routeTimer = setInterval(() => { if (!alive()) return teardown(); if (location.pathname !== lastPath) { lastPath = location.pathname; clearTimeout(timer); pending = []; if (enabled) { expandAll(); setEnabled(true); } report(); } }, 800);

  chrome.storage.sync.get({ enabled: true, customKeywords: [], blockedHandles: [] }).then(s => {
    enabled = s.enabled !== false;
    custom = { keywords: s.customKeywords, handles: s.blockedHandles };
    observer = new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && scan(n))));
    observer.observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  });
})();
