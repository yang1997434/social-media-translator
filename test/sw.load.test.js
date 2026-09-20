// Run the actual background -> LLM -> fetch path, with only Chrome storage/network mocked.
const vm = require("vm"), fs = require("fs"), path = require("path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
let listener = null, installed = null;
const removed = [], messages = [], timers = new Set();
const mem = {}, sync = { tr: { apiKey: "test-only-not-a-real-key" } };
const get = (data, keys) => structuredClone(typeof keys === "string" ? { [keys]: data[keys] } : { ...keys, ...data });
let fetchImpl = () => { throw new Error("unexpected fetch"); };
const ctx = vm.createContext({ console, fetch: (...args) => fetchImpl(...args), crypto: globalThis.crypto,
  setTimeout, clearTimeout, AbortController, TextDecoder,
  // Accelerate only heartbeats; queue/model timeout durations remain real.
  setInterval: fn => { const id = setInterval(fn, 25); timers.add(id); return id; },
  clearInterval: id => { timers.delete(id); clearInterval(id); },
  chrome: { storage: { sync: { get: async d => get(sync, d), set: async d => Object.assign(sync, structuredClone(d)), remove: async k => removed.push(["sync", k]) }, local: {
    get: async d => get(mem, d), set: async d => Object.assign(mem, structuredClone(d)),
    remove: async k => removed.push(["local", Array.from(k)]) } },
            tabs: { sendMessage: async (tabId, msg) => messages.push({ tabId, ...msg }) },
            runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener: fn => { installed = fn; } }, openOptionsPage() {} },
            action: { setBadgeText() {}, setBadgeBackgroundColor() {} } } });
