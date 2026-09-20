// A provider that accepts the connection and never answers (observed on SiliconFlow) must cost one short watchdog, not
// the whole deadline: chat() opens a fresh request and the second one wins. Same for a stream that goes quiet mid-way.
const assert = require("node:assert/strict"), { chat } = require("../llm.js");
const provider = { baseUrl: "https://example.com/v1", apiKey: "test", model: "test" };
const sse = content => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
const never = signal => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
(async () => {
  let calls = 0, t0 = Date.now();
  let r = await chat(provider, ["Hello"], { stream: true, ttfbTimeoutMs: 60, fetch: async (_u, { signal }) => (++calls === 1 ? never(signal) : sse('["你好"]')) });
  assert.equal(r.content, '["你好"]'); assert.equal(calls, 2); assert.ok(Date.now() - t0 < 1000, "retried right after the first-byte watchdog");

  calls = 0; t0 = Date.now();
  r = await chat(provider, ["Hello"], { stream: true, stallTimeoutMs: 60, fetch: async (_u, { signal }) => ++calls === 1
    ? new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"["}}]}\n')); signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))); } }), { headers: { "content-type": "text/event-stream" } })
    : sse('["你好"]') });
  assert.equal(r.content, '["你好"]'); assert.equal(calls, 2); assert.ok(Date.now() - t0 < 1000, "retried right after the stall watchdog");

  calls = 0;
  await assert.rejects(chat(provider, ["Hello"], { stream: true, ttfbTimeoutMs: 20, timeoutMs: 500, fetch: async (_u, { signal }) => { calls++; return never(signal); } }), /无响应|超时/);
  assert.equal(calls, 3, "bounded attempts");

  calls = 0;
  await assert.rejects(chat(provider, ["Hello"], { stream: true, ttfbTimeoutMs: 20, timeoutMs: 30, retries: 5, fetch: async (_u, { signal }) => { calls++; return never(signal); } }), /翻译请求超时/);
  assert.ok(calls <= 2, "the overall deadline still wins");

  calls = 0;
  r = await chat(provider, ["Hello"], { stream: true, retryDelayMs: 1, fetch: async () => (++calls === 1 ? new Response('data: {"error":{"code":503,"message":"overloaded"}}\n\n', { headers: { "content-type": "text/event-stream" } }) : sse('["你好"]')) });
  assert.equal(r.content, '["你好"]'); assert.equal(calls, 2, "an in-stream 503 is retried like an HTTP 503");

  calls = 0;
  r = await chat(provider, ["Hello"], { stream: true, retryDelayMs: 1, fetch: async () => { if (++calls === 1) throw new TypeError("fetch failed"); return sse('["你好"]'); } });
  assert.equal(r.content, '["你好"]'); assert.equal(calls, 2, "a network error is retried once");
  console.log("PASS first-byte and stall watchdogs reconnect instead of waiting out the deadline; bounded attempts; in-stream 503 and network errors retried");
})().catch(e => { console.error(e); process.exitCode = 1; });
