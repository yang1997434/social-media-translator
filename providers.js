// Translation providers. Every one is OpenAI-compatible: POST {baseUrl}/chat/completions, GET {baseUrl}/models.
// Shared by the service worker (importScripts) and the UI fixtures; wrapped because importScripts() shares one global scope.
//
// Fields
//   name / group     how the settings page lists it (group: cn 国内厂商, intl 海外厂商, other)
//   company          who issues the key. Hosts of one company (China / global regions) share it: a key is probed on each of
//                    them to find the region its account lives in, and never sent to another company.
//   key              regex source for the shape of this company's keys. Shapes may overlap across companies (a bare
//                    sk-<32 hex> is DeepSeek's or Bailian's); the user then picks, nothing is probed.
//   model / prefer   default model; when the account's /models lacks it, the first match of `prefer` (regex sources) wins
//   thinking         how reasoning is switched off (see buildBody in llm.js)
//   temp: false      the host rejects a non-default temperature
//   headers          extra request headers
//   prices           ¥ per million tokens [input, output], list prices (USD converted at USD) for the cost readout
//
// Only the first three were benchmarked (2026-09, 6-tweet batch from Japan): SiliconFlow Qwen3.6-35B-A3B first tweet
// 0.75s / batch 1.5s; Cerebras qwen-3.8-27b (1850 tok/s, reasoning off) 0.46s / 0.53s with better slang at ~2x the price;
// OpenRouter adds ~1s per hop. The former SiliconFlow default (Qwen3.5-35B-A3B) hung on ~30% of requests and is migrated
// away. Defaults for the rest come from each provider's docs (2026-09-28): a fast, cheap model with reasoning off.
const XRF_PROVIDERS = (() => {
  const USD = 7.1;
  const usd = (i, o) => [i * USD, o * USD];
  const SK32 = "^sk-[0-9a-f]{32}$";                                     // DeepSeek, and Bailian's legacy keys
  const BAILIAN = "^sk-(?:ws[\\w-]+|[0-9a-f]{32})$";                    // Bailian: legacy sk-<32 hex>, new sk-ws…
  const SK48_LOWER = "^sk-[a-z]{48}$";                                  // SiliconFlow
  const SK48_MIXED = "^sk-(?!.*T3BlbkFJ)(?=[a-z0-9]*[A-Z0-9])[A-Za-z0-9]{48}$";   // Kimi (legacy OpenAI keys carry T3BlbkFJ)
  const BARE32 = "^[A-Za-z0-9]{32}$";                                   // Mistral, DeepInfra: no prefix
  const PROVIDERS = {
    // ---- 国内厂商 ----
    siliconflow: { name: "硅基流动", company: "siliconflow", group: "cn", key: SK48_LOWER, baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3.6-35B-A3B", thinking: "enable_thinking", keyUrl: "https://cloud.siliconflow.cn/account/ak",
      prices: { "Qwen/Qwen3.6-35B-A3B": [1.8, 10.8], "Qwen/Qwen3.5-122B-A10B": [0.8, 6.4], "zai-org/GLM-4.5-Air": [1, 6], "Qwen/Qwen3.8-27B": [3, 12], "Qwen/Qwen3.6-27B": [3, 18], "deepseek-ai/DeepSeek-V4-Flash": [3, 9], "Qwen/Qwen3.5-35B-A3B": [0.4, 3.2] } },
    siliconflow_intl: { name: "SiliconFlow 国际", company: "siliconflow", group: "cn", key: SK48_LOWER, baseUrl: "https://api.siliconflow.com/v1", model: "Qwen/Qwen3.6-35B-A3B", prefer: ["qwen3\\.6-35b-a3b", "deepseek-v4\\.1-flash", "flash"], thinking: "enable_thinking", keyUrl: "https://cloud.siliconflow.com/account/ak",
      prices: { "deepseek-ai/DeepSeek-V4.1-Flash": usd(0.15, 0.6) } },
    deepseek: { name: "DeepSeek", company: "deepseek", group: "cn", key: SK32, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", prefer: ["^deepseek-flash$", "v4.*flash", "flash", "chat"], thinking: "thinking_type", keyUrl: "https://platform.deepseek.com/api_keys",
      prices: { "deepseek-flash": [1, 4], "deepseek-v4-flash": [1, 4] } },
    bailian: { name: "阿里云百炼", company: "bailian", group: "cn", key: BAILIAN, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-flash", prefer: ["^qwen3\\.\\d+-flash$", "^qwen-flash$", "flash"], thinking: "enable_thinking", keyUrl: "https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key",
      prices: { "qwen3.8-flash": [0.8, 2.7] } },
    bailian_intl: { name: "阿里云百炼 国际", company: "bailian", group: "cn", key: BAILIAN, baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-flash", prefer: ["^qwen3\\.\\d+-flash$", "^qwen-flash$", "flash"], thinking: "enable_thinking", keyUrl: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key",
      prices: { "qwen3.8-flash": usd(0.15, 0.47) } },
    moonshot: { name: "Kimi（月之暗面）", company: "moonshot", group: "cn", key: SK48_MIXED, baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.6", prefer: ["kimi-k2\\.\\d"], thinking: "thinking_type", temp: false, keyUrl: "https://platform.kimi.com/console/api-keys",
      prices: { "kimi-k2.6": [6.5, 27] } },
    moonshot_intl: { name: "Kimi 国际", company: "moonshot", group: "cn", key: SK48_MIXED, baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k2.6", prefer: ["kimi-k2\\.\\d"], thinking: "thinking_type", temp: false, keyUrl: "https://platform.kimi.ai/console/api-keys",
      prices: { "kimi-k2.6": usd(0.95, 4) } },
    zhipu: { name: "智谱 BigModel", company: "zhipu", group: "cn", key: "^[0-9a-f]{32}\\.[A-Za-z0-9]{16}$", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.7-flashx", prefer: ["glm-4\\.\\d+-flashx", "glm-4\\.\\d+-flash", "air"], thinking: "thinking_type", keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
      prices: { "glm-4.7-flashx": [0.5, 3], "glm-4.7-flash": [0, 0] } },
    zai: { name: "Z.ai 国际", company: "zhipu", group: "cn", key: "^[0-9a-f]{32}\\.[A-Za-z0-9]{16}$", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.7-flashx", prefer: ["glm-4\\.\\d+-flashx", "glm-4\\.\\d+-flash", "air"], thinking: "thinking_type", keyUrl: "https://z.ai/manage-apikey/apikey-list",
      prices: { "glm-4.7-flashx": usd(0.07, 0.4) } },
    // Each Doubao model has to be switched on in the Ark console before a key can call it.
    volcengine: { name: "火山方舟（豆包）", company: "volcengine", group: "cn", key: "^(?:ark-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-1-lite-260915", prefer: ["doubao-seed.*lite", "doubao-seed.*mini", "doubao"], thinking: "thinking_type", keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
      prices: { "doubao-seed-2-1-lite-260915": [0.8, 2.7] } },
    qianfan: { name: "百度千帆", company: "qianfan", group: "cn", key: "^bce-v3/", baseUrl: "https://qianfan.baidubce.com/v2", model: "ernie-4.5-turbo-32k", prefer: ["ernie-4\\.5-turbo", "ernie"], thinking: "none", keyUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
      prices: { "ernie-4.5-turbo-32k": [0.8, 3.2] } },
    minimax: { name: "MiniMax", company: "minimax", group: "cn", key: "^sk-(?:cp|api)-", baseUrl: "https://api.minimax.cn/v1", model: "MiniMax-M3", prefer: ["^minimax-m\\d+$"], thinking: "thinking_type", keyUrl: "https://platform.minimax.cn/user-center/basic-information/interface-key",
      prices: { "MiniMax-M3": [2.1, 8.4] } },
    minimax_intl: { name: "MiniMax 国际", company: "minimax", group: "cn", key: "^sk-(?:cp|api)-", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3", prefer: ["^minimax-m\\d+$"], thinking: "thinking_type", keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
      prices: { "MiniMax-M3": usd(0.3, 1.2) } },

    // ---- 海外厂商 ----
    openai: { name: "OpenAI", company: "openai", group: "intl", key: "^sk-(?:proj|svcacct)-|^sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}$", baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna", prefer: ["luna", "nano", "mini"], thinking: "reasoning_effort", temp: false, keyUrl: "https://platform.openai.com/api-keys",
      prices: { "gpt-6-luna": usd(0.1, 0.5), "gpt-5.4-nano": usd(0.2, 1.25) } },
    // The compat endpoint rejects unknown body fields and Gemini 3's lowest thinking level is already the default: send none.
    gemini: { name: "Google Gemini", company: "google", group: "intl", key: "^(?:AIza[0-9A-Za-z_-]{35}$|AQ\\.)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.1-flash-lite", prefer: ["flash-lite", "flash"], thinking: "none", keyUrl: "https://aistudio.google.com/apikey",
      prices: { "gemini-3.1-flash-lite": usd(0.25, 1.5) } },
    // Called straight from the extension: Anthropic wants the browser-access header on requests that carry an Origin.
    anthropic: { name: "Anthropic Claude", company: "anthropic", group: "intl", key: "^sk-ant-", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", prefer: ["haiku"], thinking: "none", temp: false,
      headers: { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, keyUrl: "https://platform.claude.com/settings/keys",
      prices: { "claude-haiku-4-5": usd(1, 5), "claude-haiku-4-5-20251001": usd(1, 5) } },
    xai: { name: "xAI Grok", company: "xai", group: "intl", key: "^xai-", baseUrl: "https://api.x.ai/v1", model: "grok-4.3", prefer: ["^grok-4\\.\\d+$", "grok"], thinking: "reasoning_effort", keyUrl: "https://console.x.ai/",
      prices: { "grok-4.3": usd(1.25, 2.5) } },
    groq: { name: "Groq", company: "groq", group: "intl", key: "^gsk_", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b", prefer: ["qwen3", "gpt-oss-20b"], thinking: "reasoning_effort", keyUrl: "https://console.groq.com/keys",
      prices: { "qwen/qwen3.8-27b": usd(0.8, 4), "openai/gpt-oss-20b": usd(0.075, 0.3) } },
    cerebras: { name: "Cerebras", company: "cerebras", group: "intl", key: "^csk-", baseUrl: "https://api.cerebras.ai/v1", model: "qwen-3.8-27b", thinking: "reasoning_effort", keyUrl: "https://cloud.cerebras.ai/",
      prices: { "qwen-3.8-27b": usd(0.99, 1.49), "gpt-oss-120b": usd(0.35, 0.75) } },
    // Every model behind one key; one extra hop (~1s slower than the direct hosts from Japan).
    openrouter: { name: "OpenRouter", company: "openrouter", group: "intl", key: "^sk-or-", baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-3.1-flash-lite", thinking: "openrouter", keyUrl: "https://openrouter.ai/keys",
      prices: { "google/gemini-3.1-flash-lite": usd(0.25, 1.5), "google/gemini-3.8-flash": usd(0.75, 3.75), "openai/gpt-5.4-nano": usd(0.2, 1.25), "qwen/qwen3.6-35b-a3b": usd(0.1, 0.9), "deepseek/deepseek-v4-flash": usd(0.04, 0.07) } },
    mistral: { name: "Mistral", company: "mistral", group: "intl", key: BARE32, baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", prefer: ["mistral-small"], thinking: "reasoning_effort", keyUrl: "https://console.mistral.ai/api-keys",
      prices: { "mistral-small-latest": usd(0.15, 0.6) } },
    deepinfra: { name: "DeepInfra", company: "deepinfra", group: "intl", key: BARE32, baseUrl: "https://api.deepinfra.com/v1/openai", model: "deepseek-ai/DeepSeek-V4-Flash-0731", prefer: ["deepseek-v4.*flash", "qwen3"], thinking: "reasoning_effort", keyUrl: "https://deepinfra.com/dash/api_keys",
      prices: { "deepseek-ai/DeepSeek-V4-Flash-0731": usd(0.06, 0.18) } },
    together: { name: "Together AI", company: "together", group: "intl", key: "^(?:tgp_v1_|[0-9a-f]{64}$)", baseUrl: "https://api.together.xyz/v1", model: "deepseek-ai/DeepSeek-V4-Flash-0731", prefer: ["deepseek-v4.*flash", "qwen3.*flash"], thinking: "together", keyUrl: "https://api.together.ai/settings/api-keys",
      prices: { "deepseek-ai/DeepSeek-V4-Flash-0731": usd(0.14, 0.28) } },
    fireworks: { name: "Fireworks", company: "fireworks", group: "intl", key: "^fw_", baseUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/deepseek-v4p1-flash", prefer: ["deepseek-v4.*flash", "qwen3"], thinking: "reasoning_effort", keyUrl: "https://app.fireworks.ai/settings/users/api-keys",
      prices: {} },

    // ---- 其他 ----
    // Any other OpenAI-compatible endpoint: the user types the base URL. The content scripts' all-sites match already grants
    // the worker access to every host, so no permission prompt is needed.
    custom: { name: "其他（OpenAI 兼容）", company: "custom", group: "other", baseUrl: "", model: "", thinking: "enable_thinking", keyUrl: "", prices: {} },
  };
  return { USD, PROVIDERS };
})();
if (typeof module !== "undefined") module.exports = XRF_PROVIDERS;
