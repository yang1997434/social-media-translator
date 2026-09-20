// Language detection + LLM response parsing, no network.
const L = require("../lang.js"), M = require("../llm.js");
let fail = 0;
const check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log("FAIL", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); } };

// shouldTranslate(text, lang)
for (const [t, lang, want] of [
  ["Hello world, this is a tweet", null, true],
  ["这条本来就是中文", null, false],
  ["这条本来就是中文", "zh", false],
  ["Some English text", "zh", false],           // site says zh: trust it
  ["ok", null, false], ["lol", null, false],    // too short to be worth a request
  ["https://t.co/abc123", null, false],         // url only
  ["@someone #tag", null, false],               // mention/tag only
  ["🔥🔥🔥", null, false],
  ["[[0]] nice work [[1]]", null, true],        // placeholders ignored, words remain
  ["[[0]] [[1]]", null, false],                 // placeholders only
  ["これは日本語のツイートです", null, true],
  ["Привет, как дела?", null, true],
  ["中文 with several english words", null, true], // mostly Latin by char count
]) check(`lang:${t}`, L.shouldTranslate(t, lang), want);

// parseBatch / parsePartial / think-stripping
check("parseBatch", M.parseBatch('["你好","世界"]', 2), ["你好", "世界"]);
check("parseBatch think", M.parseBatch('<think>reasoning…</think>\n["你好","世界"]', 2), ["你好", "世界"]);
check("parseBatch fenced", M.parseBatch('```json\n["你好"]\n```', 1), ["你好"]);
check("parseBatch wrong n", M.parseBatch('["你好"]', 2), null);
check("parseBatch n=1 raw", M.parseBatch("你好", 1), ["你好"]);
check("parsePartial", M.parsePartial('["第一段", "第二', 3), ["第一段"]);
check("parsePartial escapes", M.parsePartial('["a\\nb", "c\\"d", "e', 3), ["a\nb", 'c"d']);
check("parsePartial none", M.parsePartial("thinking", 2), []);
check("placeholders survive", M.parseBatch('["[[0]] 说得对 [[1]]"]', 1), ["[[0]] 说得对 [[1]]"]);

// request body
const body = M.buildBody("Qwen/Qwen3.5-35B-A3B", ["hi"], true);
check("body stream", [body.stream, body.stream_options.include_usage, body.enable_thinking], [true, true, false]);
check("body gpt no thinking flag", "enable_thinking" in M.buildBody("gpt-5.4-mini", ["hi"], false), false);
check("body user json", JSON.parse(body.messages[1].content), ["hi"]);
check("errMessage", M.errMessage(401, '{"error":{"message":"bad key"}}'), "API Key 无效 (401)：bad key");

console.log(fail ? `${fail} failures` : "all translate cases pass");
process.exit(fail ? 1 : 0);
