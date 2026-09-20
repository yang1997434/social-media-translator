// Run with PLAYWRIGHT_MODULE pointing to an installed playwright package when needed.
// Uses mock translations: no API key or paid requests.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const base = "http://localhost:8766";
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 4000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      const heartbeatTest = location.search.includes("heartbeat");
      const lostWorkerTest = location.search.includes("lost-worker");
      if (heartbeatTest || lostWorkerTest) {
        const timer = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 45000 ? 150 : ms, ...args);
      }
      Object.defineProperty(window, "chrome", { configurable: true, set(value) {
        Object.defineProperty(window, "chrome", { value, configurable: true });
        const send = value.runtime.sendMessage;
        window.requests = [];
        value.runtime.sendMessage = async msg => {
          if (msg.type !== "translate") return send(msg);
          const index = window.requests.push(msg) - 1;
          if (lostWorkerTest) return new Promise(() => {});
          const heartbeat = heartbeatTest ? setInterval(() => window.__mock.onMessage({ type: "trProgress", reqId: msg.reqId }, {}, () => {}), 25) : null;
          try { await new Promise(r => setTimeout(r, index === 0 ? (window.slowFirst || 900) : 80)); }
          finally { clearInterval(heartbeat); }
          if (window.failFirst && index === 0) return { error: "模型服务繁忙 (503)，请稍后重试" };
          if (window.malformedUi) {
            window.malformedUi = false;
            window.__mock.onMessage({ type: "trPartial", reqId: msg.reqId, index: 0, text: "错误的提前片段" }, {}, () => {});
            return { translations: msg.texts.map((_, i) => `最终修复译文 ${i}`) };
          }
          const translations = msg.texts.map(t => "简体译文 " + (t.match(/\[\[\d+\]\]/g) || []).join(" "));
          translations.forEach((text, i) => window.__mock.onMessage({ type: "trPartial", reqId: msg.reqId, index: i, text }, {}, () => {}));
          return { translations };
        };
      } });
    });
    const message = msg => page.evaluate(msg => new Promise(resolve => window.__mock.onMessage(msg, {}, resolve)), msg);
    const done = () => page.waitForFunction(() => {
      let ready = false;
      window.__mock.onMessage({ type: "getTrStats" }, {}, s => { ready = s.enabled && s.pending === 0 && s.translated > 0; });
      return ready && !!document.querySelector(".xrf-tr") && !document.querySelector(".xrf-tr-loading");
    });
    await page.goto(base + "/test/translate.fixture.html");
    await done();
    assert.ok(await page.evaluate(() => window.requests.length) >= 3);
    console.log("PASS X: concurrent streamed responses render immediately");
    // Trend rows: the name span is translated, the Chinese category / count spans are left alone, the menu button untouched.
    await page.waitForFunction(() => [...document.querySelectorAll('#trends [data-testid="trend"]')].every(t => t.querySelector(".xrf-tr")));
    // 関 is a Japanese variant (ICU maps it to 关), so X's half-localised "関東地方 的趋势" label is translated too — harmless.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#trends .xrf-replaced')].map(el => el.dataset.xrfTr + ":" + el.firstChild.nodeValue)), ["done:#納豆パスタ", "done:関東地方 的趋势", "done:バルコラ", "done:Fable 5.1 usage limits"]);
    assert.equal(await page.locator('#trends button .xrf-tr, #trends [data-xrf-tr] [data-xrf-tr]').count(), 0);   // no menu button, no nested double translation
    console.log("PASS X trends: leaf names translated, category/count/menu untouched");
    // Tweets X already translates with Grok are left alone in both states (translated, and after 显示原文).
    await page.waitForFunction(() => document.querySelector("#grok-orig [data-testid=tweetText]")?.dataset.xrfTr && document.querySelector("#grok-zh [data-testid=tweetText]")?.dataset.xrfTr);
    assert.deepEqual(await page.evaluate(() => ["grok-zh", "grok-orig"].map(id => document.querySelector(`#${id} [data-testid=tweetText]`).dataset.xrfTr)), ["skip", "skip"]);
    assert.equal(await page.locator("#grok-zh .xrf-tr, #grok-orig .xrf-tr").count(), 0);
    assert.ok(!(await page.evaluate(() => window.requests.some(r => r.texts.some(t => /Qwen-Image-2\.1/.test(t))))), "never sent to the model");
    console.log("PASS X Grok-translated tweets are left to X, no tokens spent, 显示原文 not undone");
    // SPA navigation that swaps <body> (Turbo-style): new content must still be picked up without a reload.
    await page.evaluate(() => {
      const nb = document.createElement("body"); nb.innerHTML = '<div id="timeline"><article data-testid="tweet"><div data-testid="tweetText" lang="en"><span>Content rendered after a body swap.</span></div></article></div>';
      document.documentElement.replaceChild(nb, document.body);
      history.pushState({}, "", "/news");
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="tweetText"]')?.dataset.xrfTr === "done" && document.querySelector(".xrf-tr")?.textContent.startsWith("简体译文"));
    console.log("PASS SPA body swap + route change: new content translated without reload");
    await page.goto(base + "/test/translate.fixture.html");
    await done();
    await page.locator('[data-testid="tweetText"].xrf-replaced').first().hover();
    await page.locator('[data-testid="tweetText"] .xrf-tr-toggle').first().click();
    assert.equal(await page.locator(".xrf-show-orig").count(), 1);
    await page.locator('[data-testid="tweetText"] .xrf-tr-toggle').first().click();
    assert.equal(await page.locator(".xrf-show-orig").count(), 0);
    console.log("PASS original/translation toggle");
    await page.waitForFunction(() => document.querySelector('[data-testid="tweet"]:last-child [data-testid="tweetText"]')?.dataset.xrfTr === "done" && document.body.textContent.includes("Late"));
    console.log("PASS streaming partials and dynamically appended replies");
    const exactMiss = "Yo I stumbled upon your work few days back! It's impressive and helpful for something I am trying to build !";
    await page.evaluate(text => {
      const noise = document.createElement("i"); noise.id = "continuous-noise"; document.body.append(noise);
      window.__noiseTimer = setInterval(() => { noise.textContent = String(Date.now()); }, 30);
      const article = document.createElement("article"); article.id = "continuously-added";
      article.innerHTML = '<div data-testid="tweetText" lang="en"></div>';
      article.querySelector('[data-testid="tweetText"]').textContent = text;
      document.querySelector("#timeline").append(article);
    }, exactMiss);
    await page.waitForFunction(text => document.querySelector("#continuously-added [data-testid=tweetText]")?.dataset.xrfTr === "done" && window.requests.some(r => r.texts.includes(text)), exactMiss);
    await page.evaluate(() => clearInterval(window.__noiseTimer));
    console.log("PASS X continuous mutations cannot starve a newly loaded English reply");
    await page.evaluate(() => {
      const article = document.createElement("article"); article.id = "recycled-tweet";
      article.innerHTML = '<div data-testid="tweetText" lang="zh">这是一条中文</div>';
      document.querySelector("#timeline").append(article);
    });
    await page.waitForFunction(() => document.querySelector("#recycled-tweet [data-testid=tweetText]")?.dataset.xrfTr === "skip");
    await page.evaluate(text => { const el = document.querySelector("#recycled-tweet [data-testid=tweetText]"); el.firstChild.nodeValue = text; el.lang = "en"; }, exactMiss);
    await page.waitForFunction(text => document.querySelector("#recycled-tweet [data-testid=tweetText]")?.dataset.xrfTr === "done" && window.requests.some(r => r.texts.includes(text)), exactMiss);
    console.log("PASS X recycled text nodes are re-evaluated when Chinese changes to English");
    await page.evaluate(() => {
      window.malformedUi = true;
      const wrap = document.createElement("article"); wrap.id = "repaired-batch";
      wrap.innerHTML = '<div data-testid="tweetText" lang="en">First malformed batch item</div><div data-testid="tweetText" lang="en">Second malformed batch item</div>';
      document.querySelector("#timeline").append(wrap);
    });
    await page.waitForFunction(() => [...document.querySelectorAll("#repaired-batch .xrf-tr")].every((el, i) => el.textContent === `最终修复译文 ${i}`));
    console.log("PASS final repaired batch replaces an incorrect streamed preview");
    await page.goto(base + "/test/generic.fixture.html");
    assert.equal((await message({ type: "getTrStats" })).enabled, false);
    // Side tab: present on any page, click translates, click again restores; never translated itself; hidden by the setting.
    await page.locator(".xrf-fab").waitFor();
    assert.equal(await page.locator(".xrf-fab-label").textContent(), "翻译此页");
    await page.locator(".xrf-fab").hover();
    await page.locator(".xrf-fab").click();
    await done();
    assert.match(await page.locator(".xrf-fab-label").textContent(), /^还原此页 · \d+ 段$/);
    assert.equal(await page.locator(".xrf-fab .xrf-tr, .xrf-fab[data-xrf-tr]").count(), 0);
    await page.locator(".xrf-fab").click();
    await page.waitForFunction(() => !document.querySelector(".xrf-tr"));
    assert.equal(await page.locator(".xrf-fab-label").textContent(), "翻译此页");
    console.log("PASS side tab: translate / restore from the page edge, kept out of translation");
    await page.goto(base + "/test/generic.fixture.html?fab=0");
    await page.waitForTimeout(400);
    assert.equal(await page.locator(".xrf-fab").count(), 0);
    console.log("PASS side tab: hidden by the setting");
    await page.goto(base + "/test/generic.fixture.html");
    await message({ type: "trTogglePage" });
    await page.waitForFunction(() => window.requests.length > 0);
    await message({ type: "trTogglePage" });
    await page.waitForTimeout(1000);
    assert.equal(await page.locator(".xrf-tr").count(), 0);
    await message({ type: "trTogglePage" });
    await done();
    const first = (await message({ type: "getTrStats" })).translated;
    assert.equal(await page.locator("nav .xrf-tr, pre .xrf-tr, footer .xrf-tr").count(), 0);
    assert.equal(await page.locator("li.xrf-replaced").count(), 2, await page.locator("body").innerHTML());
    await message({ type: "trTogglePage" });
    await message({ type: "trTogglePage" });
    await done();
    assert.equal((await message({ type: "getTrStats" })).translated, first);
    await page.evaluate(() => chrome.storage.sync.set({ tr: { ...window.__mock.sync.mem.tr, enabled: false } }));
    await page.waitForFunction(() => !document.querySelector(".xrf-tr"));
    assert.equal((await message({ type: "getTrStats" })).enabled, false);
    await message({ type: "trTogglePage" });
    await done();
    assert.equal(await page.evaluate(() => window.__mock.sync.mem.tr.enabled), true);
    console.log("PASS generic: manual start, restore mid-request, restart, counts, global switch, protected blocks");
    for (const site of ["x", "reddit", "generic"]) {
      await page.goto(base + "/test/generic.fixture.html");
      await page.evaluate(site => {
        document.documentElement.dataset.xrfSite = site;
        window.__xrfTr = false;
        document.body.innerHTML = '<div slot="comment"></div>';
        const texts = ["這是繁體中文", "مرحبا بالعالم", "สวัสดี", "नमस्ते", "שלום", "안녕", "ok", "今天不错 thanks", "这个 harness 很简单，Jev 选择动作，macOS 执行，LLM 做不到。", "这是简体中文"];
        texts.forEach(text => {
          const p = document.createElement("p"); p.dataset.testid = "tweetText"; p.textContent = text;
          document.querySelector("[slot=comment]").append(p);
        });
      }, site);
      await page.addScriptTag({ url: base + "/translator.js" });
      if (site === "generic") await message({ type: "trTogglePage" });
      await done();
      assert.equal(await page.locator(".xrf-tr").count(), 8);
      assert.equal(await page.locator("p").nth(8).getAttribute("data-xrf-tr"), "skip");
      assert.equal(await page.locator("p").last().getAttribute("data-xrf-tr"), "skip");
      console.log(`PASS ${site}: Traditional, Arabic, Thai, Hindi, Hebrew, Korean, short/mixed text; Simplified skipped`);
    }
    await page.addInitScript(() => { window.slowFirst = location.search.includes("slow") ? 4000 : 0; });
    await page.goto(base + "/test/reddit-preview.fixture.html");
    await done();
    assert.equal(await page.locator(".xrf-tr").count(), 8);
    assert.equal(await page.locator('[slot="text-body"] .xrf-tr .xrf-tr').count(), 0);
    // 近期帖子: the two titles are translated; r/Name, 1小时前 and 5 个赞同 are not even sent.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("recent-posts .xrf-replaced")].map(el => el.firstChild.nodeValue)), ["How Are Others Handling Fable 5.1 Usage Limits?", "Working remotely abroad"]);
    assert.ok(!(await page.evaluate(() => window.requests.some(r => r.texts.some(t => /^r\/|赞同|小时前/.test(t))))));
    console.log("PASS Reddit feed: titles, plain preview bodies, nested paragraphs and the recent-posts sidebar");
    await page.goto(base + "/test/translate.fixture.html?slow=1");
    await page.waitForSelector(".xrf-tr-loading");
    assert.equal(await page.locator(".xrf-tr-loading > span").first().evaluate(el => getComputedStyle(el).opacity), "1");
    await page.waitForFunction(() => document.querySelectorAll(".xrf-tr").length > 0);
    assert.equal(await page.locator('[data-testid="tweetText"]').first().getAttribute("data-xrf-tr"), "queued");
    assert.ok(await page.locator(".xrf-tr").count() > 0);
    await done();
    console.log("PASS slow first batch: later translations show before it finishes");
    await page.goto(base + "/test/translate.fixture.html?heartbeat=1");
    await done();
    assert.equal(await page.locator(".xrf-tr-err").count(), 0);
    console.log("PASS queued requests: heartbeat extends the page watchdog without dimming text");
    await page.goto(base + "/test/translate.fixture.html?lost-worker=1");
    await page.waitForSelector(".xrf-tr-err");
    assert.match((await message({ type: "getTrStats" })).lastError, /后台未响应/);
    console.log("PASS missing worker: watchdog still offers retry");
    await page.goto(base + "/test/generic.fixture.html");
    await page.evaluate(() => {
      document.body.innerHTML = "";
      for (let i = 0; i < 8; i++) {
        const p = document.createElement("p"); p.textContent = `Paragraph ${i}: ` + "Long text for translation. ".repeat(40); document.body.append(p);
      }
    });
    await message({ type: "trTogglePage" });
    await done();
    assert.ok(await page.evaluate(() => window.requests.every(r => r.texts.length === 1)));
    console.log("PASS long paragraphs use separate batches");
    await page.goto(base + "/test/generic.fixture.html");
    await page.evaluate(() => {
      document.body.innerHTML = '<p style="position:absolute;top:-160px;height:30px">Prefetch paragraph above the screen</p><p style="position:absolute;top:100px">Visible paragraph must go first</p>';
    });
    await message({ type: "trTogglePage" });
    await done();
    assert.equal(await page.evaluate(() => window.requests[0].texts[0]), "Visible paragraph must go first");
    console.log("PASS viewport content requested before offscreen prefetch");
    await page.addInitScript(() => { window.failFirst = true; });
    await page.goto(base + "/test/translate.fixture.html");
    await done();
    assert.equal(await page.locator(".xrf-tr-err").count(), 6);
    assert.match(await page.locator(".xrf-tr-err").first().textContent(), /503/);
    assert.match((await message({ type: "getTrStats" })).lastError, /503/);
    await page.locator(".xrf-tr-err").first().click();
    await page.waitForFunction(() => document.querySelectorAll(".xrf-tr-err").length === 5);
    // The remaining five recover on their own (transient error -> automatic retry after 3s), no clicks needed.
    await page.waitForFunction(() => document.querySelectorAll(".xrf-tr-err").length === 0 && !document.querySelector(".xrf-tr-loading"), null, { timeout: 8000 });
    console.log("PASS failed batch releases later translations; manual retry works; the rest retry automatically");
    await page.goto(base + "/test/ui.fixture.html?page=popup&url=https://example.com/article");
    const popup = page.frameLocator("#popup");
    await popup.getByRole("button", { name: "翻译此页", exact: true }).click();
    await popup.getByRole("button", { name: "还原此页", exact: true }).waitFor();
    await page.screenshot({ path: "/private/tmp/xrf-popup-acceptance.png" });
    await popup.getByRole("button", { name: "还原此页", exact: true }).click();
    await popup.getByRole("button", { name: "翻译此页", exact: true }).waitFor();
    assert.equal(await popup.locator("section.card").count(), 1);
    assert.match(await popup.locator("#uMonth").textContent(), /^¥/);
    console.log("PASS actual popup UI: translate/restore button flow (mock Chrome APIs)");
    await page.goto(base + "/test/ui.fixture.html?page=options");
    const options = page.frameLocator("#options");
    await options.locator("#tr_model").waitFor();
    assert.equal(await options.locator("section.card").count(), 2);
    assert.equal(await options.locator("#tr_apiKey").inputValue(), "sk-mock");
    console.log("PASS options UI: translation and filter settings load");
    for (const query of ["timeline=1", "thread=1", "timeline=1&keep=1"]) {
      await page.goto(base + "/test/fixture.html?" + query);
      const ad = page.locator('article').filter({ has: page.locator('a[href="/CrystalEngc7/status/200"]') });
      if (query.includes("keep")) {
        await page.waitForTimeout(1000);
        assert.equal(await ad.getAttribute("data-xrf"), null);
      } else await page.waitForFunction(() => document.querySelector('a[href="/CrystalEngc7/status/200"]').closest('article').classList.contains('xrf-hidden'));
      if (query.includes("timeline")) {
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => window.__xrfMsgs.filter(m => m.type === "classify").length), 0);
        assert.equal(await page.locator('article').filter({ has: page.locator('a[href="/bot_user48213/status/106"]') }).getAttribute("data-xrf"), null);
      }
      console.log(`PASS filter ${query}: screenshot spam / keep preference / timeline scope`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
