const R = require("../rules.js");
const cases = [
  [{ text: "Link in bio for free crypto", handle: "a" }, "推广引流"],
  [{ text: "$PEPE to the moon 🚀", handle: "a" }, "加密货币 shill"],
  [{ text: "so true", handle: "a" }, "互动饵"],
  [{ text: "🔥🔥🔥", handle: "a" }, "互动饵"],
  [{ text: "nice", handle: "john_doe48213", hasLink: false }, "疑似机器人"],
  [{ text: "Great point, but the cache hit rate drop is what actually explains this.", handle: "tibo" }, null],
  [{ text: "I disagree — the 5h limit removal matters more than resets.", handle: "someone" }, null],
  [{ text: "应该没人比我玩的开了吧🙃🍎我福不黑不信你看", displayName: "高秀🌸同城上门♥线下选妃", handle: "CrystalEngc7" }, "招嫖引流"],
  [{ text: "同城上門，私信預約", displayName: "小美" }, "招嫖引流"],
  [{ text: "同 城 上 门，私信联系", displayName: "小美" }, "招嫖引流"],
  [{ text: "警惕同城上门骗局，不要私信联系", displayName: "反诈中心" }, null],
  [{ text: "新闻报道：警方打击线下选妃，私信预约是骗局", displayName: "记者" }, null],
  [{ text: "同城上门维修空调，私信预约", displayName: "空调维修" }, null],
  [{ text: "同城上门保洁，联系预约", displayName: "家政服务" }, null],
];
const CUSTOM = { keywords: ["giveaway", "/reset.*(please|pls)/i"], handles: ["@SpamKing"] };
cases.push([{ text: "Huge GIVEAWAY this friday", handle: "x", custom: true }, "自定义关键词"]);
cases.push([{ text: "reset the limits pls", handle: "x", custom: true }, "自定义关键词"]);
cases.push([{ text: "A perfectly reasonable reply here", handle: "spamking", custom: true }, "已屏蔽用户"]);
cases.push([{ text: "A perfectly reasonable reply here", handle: "someone", custom: true }, null]);
let fail = 0;
for (const [input, want] of cases) { const got = R.classify(input, input.custom ? CUSTOM : undefined); if (got !== want) { fail++; console.log("FAIL", JSON.stringify(input.text), "got", got, "want", want); } }
for (const [input, want] of [
  [{ text: "so true" }, null],
  [{ text: "$PEPE is discussed in today's news" }, null],
  [{ text: "随便说两句", displayName: "同城上门♥线下选妃" }, "招嫖引流"],
]) { const got = R.classifyTimeline(input); if (got !== want) { fail++; console.log("FAIL timeline", input, got, want); } }
console.log(fail ? `${fail} failures` : `all ${cases.length} rule cases pass`);
process.exit(fail ? 1 : 0);
