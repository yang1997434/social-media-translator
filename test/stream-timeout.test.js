const assert = require("node:assert/strict");
const { chat } = require("../llm.js");
(async () => {
  await assert.rejects(chat({ baseUrl: "https://example.com/v1", apiKey: "test", model: "test" }, ["Hello"], {
    stream: true, timeoutMs: 30,
    fetch: async (_url, { signal }) => ({ ok: true, body: new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"["}}]}\n'));
      // HTTP headers arrived, but the stream never finishes.
    } }) }),
  }), /超时/);
  console.log("PASS timeout covers a stalled response body");
})().catch(e => { console.error(e); process.exitCode = 1; });
