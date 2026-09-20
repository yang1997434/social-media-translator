// OpenAI-compatible chat client + translation prompt. Shared by the service worker (importScripts) and node tests.
// Wrapped in an IIFE: importScripts() shares one global scope, so nothing here may leak as a global name.
(() => {
const SYSTEM_PROMPT = [
  "你是社交媒体翻译引擎。把用户给出的 JSON 字符串数组中的每一项翻译成地道、自然的简体中文，语气贴合原文：口语就口语，玩梗就用对应的中文网络用语，不要翻译腔。",
  "规则：",
  "1. 只输出一个与输入等长的 JSON 字符串数组，不要解释，不要 markdown 代码块。",
  "2. 文本中形如 [[3]] 的标记是占位符（代表链接、@用户名、表情等），必须原样保留在译文中对应的位置，不要翻译、删除或改动数字。",
  "3. 保留原文换行。所有外语（不限于英文）均翻译成简体中文；繁体中文转换为简体中文；混合语言文本中的外语也要翻译。已经是简体中文的内容原样保留。专有名词、品牌名、代码、$股票代码保持原样。",
  "4. 再短的外语也要翻译：lol、so true、W、ok、ratio 这类口语和梗要译成对应的中文网络用语（笑死、太真实了、赢麻了、好的、反杀），不得把整项原样返回。",
].join("\n");
const STRICT_HINT = "\n\n（注意：以上每一项都不是简体中文，必须逐项翻译成简体中文，不得原样返回。）";

const THINKING_MODELS = /qwen3|glm-?4\.[5-9]|glm-?5|deepseek-v3\.[1-9]|deepseek-v4|hunyuan-a13b|minimax-m/i;

// thinking: how this endpoint switches reasoning off — translation never needs a thinking phase.
//   "enable_thinking"  SiliconFlow and most OpenAI-compatible hosts of hybrid models
//   "reasoning_effort" Cerebras (gpt-oss only goes down to "low")
//   "openrouter"       OpenRouter's unified `reasoning` object; Gemini 3 refuses "none" but takes "minimal" (0 reasoning tokens), gpt-oss floors at "low"
function buildBody(model, texts, stream, strict, thinking = "enable_thinking") {
  const body = { model, stream: !!stream, temperature: 0.2,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(texts) + (strict ? STRICT_HINT : "") }] };
  if (stream) body.stream_options = { include_usage: true };
  if (thinking === "reasoning_effort") body.reasoning_effort = /gpt-oss/i.test(model) ? "low" : "none";
  else if (thinking === "openrouter") {
    body.reasoning = /gemini/i.test(model) ? { effort: "minimal", exclude: true } : /gpt-oss|minimax/i.test(model) ? { effort: "low", exclude: true } : { enabled: false, exclude: true };
    body.usage = { include: true };   // exact USD cost in the usage object
  }
  else if (THINKING_MODELS.test(model)) body.enable_thinking = false;
  return body;
}

const stripThink = s => String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

// Parse the model output into n translations; null when it doesn't fit (n=1 falls back to the raw content).
function parseBatch(content, n) {
  let s = stripThink(content);
  const m = s.match(/\[[\s\S]*\]/);
  if (m) s = m[0];
  try { const arr = JSON.parse(s); if (Array.isArray(arr) && arr.length === n) return arr.map(String); } catch { /* fallthrough */ }
  if (n === 1 && s) return [s.replace(/^\[\s*"|"\s*\]$/g, "")];
  return null;
}

// Extract the string elements that are already complete from a half-streamed JSON array (progressive rendering).
function parsePartial(content, n) {
  const s = stripThink(content);
  const start = s.indexOf("[");
  if (start < 0) return [];
  const out = [];
  let i = start + 1;
  while (out.length < n) {
    while (i < s.length && (s[i] === "," || /\s/.test(s[i]))) i++;
    if (i >= s.length || s[i] === "]" || s[i] !== '"') break;
    let j = i + 1, buf = "", closed = false;
    while (j < s.length) {
      const c = s[j];
      if (c === "\\") {
        const next = s[j + 1];
        if (next === undefined) break;
        if (next === "n") buf += "\n"; else if (next === "t") buf += "\t"; else if (next === "r") buf += "\r";
        else if (next === "u") { if (j + 5 >= s.length) break; buf += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)); j += 4; }
        else buf += next;
        j += 2; continue;
      }
      if (c === '"') { closed = true; break; }
      buf += c; j += 1;
    }
    if (!closed) break;
    out.push(buf); i = j + 1;
  }
  return out;
}

