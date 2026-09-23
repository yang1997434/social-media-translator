# 隐私政策 · Privacy Policy

**Social Media Translator** · 生效日期 / Effective: 2026-09-23

## 中文

**开发者不运营任何服务器，不收集、不存储、不出售任何用户数据。** 扩展只把完成功能所必需的文本，直接发送给你自己选择并填写了 API Key 的服务商。

**发送了什么、发给谁**

- **翻译**：在 X / Reddit 上浏览时，或在其他网页点击「翻译此页」之后，扩展把页面上需要翻译的文本段落发送到你在设置中选择的翻译服务：硅基流动（api.siliconflow.cn）、Cerebras（api.cerebras.ai）或 OpenRouter（openrouter.ai）。链接、@用户名、图片等不发送，用占位符代替。
- **评论过滤（可选）**：只有当你填写了 TypeSafe jev Key 时，扩展才会把 X 帖子详情页上的原帖和回复的文本、作者显示名，以及你亲手标记过的示例（各最多 10 条）发送到 TypeSafe（api.typesafe.ai）进行判定。不填 Key 时只使用本地规则，不发送任何内容。
- 这些服务商如何处理收到的数据，以它们各自的隐私政策为准。

**不读取什么**

- 不读取你的账号信息、Cookie、密码、私信或浏览历史。
- 扩展在所有网页上运行，只是为了在页面右侧显示一个小浮标；在你点击「翻译此页」之前，不读取、不发送该页面的任何内容。

**存在你本机的数据**

- `chrome.storage.sync`：设置、你填写的 API Key、屏蔽的用户、各设备的用量计数（段数、token 数、按单价估算的费用）。开启 Chrome 同步时，这些数据会随你的 Google 账号在你自己的设备之间同步，由 Google 处理。
- `chrome.storage.local`：译文缓存、你标记的示例、判定缓存。
- 卸载扩展即全部删除。

**联系**：https://github.com/yang1997434/social-media-translator/issues

## English

**The developer runs no servers and does not collect, store or sell any user data.** The extension sends only the text needed for each feature, directly to the provider you chose and configured with your own API key.

**What is sent, and where**

- **Translation**: on X / Reddit, or on any other page after you click "Translate this page", the text paragraphs to be translated are sent to the translation service you selected: SiliconFlow (api.siliconflow.cn), Cerebras (api.cerebras.ai) or OpenRouter (openrouter.ai). Links, @handles and images are replaced by placeholders and not sent.
- **Reply filter (optional)**: only if you enter a TypeSafe jev key, the text and display names of the post and its replies on an X post page, plus up to 10 examples you marked yourself, are sent to TypeSafe (api.typesafe.ai) for scoring. Without a key only local rules run and nothing is sent.
- Each provider's own privacy policy governs how it handles what it receives.

**What is never read**: your account details, cookies, passwords, direct messages or browsing history. The extension runs on every page only to show a small side tab at the right edge; nothing on that page is read or sent until you click it.

**Stored on your device**: settings, your API keys, blocked users and per-device usage counters (paragraphs, tokens, estimated cost) in `chrome.storage.sync`, which Chrome syncs between your own devices when Chrome sync is on; translation cache, your marked examples and cached verdicts in `chrome.storage.local`. Uninstalling the extension deletes all of it.

**Contact**: https://github.com/yang1997434/social-media-translator/issues
