// Language detection + LLM response parsing, no network.
const L = require("../lang.js"), M = require("../llm.js");
let fail = 0;
const check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log("FAIL", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); } };

// shouldTranslate(text, lang)
for (const [t, lang, want] of [
  ["Hello world, this is a tweet", null, true],
  ["这条本来就是中文", null, false],
  ["这条本来就是中文", "zh", false],
  ["Some English text", "zh", true],          // inspect text even when mislabeled
  ["ok", null, true], ["lol", null, true],
  ["這條評論應該翻譯成簡體中文", "zh", true],
  ["繁體中文", null, true], ["謝", null, true],
  ["中文", "zh-Hant", true],
  ["这是简体中文", "zh-CN", false],
  ["短", null, false], ["今天心情很好", null, false],
  ["مرحبا بالعالم", null, true], ["สวัสดี", null, true],
  ["नमस्ते", null, true], ["שלום", null, true],
  ["γειά", null, true], ["გამარჯობა", null, true],
  ["안녕", null, true], ["é", null, true],
  ["今日は晴れです", "ja", true], ["無料", "ja", true],
  ["今天心情很好，谢谢大家，thanks", "zh", true],
  ["123…！？", null, false],
  ["https://t.co/abc123", null, false],         // url only
  ["@someone #tag", null, false],               // mention/tag only
  ["🔥🔥🔥", null, false],
  ["[[0]] nice work [[1]]", null, true],        // placeholders ignored, words remain
  ["[[0]] [[1]]", null, false],                 // placeholders only
  ["これは日本語のツイートです", null, true],
  ["Привет, как дела?", null, true],
  ["中文 with several english words", null, true], // mostly Latin by char count
  ["这个 harness 死简单，你无法用 LLM 做到的事情。Jev 在一次通过中选择动作和目标，macOS 执行它。", "zh", false],
  ["使用 API 和 Claude", null, false],
  ["Claude is great", null, true],
  ["Claude 很好 thanks", null, true],
  ["這個 API 很好", null, true],
  ["API 今天很好 مرحبا", null, true],
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
check("body cerebras qwen", M.buildBody("qwen-3.8-27b", ["hi"], true, false, "reasoning_effort").reasoning_effort, "none");
check("body cerebras gpt-oss floor", M.buildBody("gpt-oss-120b", ["hi"], true, false, "reasoning_effort").reasoning_effort, "low");
check("body cerebras no enable_thinking", "enable_thinking" in M.buildBody("qwen-3.8-27b", ["hi"], true, false, "reasoning_effort"), false);
check("body openrouter gemini floor", M.buildBody("google/gemini-3.8-flash", ["hi"], true, false, "openrouter").reasoning, { effort: "minimal", exclude: true });
check("body openrouter gpt-oss floor", M.buildBody("openai/gpt-oss-120b", ["hi"], true, false, "openrouter").reasoning, { effort: "low", exclude: true });
check("body openrouter off", M.buildBody("openai/gpt-5.4-nano", ["hi"], true, false, "openrouter").reasoning, { enabled: false, exclude: true });
check("body strict hint", /必须逐项翻译/.test(M.buildBody("m", ["hi"], false, true).messages[1].content), true);
check("errMessage", M.errMessage(401, '{"error":{"message":"bad key"}}'), "API Key 无效 (401)：bad key");

console.log(fail ? `${fail} failures` : "all translate cases pass");
process.exit(fail ? 1 : 0);