function errMessage(status, body) {
  const map = { 400: "请求格式错误 (400)", 401: "API Key 无效 (401)", 402: "余额不足 (402)", 403: "无权限 (403)",
    404: "接口或模型不存在 (404)，检查 Base URL 和模型名", 429: "触发限速 (429)，稍后再试", 503: "模型服务繁忙 (503)，请稍后重试" };
  let detail = "";
  try { detail = JSON.parse(body)?.error?.message || JSON.parse(body)?.message || ""; } catch { detail = (body || "").slice(0, 120); }
  const base = map[status] || (status >= 500 ? `服务端故障 (${status})` : `HTTP ${status}`);
  return detail ? `${base}：${detail}` : base;
}

// Rough token estimate for providers that omit usage: mixed zh/en ≈ 3 chars per token.
const approxTokens = s => Math.max(1, Math.ceil([...String(s)].length / 3));

async function fetchWithTimeout(url, init, timeoutMs, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: ctrl.signal }); }
  catch (e) { throw new Error(e.name === "AbortError" ? `请求超时 (${timeoutMs / 1000}s)` : "网络错误：" + e.message); }
  finally { clearTimeout(timer); }
}

const base = p => String(p.baseUrl || "").replace(/\/+$/, "");
const auth = p => ({ Authorization: "Bearer " + p.apiKey, "Content-Type": "application/json" });
const TRANSIENT = [429, 502, 503, 504];

// A failure worth a fresh request: transient HTTP status (after a backoff), a connection that produced nothing for too
// long, or a network error. Anything else (bad key, bad model, malformed request) fails immediately.
class Retryable extends Error { constructor(message, delayMs) { super(message); this.retryable = true; this.delayMs = delayMs; } }

function checkServiceError(data) {
  if (!data?.error) return;
  const code = Number(data.error.status || data.error.code || data.code);
  if (code >= 400 && code <= 599) {
    const msg = errMessage(code, JSON.stringify(data));
    throw TRANSIENT.includes(code) ? new Retryable(msg) : new Error(msg);
  }
  const detail = typeof data.error === "string" ? data.error : data.error.message || data.message || "未知错误";
  throw new Error("模型服务错误：" + detail);
}

// GET /models → sorted model ids. Accepts {data:[...]}, {models:[...]} or a bare array of strings / {id}.
async function listModels(provider, opts = {}) {
  const res = await fetchWithTimeout(base(provider) + "/models", { headers: auth(provider) }, opts.timeoutMs || 15000, opts.fetch || fetch);
  if (!res.ok) throw new Error(errMessage(res.status, await res.text().catch(() => "")));
  const data = await res.json().catch(() => null);
  const list = Array.isArray(data) ? data : data?.data || data?.models;
  if (!Array.isArray(list)) throw new Error("无法解析模型列表（接口未按 OpenAI 格式返回）");
  const ids = [...new Set(list.map(m => (typeof m === "string" ? m : m?.id || m?.name)).filter(Boolean))];
  if (!ids.length) throw new Error("模型列表为空");
  return ids.sort();
}

const retryAfterSeconds = res => {
  const header = res.headers?.get?.("retry-after");
  if (header == null) return 0;
  const n = Number(header);
  return Number.isFinite(n) ? n : (Date.parse(header) - Date.now()) / 1000;
};

