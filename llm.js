// OpenAI-compatible chat client + translation prompt. Shared by the service worker (importScripts) and node tests.
// Wrapped in an IIFE: importScripts() shares one global scope, so nothing here may leak as a global name.
(() => {
const SYSTEM_PROMPT = [
  "你是社交媒体翻译引擎。把用户给出的 JSON 字符串数组中的每一项翻译成地道、自然的简体中文，语气贴合原文：口语就口语，玩梗就用对应的中文网络用语，不要翻译腔。",
  "规则：",
  "1. 只输出一个与输入等长的 JSON 字符串数组，不要解释，不要 markdown 代码块。",
  "2. 文本中形如 [[3]] 的标记是占位符（代表链接、@用户名、表情等），必须原样保留在译文中对应的位置，不要翻译、删除或改动数字。",
  "3. 保留原文换行。已经是中文的项原样返回。专有名词、品牌名、代码、$股票代码保持原样。",
].join("\n");

const THINKING_MODELS = /qwen3|glm-?4\.[5-9]|glm-?5|deepseek-v3\.[1-9]|deepseek-v4|hunyuan-a13b|minimax-m/i;

function buildBody(model, texts, stream) {
  const body = { model, stream: !!stream, temperature: 0.2,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(texts) }] };
  if (stream) body.stream_options = { include_usage: true };
  if (THINKING_MODELS.test(model)) body.enable_thinking = false;   // hybrid-reasoning models: skip the thinking phase, translation needs none
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
    404: "接口或模型不存在 (404)，检查 Base URL 和模型名", 429: "触发限速 (429)，稍后再试" };
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

// One translation request. Returns { content, usage|null, ttfbMs|null, totalMs }.
// opts: { stream?, timeoutMs?, onContent?(accumulated), fetch? }
async function chat(provider, texts, opts = {}) {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs || 45000;
  const res = await fetchWithTimeout(base(provider) + "/chat/completions",
    { method: "POST", headers: auth(provider), body: JSON.stringify(buildBody(provider.model, texts, !!opts.stream)) }, timeoutMs, opts.fetch || fetch);
  if (!res.ok) throw new Error(errMessage(res.status, await res.text().catch(() => "")));
  if (!opts.stream) {
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content ?? "", usage: data.usage || null, ttfbMs: null, totalMs: Date.now() - t0 };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", usage = null, ttfbMs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfbMs === null) ttfbMs = Date.now() - t0;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    let grew = false;
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content || "";
        if (delta) { content += delta; grew = true; }
        if (j.usage) usage = j.usage;
      } catch { /* non-standard SSE line */ }
    }
    if (grew && opts.onContent) opts.onContent(content);
  }
  return { content, usage, ttfbMs, totalMs: Date.now() - t0 };
}

const XRF_LLM = { SYSTEM_PROMPT, buildBody, parseBatch, parsePartial, errMessage, approxTokens, listModels, chat };
if (typeof module !== "undefined") module.exports = XRF_LLM;
globalThis.XRF_LLM = XRF_LLM;
})();
