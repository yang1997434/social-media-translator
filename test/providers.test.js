// Provider table + key detection through the real background.js / llm.js, with only fetch and chrome.* faked.
// Proves: which hosts a pasted key is sent to (never another company's), region pick, rejected keys, model pick,
// per-provider request bodies, and the stream_options fallback.
const vm = require("vm"), fs = require("fs"), path = require("path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
const M = require("../llm.js");
const { PROVIDERS } = require("../providers.js");

let listener = null, calls = [], routes = {};
const ctx = vm.createContext({ console, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, TextDecoder, Response, URL,
  fetch: async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, headers: init.headers || {} });
    const r = routes[u.host] || { status: 401 };
    return new Response(JSON.stringify(r.body ?? (r.status === 200 ? { data: (r.models || []).map(id => ({ id })) } : { error: { message: "nope" } })), { status: r.status, headers: { "content-type": "application/json" } });
  },
  chrome: { storage: { sync: { get: async d => d, set: async () => {}, remove: async () => {} }, local: { get: async d => d, set: async () => {}, remove: async () => {} } },
    tabs: { sendMessage: async () => {} }, runtime: { onMessage: { addListener: fn => { listener = fn; } }, onInstalled: { addListener() {} }, openOptionsPage() {} },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} } } });
ctx.globalThis = ctx;
ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f }));
vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), ctx, { filename: "background.js" });
const detect = (key, company, r = {}) => { calls = []; routes = r; return new Promise(res => listener({ type: "trDetect", key, company }, {}, v => res(JSON.parse(JSON.stringify(v))))); };   // as chrome messaging would
const hosts = () => [...new Set(calls.map(c => c.host))].sort();
const hex = n => "0123456789abcdef".repeat(8).slice(0, n);

