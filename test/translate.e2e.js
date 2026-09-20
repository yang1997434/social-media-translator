// Real request through llm.js. Proves: endpoint reachable, model translates to Chinese, [[n]] placeholders survive, streaming parses.
//   SILICONFLOW_API_KEY=sk-... node test/translate.e2e.js
//   OPENROUTER_API_KEY=sk-or-... MODEL=qwen/qwen3.5-35b-a3b node test/translate.e2e.js
//   BASE_URL=https://host/v1 API_KEY=... MODEL=... node test/translate.e2e.js
const M = require("../llm.js");
const env = process.env;
const provider = env.BASE_URL ? { baseUrl: env.BASE_URL, apiKey: env.API_KEY, model: env.MODEL }
  : env.SILICONFLOW_API_KEY ? { baseUrl: "https://api.siliconflow.cn/v1", apiKey: env.SILICONFLOW_API_KEY, model: env.MODEL || "Qwen/Qwen3.5-35B-A3B" }
  : env.OPENROUTER_API_KEY ? { baseUrl: "https://openrouter.ai/api/v1", apiKey: env.OPENROUTER_API_KEY, model: env.MODEL || "qwen/qwen3.5-35b-a3b" } : null;
if (!provider?.apiKey) { console.log("set SILICONFLOW_API_KEY or OPENROUTER_API_KEY (or BASE_URL+API_KEY+MODEL)"); process.exit(2); }

const texts = [
  "Honestly this is the best take I've seen on the whole thing, [[0]] nailed it [[1]]",
  "Does the compaction fix also apply to the CLI or only the desktop app?",
  "so true",
  "[[0]] link in bio for free crypto [[1]] check it: [[2]]",
];
(async () => {
  let partials = 0;
  const t0 = Date.now();
  const r = await M.chat(provider, texts, { stream: true, onContent: c => { partials = M.parsePartial(c, texts.length).length; } });
  const arr = M.parseBatch(r.content, texts.length);
  console.log(`model=${provider.model} ttfb=${r.ttfbMs}ms total=${r.totalMs}ms usage=${JSON.stringify(r.usage)} streamed=${partials}/${texts.length}`);
  if (!arr) { console.log("FAIL: unparseable\n", r.content); process.exit(1); }
  let fail = 0;
  arr.forEach((t, i) => {
    const want = (texts[i].match(/\[\[\d+\]\]/g) || []);
    const kept = want.every(p => t.includes(p));
    const zh = /[一-鿿]/.test(t);
    if (!kept || !zh) fail++;
    console.log(`${kept && zh ? "ok  " : "FAIL"} [${i}] ${JSON.stringify(t)}${kept ? "" : "  <- lost placeholder"}${zh ? "" : "  <- not Chinese"}`);
  });
  console.log(fail ? `${fail} failures` : `all ${texts.length} translations ok`, `(${Date.now() - t0}ms)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("FAIL:", e.message); process.exit(1); });
