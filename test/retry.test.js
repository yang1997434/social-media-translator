const assert = require("node:assert/strict"), { chat } = require("../llm.js");
const provider = { baseUrl: "https://example.com/v1", apiKey: "test", model: "test" };
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '["你好"]' } }] }), { status: 200 });
(async () => {
  let calls = 0;
  const r = await chat(provider, ["Hello"], { retryDelayMs: 1, fetch: async () => ++calls < 3 ? new Response("overloaded", { status: 503 }) : ok() });
  assert.equal(calls, 3); assert.equal(r.content, '["你好"]');
  calls = 0;
  await assert.rejects(chat(provider, ["Hello"], { retryDelayMs: 1, fetch: async () => { calls++; return new Response("overloaded", { status: 503 }); } }), /服务繁忙/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(chat(provider, ["Hello"], { fetch: async () => { calls++; return new Response("bad key", { status: 401 }); } }), /401/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(chat(provider, ["Hello"], { fetch: async () => { calls++; return new Response("wait", { status: 429, headers: { "retry-after": "60" } }); } }), /429/);
  assert.equal(calls, 1);
  console.log("PASS bounded 503 retries, recovery, no auth retries, Retry-After respected");
})().catch(e => { console.error(e); process.exitCode = 1; });
