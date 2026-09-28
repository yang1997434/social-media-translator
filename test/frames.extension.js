// The real unpacked extension in Playwright's Chromium: page translation reaches cross-origin, srcdoc and late iframes
// (claude.ai artifacts render in one), the top frame's side tab toggles and counts all of them, and a frame never starts
// on its own. The model call is faked inside the service worker: no API key, no paid requests.
//   python3 -m http.server 8766   (repo root, as for browser.acceptance.js)
//   node test/frames.extension.js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const root = path.join(__dirname, "..");
const base = "http://localhost:8766";
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xrf-frames-"));
  const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    await sw.evaluate(async () => {
      await chrome.storage.sync.set({ tr: { provider: "siliconflow", keys: { siliconflow: "sk-test-not-a-real-key" } } });
      self.__calls = 0;
      const real = self.fetch;
      self.fetch = async (url, init) => {
        if (!String(url).endsWith("/chat/completions")) return real(url, init);   // the options page (opened on install) lists models
        self.__calls++;
        const texts = JSON.parse(JSON.parse(init.body).messages[1].content);
        const content = JSON.stringify(texts.map(t => "译文：" + t));
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      };
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(base + "/test/frames.fixture.html");
    const frame = async test => { for (let i = 0; i < 80; i++) { const f = page.frames().find(f => test(f.url())); if (f) return f; await page.waitForTimeout(100); } throw new Error("frame never attached"); };
    const art = await frame(u => u.includes("127.0.0.1:8766/test/frames.inner.html"));
    const doc = await frame(u => u === "about:srcdoc");
    const count = f => f.evaluate(() => document.querySelectorAll(".xrf-tr").length);
    const label = () => page.locator(".xrf-fab-label").textContent();

    await page.locator(".xrf-fab").waitFor();
    await art.waitForLoadState();
    await page.waitForTimeout(800);   // the frames' scripts have run and asked the top frame whether to join
    assert.equal(await art.locator(".xrf-fab").count() + await doc.locator(".xrf-fab").count(), 0, "side tab only in the top frame");
    assert.equal(await count(art) + await count(doc) + await count(page.mainFrame()), 0, "nothing translates before the toggle");
    assert.equal(await sw.evaluate(() => self.__calls), 0);
    console.log("PASS frames: one side tab, nothing starts on its own");

    await page.locator(".xrf-fab").hover();
    await page.locator(".xrf-fab").click();
    await art.waitForFunction(() => document.querySelectorAll(".xrf-tr").length === 6);
    await doc.waitForFunction(() => document.querySelectorAll(".xrf-tr").length === 1);
    await page.waitForFunction(() => document.querySelectorAll(".xrf-tr").length === 1);
    assert.match(await art.locator("h1 .xrf-tr").textContent(), /^译文：One AI CMO/);
    assert.equal(await art.locator("h1").evaluate(h => getComputedStyle(h).fontSize), "0px", "the original is hidden in place: translator.css reached the frame");
    await page.waitForFunction(() => document.querySelector(".xrf-fab-label").textContent === "还原此页 · 8 段");
    // What the popup asks (no "tabs" permission to query by URL: the fixture tab is the one whose top frame answers).
    const stats = () => sw.evaluate(async () => { for (const t of await chrome.tabs.query({})) { const r = await chrome.tabs.sendMessage(t.id, { type: "getTrStats" }, { frameId: 0 }).catch(() => null); if (r) return r; } });
    const st = await stats();
    assert.equal(st.enabled, true); assert.equal(st.translated, 8); assert.equal(st.pending, 0);
    console.log("PASS frames: cross-origin and srcdoc frames translate in place; side tab and popup count all 8");

    await page.evaluate(() => { const f = document.createElement("iframe"); f.src = "http://127.0.0.1:8766/test/frames.inner.html?late"; f.style.height = "300px"; document.body.append(f); });
    const late = await frame(u => u.endsWith("frames.inner.html?late"));
    await late.waitForFunction(() => document.querySelectorAll(".xrf-tr").length === 6);
    await page.waitForFunction(() => document.querySelector(".xrf-fab-label").textContent === "还原此页 · 14 段");
    console.log("PASS frames: an iframe added after the toggle joins in");

    await page.locator(".xrf-fab").click();
    for (const f of [page.mainFrame(), art, doc, late]) await f.waitForFunction(() => !document.querySelector(".xrf-tr, .xrf-replaced"));
    assert.equal(await label(), "翻译此页");
    assert.equal((await stats()).enabled, false);
    console.log("PASS frames: restore reaches every frame");

    await page.locator(".xrf-fab").click();
    await art.waitForFunction(() => document.querySelectorAll(".xrf-tr").length === 6);
    await page.waitForFunction(() => document.querySelector(".xrf-fab-label").textContent === "还原此页 · 14 段");
    console.log("PASS frames: translate again, counts start over");
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error("FAIL:", e); process.exit(1); });