ctx.globalThis = ctx;
ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f }));
vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), ctx, { filename: "background.js" });
const send = (texts, reqId = "r") => new Promise(resolve => {
  assert.equal(listener({ type: "translate", texts, reqId }, { tab: { id: 42 } }, resolve), true);
});
const sse = texts => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(texts.map(t => "译文：" + t)) } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
(async () => {
  assert.equal(typeof ctx.XRF_LLM.chat, "function");
  await installed({ reason: "update" });
  assert.deepEqual(removed, [["sync", "video"], ["local", ["vstats", "vaudio"]]]);
  console.log("PASS: update removes only retired feature settings and usage");
  let requests = 0, running = 0, peak = 0;
  fetchImpl = async (url, init) => {
    assert.equal(url, "https://api.siliconflow.cn/v1/chat/completions");
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    assert.equal(body.enable_thinking, false);
    assert.equal(body.model, "Qwen/Qwen3.6-35B-A3B");
    const texts = JSON.parse(body.messages[1].content);
    const index = requests++;
    peak = Math.max(peak, ++running);
    // Reproduces the old 4-second queue failure with multiple tabs/batches.
    await new Promise(r => setTimeout(r, index < 3 ? 4200 : 10));
    running--;
    return sse(texts);
  };
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => send([`Hello ${i}`, `Body ${i}`], `r${i}`)));
  results.forEach((r, i) => {
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(Array.from(r.translations), [`译文：Hello ${i}`, `译文：Body ${i}`]);
  });
  assert.equal(peak, 3);
  assert.equal(requests, 8);
  assert.ok(messages.some(m => m.type === "trProgress" && m.reqId === "r7"));
  assert.equal(messages.filter(m => m.type === "trPartial").length, 16);
  assert.equal(timers.size, 0, "heartbeats must be cleaned up");
  assert.equal(mem.tstats.total.n, 16);
  const cached = await send(["Hello 0", "Body 0"]);
  assert.equal(cached.error, undefined);
  assert.equal(requests, 8, "cache hit must not call the model");
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(Object.keys(mem.tcache).length, 16, "cache is written through to storage");
  console.log("PASS actual worker path: streaming, 8 requests, max 3 concurrent, >4s queue, heartbeat cleanup, cache and stats");

  fetchImpl = async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 });
  assert.match((await send(["auth failure"])).error, /401/);
  assert.equal(timers.size, 0);
  fetchImpl = async () => new Response('data: {"error":{"code":503,"message":"model overloaded"}}\n\n', { headers: { "content-type": "text/event-stream" } });
  assert.match((await send(["in-stream failure"])).error, /503.*model overloaded/);
  assert.equal(timers.size, 0);
  fetchImpl = async () => sse(["recover after error"]);
  assert.equal((await send(["recover after error"])).error, undefined);
  console.log("PASS worker propagates HTTP and in-stream errors, releases slots after failure");

  let malformedCalls = 0;
  fetchImpl = async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content);
    malformedCalls++;
    return sse(input.length > 1 ? ["only one item"] : ["单条恢复：" + input[0]]);
  };
  const recovered = await send(["batch malformed A", "batch malformed B"], "malformed");
  assert.equal(recovered.error, undefined);
  assert.deepEqual(Array.from(recovered.translations), ["译文：单条恢复：batch malformed A", "译文：单条恢复：batch malformed B"]);
  assert.equal(malformedCalls, 3);
  console.log("PASS malformed batch automatically falls back to single-item translations");

  // The model echoed two short items back in English: exactly those get a second, strict pass; the rest are untouched.
  const seen = [];
  const raw = arr => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(arr) } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body), msg = body.messages[1].content;
    seen.push(msg);
    if (!/必须逐项翻译/.test(msg)) return raw(["W", "太真实了", "ratio"]);
    assert.equal(body.stream, false, "the strict pass is a plain request");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(["赢麻了", "反杀"]) } }], usage: { prompt_tokens: 5, completion_tokens: 4 } }), { headers: { "content-type": "application/json" } });
  };
  const strict = await send(["W", "so true", "ratio"], "strict");
  assert.equal(strict.error, undefined);
  assert.deepEqual(Array.from(strict.translations), ["赢麻了", "太真实了", "反杀"]);
  assert.equal(seen.length, 2);
  assert.deepEqual(JSON.parse(seen[1].split("\n")[0]), ["W", "ratio"]);
  console.log("PASS items echoed in the source language get one strict re-pass, cached as final");

  // Users updated from 0.6.1 still have the hanging model and the single-key schema saved: the worker calls the new
  // default, persists the migrated schema, and the key survives.
  sync.tr = { apiKey: "test-only-not-a-real-key", model: "Qwen/Qwen3.5-35B-A3B", priceIn: 0.4, priceOut: 3.2, mode: "bilingual" };
  await installed({ reason: "update" });
  assert.deepEqual(sync.tr.keys, { siliconflow: "test-only-not-a-real-key" });
  assert.deepEqual(sync.tr.models, { siliconflow: "Qwen/Qwen3.6-35B-A3B" });
  assert.equal(sync.tr.provider, "siliconflow"); assert.equal(sync.tr.mode, "bilingual"); assert.equal(sync.tr.priceIn, null);
  assert.ok(!("apiKey" in sync.tr) && !("model" in sync.tr));
  let called = null;
  fetchImpl = async (url, init) => { called = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return sse(["迁移"]); };
  await send(["migrated model"], "migrate");
  assert.equal(called.body.model, "Qwen/Qwen3.6-35B-A3B"); assert.equal(called.auth, "Bearer test-only-not-a-real-key");
  console.log("PASS legacy default model and single-key schema are migrated on update");

  // Cerebras: its own host, default model and reasoning switch; each provider keeps its own key.
  sync.tr = { provider: "cerebras", keys: { siliconflow: "sf-key", cerebras: "csk-test" }, models: { siliconflow: "Qwen/Qwen3.6-35B-A3B" } };
  await send(["cerebras"], "cb");
  assert.equal(called.url, "https://api.cerebras.ai/v1/chat/completions");
  assert.equal(called.auth, "Bearer csk-test");
  assert.equal(called.body.model, "qwen-3.8-27b"); assert.equal(called.body.reasoning_effort, "none"); assert.ok(!("enable_thinking" in called.body));
  let cfg; listener({ type: "trConfig" }, {}, r => { cfg = r; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(cfg.providerName, "Cerebras"); assert.equal(cfg.model, "qwen-3.8-27b"); assert.ok(cfg.price[0] > 5 && cfg.price[1] > 5, "USD list price converted to ¥");
  // OpenRouter: unified reasoning object, Gemini floor is "low".
  sync.tr = { provider: "openrouter", keys: { openrouter: "sk-or-test" } };
  await send(["openrouter"], "or");
  assert.equal(called.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(called.body.reasoning, { effort: "minimal", exclude: true }); assert.ok(!("enable_thinking" in called.body));
  sync.tr = { provider: "openrouter", keys: { openrouter: "sk-or-test" }, models: { openrouter: "qwen/qwen3.6-35b-a3b" } };
  await send(["openrouter qwen"], "or2");
  assert.deepEqual(called.body.reasoning, { enabled: false, exclude: true });
  // Cost is booked at request time: SiliconFlow list price, Cerebras list price (USD×7.1), OpenRouter's exact figure.
  const before = mem.tstats.total.cost || 0;
  sync.tr = { keys: { siliconflow: "k" } };
  fetchImpl = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(["一"]) } }], usage: { prompt_tokens: 1e6, completion_tokens: 1e6 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  await send(["cost sf"], "c1");
  assert.equal(+(mem.tstats.total.cost - before).toFixed(3), 12.6, "SiliconFlow: 1M in + 1M out at list price");
  sync.tr = { provider: "openrouter", keys: { openrouter: "k" } };
  fetchImpl = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(["二"]) } }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.5 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  await send(["cost or"], "c2");
  assert.equal(+(mem.tstats.total.cost - before).toFixed(3), +(12.6 + 0.5 * 7.1).toFixed(3), "OpenRouter: exact USD cost converted, added to the same bucket");
  assert.equal(mem.tstats.today.cost, mem.tstats.total.cost);
  console.log("PASS cost is booked per request at the serving model's price; provider switches don't re-price history");

  // A provider without a key is "not configured", never a request with an empty bearer.
  sync.tr = { provider: "cerebras", keys: { siliconflow: "sf-key" } };
  assert.match((await send(["no key"], "nokey")).error, /未配置/);
  console.log("PASS provider switch: Cerebras and OpenRouter hosts, per-provider keys/models, reasoning switches, missing key");
})().catch(e => { console.error(e); process.exitCode = 1; });
