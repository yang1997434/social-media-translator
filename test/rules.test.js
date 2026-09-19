const R = require("../rules.js");
const cases = [
  [{ text: "Link in bio for free crypto", handle: "a" }, "推广引流"],
  [{ text: "$PEPE to the moon 🚀", handle: "a" }, "加密货币 shill"],
  [{ text: "so true", handle: "a" }, "互动饵"],
  [{ text: "🔥🔥🔥", handle: "a" }, "互动饵"],
  [{ text: "nice", handle: "john_doe48213", hasLink: false }, "疑似机器人"],
  [{ text: "Great point, but the cache hit rate drop is what actually explains this.", handle: "tibo" }, null],
  [{ text: "I disagree — the 5h limit removal matters more than resets.", handle: "someone" }, null],
];
const CUSTOM = { keywords: ["giveaway", "/reset.*(please|pls)/i"], handles: ["@SpamKing"] };
cases.push([{ text: "Huge GIVEAWAY this friday", handle: "x", custom: true }, "自定义关键词"]);
cases.push([{ text: "reset the limits pls", handle: "x", custom: true }, "自定义关键词"]);
cases.push([{ text: "A perfectly reasonable reply here", handle: "spamking", custom: true }, "已屏蔽用户"]);
cases.push([{ text: "A perfectly reasonable reply here", handle: "someone", custom: true }, null]);
let fail = 0;
for (const [input, want] of cases) { const got = R.classify(input, input.custom ? CUSTOM : undefined); if (got !== want) { fail++; console.log("FAIL", JSON.stringify(input.text), "got", got, "want", want); } }
console.log(fail ? `${fail} failures` : `all ${cases.length} rule cases pass`);
process.exit(fail ? 1 : 0);
