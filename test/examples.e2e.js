// Proves user-labeled examples change jev's verdicts. OPENROUTER_API_KEY=... node test/examples.e2e.js
const { callJev, verdicts } = require("../shared.js");
const original = { handle: "thsottiaux", text: "See you at DevDay" };
const replies = [
  { id: "1", handle: "RicklessMorty3", text: "How about a little reset for the weekend?" },
  { id: "2", handle: "Toghts1", text: "Please reset the limits I am working on something big" },
  { id: "3", handle: "aryannaio", text: "When is DevDay" },
  { id: "4", handle: "brockharrisonp", text: "A lot of us were expecting a new model this week, is that still planned before DevDay?" },
];
const examples = { bad: [{ t: "Reset pls" }, { t: "when reset??" }, { t: "Tibo reset my limits please 🙏 I ran out again" }],
                   good: [{ t: "Is the 5h limit coming back after DevDay or is it gone for good?" }] };
const show = (tag, resp) => { const v = verdicts(resp.answers, replies.length, 0.75);
  replies.forEach((r, i) => console.log(`${tag} [${i}] ${v[i] ? `HIDE(${v[i].cat} ${v[i].p})` : "keep"}  user=${resp.answers[`r${i}_user`]?.noul ?? "-"}  ${r.text.slice(0, 50)}`)); return v; };
(async () => {
  const key = process.env.OPENROUTER_API_KEY;
  const a = show("no-examples  ", await callJev(key, original, replies));
  const resp = await callJev(key, original, replies, undefined, examples);
  const b = show("with-examples", resp);
  console.log("usage with examples:", JSON.stringify(resp.usage));
  const u = i => resp.answers[`r${i}_user`].noul;
  const ok = u(0) >= 0.85 && u(1) >= 0.85 && u(2) <= 0.3 && u(3) <= 0.3 && !b[2] && !b[3];
  console.log(ok ? "PASS: user-example score separates reset-begging (>=0.85) from legit questions (<=0.3)" : "FAIL: see table above");
  process.exit(ok ? 0 : 1);
})();