// One HTTP attempt. Two watchdogs instead of one long deadline: the provider either answers within ttfbMs or it never
// will (observed: SiliconFlow accepting the connection and sending nothing for 90s), and a live stream that goes quiet
// for stallMs is dead too. Both abort the attempt so chat() can open a fresh connection instead of waiting.
async function attempt(provider, texts, opts, budget) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  let timer = null, phase = "连接";
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), Math.max(0, Math.min(ms, budget.deadline - Date.now()))); };
  const stalled = () => new Retryable(`模型 ${Math.round((phase === "连接" ? budget.ttfbMs : budget.stallMs) / 1000)}s 内无响应（${phase}超时）`, 0);
  const backoff = () => (opts.retryDelayMs ?? 1000) * 2 ** budget.attempt + Math.random() * (opts.retryDelayMs ?? 250);
  arm(budget.ttfbMs);
  let res;
  try {
    res = await (opts.fetch || fetch)(base(provider) + "/chat/completions",
      { method: "POST", headers: auth(provider), body: JSON.stringify(buildBody(provider.model, texts, !!opts.stream, opts.strict, provider.thinking)), signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw stalled();
    throw new Retryable("网络错误：" + e.message, 500);
  }
  phase = "读取";
  arm(budget.stallMs);
  try {
    if (!res.ok) {
      const msg = errMessage(res.status, await res.text().catch(() => ""));
      if (!TRANSIENT.includes(res.status)) throw new Error(msg);
      const wait = retryAfterSeconds(res);
      if (wait > 8) throw new Error(msg);   // don't violate a long server-directed cooldown just to retry within our deadline
      throw new Retryable(msg, Math.max(wait * 1000, backoff()));
    }
    // Some compatible endpoints return ordinary JSON even when streaming was requested.
    if (!opts.stream || /application\/json/i.test(res.headers?.get?.("content-type") || "")) {
      const data = await res.json();
      checkServiceError(data);
      return { content: data.choices?.[0]?.message?.content ?? "", usage: data.usage || null, ttfbMs: null, totalMs: Date.now() - t0 };
    }
    if (!res.body) throw new Retryable("模型服务返回了空响应", 300);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", usage = null, ttfbMs = null, finished = false;
    const consume = lines => {
      const before = content;
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;
        const payload = l.slice(5).trim();
        if (payload === "[DONE]") { finished = true; break; }
        let j;
        try { j = JSON.parse(payload); } catch { continue; }
        checkServiceError(j); // Do not turn an in-stream service error into a vague parse failure.
        const delta = j.choices?.[0]?.delta?.content || "";
        if (delta) content += delta;
        if (j.usage) usage = j.usage;
      }
      if (content !== before && opts.onContent) opts.onContent(content);
    };
    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) { consume([buf + dec.decode()]); break; }
        arm(budget.stallMs);
        if (ttfbMs === null) ttfbMs = Date.now() - t0;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        consume(lines);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return { content, usage, ttfbMs, totalMs: Date.now() - t0 };
  } catch (e) {
    if (ctrl.signal.aborted && !e.retryable) throw stalled();
    throw e;
  } finally { clearTimeout(timer); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One translation request with bounded retries. Returns { content, usage|null, ttfbMs|null, totalMs }.
// opts: { stream?, strict?, timeoutMs? (whole call, default 40s), ttfbTimeoutMs? (8s), stallTimeoutMs? (15s),
//         retries? (2), retryDelayMs?, onContent?(accumulated), fetch? }
async function chat(provider, texts, opts = {}) {
  const total = opts.timeoutMs || 40000, deadline = Date.now() + total;
  const attempts = (opts.retries ?? 2) + 1;
  let last = null;
  for (let i = 0; i < attempts && Date.now() < deadline; i++) {
    try { return await attempt(provider, texts, opts, { deadline, attempt: i, ttfbMs: opts.ttfbTimeoutMs ?? 8000, stallMs: opts.stallTimeoutMs ?? 15000 }); }
    catch (e) {
      last = e;
      if (!e.retryable || i === attempts - 1 || Date.now() + (e.delayMs || 0) >= deadline) break;
      if (e.delayMs) await sleep(e.delayMs);
    }
  }
  if (last?.retryable && Date.now() >= deadline) throw new Error(`翻译请求超时 (${total / 1000}s)，请重试`);
  throw last || new Error(`翻译请求超时 (${total / 1000}s)，请重试`);
}

const XRF_LLM = { SYSTEM_PROMPT, buildBody, parseBatch, parsePartial, errMessage, approxTokens, listModels, chat };
if (typeof module !== "undefined") module.exports = XRF_LLM;
globalThis.XRF_LLM = XRF_LLM;
})();