(async () => {
  // A distinctive prefix names the provider outright; only its own host is asked.
  let r = await detect("csk-" + "a1".repeat(24), null, { "api.cerebras.ai": { status: 200, models: ["qwen-3.8-27b", "gpt-oss-120b"] } });
  assert.deepEqual([r.provider, r.model, hosts()], ["cerebras", "qwen-3.8-27b", ["api.cerebras.ai"]]);
  console.log("PASS prefix key (csk-): Cerebras, only api.cerebras.ai asked");

  // sk-<32 hex> is DeepSeek's or Bailian's: the user picks, the key goes nowhere meanwhile.
  r = await detect("sk-" + hex(32));
  assert.deepEqual(r.choices.map(c => c.company).sort(), ["bailian", "deepseek"]);
  assert.equal(calls.length, 0, "an ambiguous key is not sent anywhere");
  console.log("PASS ambiguous key (sk-<32 hex>): DeepSeek / 阿里云百炼 offered, no request made");

  // Picked Bailian: both of its regions are asked, never DeepSeek; the account lives in Singapore.
  r = await detect("sk-" + hex(32), "bailian", { "dashscope-intl.aliyuncs.com": { status: 200, models: ["qwen-flash", "qwen3.8-flash", "qwen-max"] } });
  assert.deepEqual([r.provider, r.model, hosts()], ["bailian_intl", "qwen3.8-flash", ["dashscope-intl.aliyuncs.com", "dashscope.aliyuncs.com"]]);
  console.log("PASS company picked: its China + global hosts asked, the region that knows the key wins");

  // SiliconFlow's all-lowercase key vs Kimi's mixed-case one, same length.
  r = await detect("sk-" + "k".repeat(48), null, { "api.siliconflow.cn": { status: 200, models: ["Qwen/Qwen3.6-35B-A3B"] } });
  assert.deepEqual([r.provider, hosts()], ["siliconflow", ["api.siliconflow.cn", "api.siliconflow.com"]]);
  r = await detect("sk-" + "kQ7".repeat(16), null, { "api.moonshot.ai": { status: 200, models: ["kimi-k2.6", "kimi-k3"] } });
  assert.deepEqual([r.provider, r.model, hosts()], ["moonshot_intl", "kimi-k2.6", ["api.moonshot.ai", "api.moonshot.cn"]]);
  r = await detect("sk-" + "A".repeat(20) + "T3BlbkFJ" + "b".repeat(20), null, { "api.openai.com": { status: 200, models: ["gpt-4.1", "gpt-5.4-mini", "gpt-5.4-nano"] } });
  assert.deepEqual([r.provider, r.model, hosts()], ["openai", "gpt-5.4-nano", ["api.openai.com"]], "legacy OpenAI key is not Kimi's; default missing → preferred nano");
  console.log("PASS sk-<48>: SiliconFlow (lowercase), Kimi (mixed case, .ai region), legacy OpenAI (T3BlbkFJ) told apart");

  // Zhipu has no model list: a 404 past auth still proves the region.
  r = await detect(hex(32) + ".AbCdEfGh12345678", null, { "open.bigmodel.cn": { status: 404 } });
  assert.deepEqual([r.provider, r.model, r.models, hosts()], ["zhipu", "glm-4.7-flashx", null, ["api.z.ai", "open.bigmodel.cn"]]);
  console.log("PASS Zhipu key: 404 (no /models) on bigmodel.cn vs 401 on z.ai picks the China region");

  // Rejected everywhere (Gemini answers a bad key with 400).
  r = await detect("AIza" + "x".repeat(35), null, { "generativelanguage.googleapis.com": { status: 400, body: [{ error: { message: "API key not valid" } }] } });
  assert.deepEqual([r.provider, r.error], ["gemini", "rejected"]);
  console.log("PASS rejected key: provider named, error surfaced");

  // Host down: trust the shape.
  r = await detect("gsk_" + "z".repeat(40), null, { "api.groq.com": { status: 503 } });
  assert.deepEqual([r.provider, r.model, !!r.unverified], ["groq", "qwen/qwen3.8-27b", true]);
  console.log("PASS host unreachable: shape trusted, marked unverified");

  // Anthropic: its headers go along; the dated Haiku id stands in for the alias.
  r = await detect("sk-ant-api03-" + "x".repeat(40), null, { "api.anthropic.com": { status: 200, models: ["claude-haiku-4-5-20251001", "claude-sonnet-5"] } });
  assert.deepEqual([r.provider, r.model], ["anthropic", "claude-haiku-4-5-20251001"]);
  assert.equal(calls[0].headers["anthropic-version"], "2023-06-01"); assert.equal(calls[0].headers["anthropic-dangerous-direct-browser-access"], "true");
  console.log("PASS Anthropic: version + browser-access headers sent, dated Haiku picked");

  // Unknown shape: nothing sent.
  r = await detect("totally-not-a-key-1234567890");
  assert.deepEqual([r.error, calls.length], ["unknown", 0]);
  console.log("PASS unknown shape: nothing sent");

  // Every key shape in the table points at exactly one company, or at a set the user picks from.
  const samples = { siliconflow: "sk-" + "q".repeat(48), deepseek: "sk-" + hex(32), bailian: "sk-ws" + "Ab12".repeat(8), moonshot: "sk-" + "Ab1".repeat(16), zhipu: hex(32) + ".AbCdEfGh12345678",
    volcengine: ["ark", "12345678-1234-1234-1234-123456789abc", "xyz12"].join("-"),   // assembled: a literal trips GitHub push protection qianfan: "bce-v3/ALTAK-abc/def", minimax: "sk-cp-" + "x".repeat(40), openai: "sk-proj-" + "x".repeat(40),
    google: "AIza" + "x".repeat(35), anthropic: "sk-ant-" + "x".repeat(40), xai: "xai-" + "x".repeat(80), groq: "gsk_" + "x".repeat(40), cerebras: "csk-" + "x".repeat(40),
    openrouter: "sk-or-v1-" + hex(64), mistral: "Ab1".repeat(10) + "Ab", together: "tgp_v1_" + "x".repeat(40), fireworks: "fw_" + "x".repeat(24) };
  for (const [company, key] of Object.entries(samples)) {
    const cos = [...new Set(Object.values(PROVIDERS).filter(p => p.key && new RegExp(p.key).test(key)).map(p => p.company))];
    assert.ok(cos.includes(company), `${company} key matched by its own pattern`);
    assert.ok(cos.length === 1 || ["deepseek", "mistral"].includes(company), `${company} key is unambiguous (got ${cos})`);
  }
  console.log("PASS every company's key shape matches only itself (except the known pairs DeepSeek/百炼, Mistral/DeepInfra)");

  // Request bodies per provider: reasoning off the way each host wants it, and nothing a strict schema would reject.
  const body = id => M.buildBody(PROVIDERS[id].model, ["hi"], true, false, PROVIDERS[id].thinking, { temp: PROVIDERS[id].temp });
  assert.deepEqual(body("deepseek").thinking, { type: "disabled" });
  assert.deepEqual(body("volcengine").thinking, { type: "disabled" });
  assert.equal(body("openai").reasoning_effort, "none"); assert.ok(!("temperature" in body("openai")));
  assert.ok(!("reasoning_effort" in M.buildBody("gpt-4.1-mini", ["hi"], true, false, "reasoning_effort")), "plain chat model gets no reasoning_effort");
  const gem = body("gemini");
  assert.deepEqual(Object.keys(gem).sort(), ["messages", "model", "stream", "stream_options", "temperature"], "Gemini: only fields its schema knows");
  assert.ok(!("temperature" in body("moonshot")) && !("temperature" in body("anthropic")));
  assert.deepEqual(body("together").reasoning, { enabled: false });
  assert.equal(body("bailian").enable_thinking, false);
  assert.ok(!("enable_thinking" in body("qianfan")) && !("thinking" in body("qianfan")));
  console.log("PASS request bodies: thinking off per host, no temperature where rejected, nothing extra for Gemini");

  // A host whose schema lacks stream_options: dropped and asked again at once.
  const seen = [];
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: '["你好"]' } }] })}\n\ndata: [DONE]\n\n`;
  const out = await M.chat({ baseUrl: "https://h/v1", apiKey: "k", model: "m", thinking: "none" }, ["hi"], { stream: true, retryDelayMs: 1, fetch: async (_u, init) => {
    const b = JSON.parse(init.body); seen.push("stream_options" in b);
    return seen.length === 1 ? new Response('{"detail":[{"loc":["body","stream_options"],"msg":"Extra inputs are not permitted"}]}', { status: 422 })
      : new Response(sse, { headers: { "content-type": "text/event-stream" } });
  } });
  assert.deepEqual([seen, M.parseBatch(out.content, 1)], [[true, false], ["你好"]]);
  console.log("PASS stream_options rejected (422): retried once without it");
})().catch(e => { console.error("FAIL:", e); process.exit(1); });
