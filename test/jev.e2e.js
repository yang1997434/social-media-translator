// Real jev call. TypeSafe:   TYPESAFE_API_KEY=... node test/jev.e2e.js
//                OpenRouter: OPENROUTER_API_KEY=... node test/jev.e2e.js
//                Proxy:      PROXY_URL=http://localhost:8787 node test/jev.e2e.js
const { callJev, verdicts, JEV_TYPESAFE, JEV_OPENROUTER } = require("../shared.js");
const THRESHOLD = 0.75;
const original = { handle: "thsottiaux", text: "Update on rate limits in Codex. We found some inefficiencies when using images in long sessions with multiple compactions and shipped fixes." };
const replies = [
  { id: "1", handle: "dev_amy", verified: false, text: "Does the compaction fix also apply to the CLI or only the desktop app? Seeing the same drain there." },
  { id: "2", handle: "growthguru", verified: false, text: "Great insights! Leveraging AI to unlock efficiency is truly the future of work. Thanks for sharing!" },
  { id: "3", handle: "solanaqueen", verified: true, text: "While you're here, our AI trading bot made 40% this week, join the waitlist 👉" },
  { id: "4", handle: "cheflara", verified: false, text: "Anyone got a good sourdough starter recipe?" },
  { id: "5", handle: "ben", verified: false, text: "Honestly the image path was always the slow one, nice to see it fixed." },
];
const EXPECT = [false, true, true, true, false];

async function viaProxy(url) {
  const res = await fetch(url + "/classify", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installId: "0123456789abcdef0123456789abcdef", original, replies }) });
  return { status: res.status, body: await res.json() };
}

(async () => {
  const t0 = Date.now();
  let resp;
  if (process.env.PROXY_URL) { const r = await viaProxy(process.env.PROXY_URL); console.log("proxy status", r.status, "quota", JSON.stringify(r.body.quota || r.body)); resp = r.body; }
  else if (process.env.TYPESAFE_API_KEY) resp = await callJev(process.env.TYPESAFE_API_KEY, original, replies, undefined, undefined, fetch, JEV_TYPESAFE);
  else resp = await callJev(process.env.OPENROUTER_API_KEY, original, replies, undefined, undefined, fetch, JEV_OPENROUTER);
  if (!resp.answers) process.exit(1);
  const v = verdicts(resp.answers, replies.length, THRESHOLD);
  console.log(`model=${resp.model} latency=${Date.now() - t0}ms usage=${JSON.stringify(resp.usage)}`);
  let bad = 0;
  replies.forEach((r, i) => { const ok = !!v[i] === EXPECT[i]; bad += !ok; console.log(`${ok ? "PASS" : "FAIL"} [${i}] @${r.handle.padEnd(12)} -> ${v[i] ? `HIDE (${v[i].cat} ${v[i].p})` : "keep"}`); });
  process.exit(bad ? 1 : 0);
})();
