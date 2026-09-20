const assert = require("node:assert/strict"), { chat } = require("../llm.js");
const provider = { baseUrl: "https://example.com/v1", apiKey: "test", model: "test" };
const event = content => "data: " + JSON.stringify({ choices: [{ delta: { content } }] });
(async () => {
  const encoded = new TextEncoder().encode(event('["你好"]')); // no final newline
  let partial;
  const result = await chat(provider, ["Hello"], { stream: true, onContent: c => { partial = c; }, fetch: async () => new Response(new ReadableStream({ start(c) {
    // Split inside both JSON and multibyte Chinese text.
    for (const byte of encoded) c.enqueue(new Uint8Array([byte]));
    c.close();
  } })) });
  assert.equal(result.content, '["你好"]');
  assert.equal(partial, '["你好"]');
  const json = await chat(provider, ["Hello"], { stream: true, fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '["你好"]' } }] }), { headers: { "content-type": "application/json" } }) });
  assert.equal(json.content, '["你好"]');
  for (const stream of [true, false]) {
    await assert.rejects(chat(provider, ["Hello"], { stream, fetch: async () => new Response('{"error":{"code":503,"message":"overloaded"}}', { headers: { "content-type": "application/json" } }) }), /503.*overloaded/);
  }
  let cancelled = false;
  const done = await chat(provider, ["Hello"], { stream: true, timeoutMs: 100, fetch: async () => new Response(new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode(event('["你好"]') + '\n\ndata: [DONE]\n\n'));
    // Server leaves the transport open after the final SSE event.
  }, cancel() { cancelled = true; } })) });
  assert.equal(done.content, '["你好"]');
  assert.equal(cancelled, true);
  console.log("PASS SSE tail, split UTF-8, JSON fallback, structured errors and DONE termination");
})().catch(e => { console.error(e); process.exitCode = 1; });
