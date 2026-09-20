# Social Media Translator：自动翻译 + 评论过滤

Chrome 扩展（MV3，无构建步骤）。两件事：

1. **自动翻译**：看 X / Reddit 时，把外文帖子和评论**原地**变成中文——译文直接出现在原文的位置、用原文的字体字号，看起来就像帖子本来就是中文写的。@用户名、链接、表情原样保留、可点击。悬停译文右侧出现「原文」按钮，一键切回。三个服务商可切换：**硅基流动**（默认，`Qwen/Qwen3.6-35B-A3B`，6 条一批约 1.1–1.5 秒，¥0.3 / 千条）、**Cerebras**（`qwen-3.8-27b`，1850 tok/s，同一批 0.5 秒、第一条 0.46 秒就出现，译文更地道，≈¥0.6 / 千条，免费层限 5 次/分钟，实际用需付费层）、**OpenRouter**（`google/gemini-3.1-flash-lite`，1.5 秒，什么模型都有，垫底备用）。各自记住 Key 和模型，设置页一键切换。旧默认 `Qwen3.5-35B-A3B` 在硅基流动上约 30% 的请求会挂死，升级后自动迁移。
2. **评论过滤**：推文详情页折叠低质量回复（推广、互动饵、跑题、AI 套话），折叠成一行灰条，点一下展开，不删内容，会学你的口味

## 安装

1. Chrome 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 「加载已解压的扩展程序」，选这个目录
3. 首次安装会自动打开设置页：选服务商，粘贴对应的 API Key（硅基流动 [cloud.siliconflow.cn/account/ak](https://cloud.siliconflow.cn/account/ak) / Cerebras [cloud.cerebras.ai](https://cloud.cerebras.ai) / OpenRouter [openrouter.ai/keys](https://openrouter.ai/keys)），点「测试」看到 ✓ 就行。评论过滤不用配置，开箱即用

## 翻译是怎么做的

- **统一翻成简体中文**：X、Reddit 和普通网页的一键翻译使用同一规则，所有外语（包括短句）及繁体中文均送译，简体中文保留；混排内容中的外语也会送译。简体中文中仅夹有 LLM、API、macOS、Jev 等已知技术名称时不重复送译。纯链接 / 纯 @ / 纯表情 / 数字不发请求，链接、代码等占位内容保持原样。等待翻译不再降低原文透明度。
- **滚到哪翻到哪**：提前 600px 发现段落，优先请求当前屏幕内的内容；X / Reddit 保持每批最多 6 段、每页 3 个请求并发。普通网页正文每批最多 3 段、约 900 字符，避免超长段落拖慢后面的内容。X 持续更新时使用节流扫描，不会因计数、媒体等 DOM 变化一直推迟新回复。
- **原地替换不破坏站点**：不动 React 管理的节点。原文子节点用 CSS 收成零尺寸，译文作为新节点追加进去，继承元素自己的字号行高。链接 / @ / 表情在发给模型前换成 `[[n]]` 占位符，译文回来后把克隆的原节点放回对应位置，点击时转发到原节点，所以 X 的站内跳转照常工作。站点重渲染（如「显示更多」）时自动检测并重翻
- **流式立即显示**：模型按 JSON 数组流式输出，哪一段先返回就立即显示，不等待前面的慢请求；请求仍优先当前屏幕内、再按页面顺序发出。
- **异常批次自动恢复**：模型偶尔返回数量不对或格式损坏时，自动把这一批拆成单条并发重试；最终结果会覆盖可能提前显示的不完整流式片段，不再让整批内容一起显示“翻译失败”。
- **卡死与繁忙自愈**：每个请求有两道看门狗——8 秒内没有首字节、或流式返回中途 15 秒没有新内容，就立刻断开重连（硅基流动网关偶尔接受连接后不回任何数据，以前要干等 40 秒）；HTTP / 流内 429/502/503/504 和网络错误退避重试，遵守服务端较长的等待要求；单次翻译连同重试最多 40 秒。页面侧对超时、繁忙等瞬时错误 3 秒、6 秒后自动重试两次，之后才留给手动点击。所有网页合计最多同时 3 个请求，排队最多 120 秒；后台每 10 秒报告存活状态。提示显示 HTTP 状态码，弹窗显示最近一次具体错误。
- **普通网页一键翻译**：每个网页右侧有一个半隐藏的小 logo（设置里可关），悬停展开，点「翻译此页」按需读取当前网页正文，滚到哪翻到哪；再点「还原此页」恢复原文。扩展图标弹窗里也有同样的按钮。顶部总开关关闭时也会停止并还原，手动开启此页会重新打开总开关。导航、表单、代码块等区域跳过；浏览器内部页面不支持。不点按钮不会发出任何请求。
- **不和 X 自带的 Grok 翻译打架**：推文旁边有「翻译自 英语 · 显示原文」时这条推文完全交给 X——已译成中文的不会再送译，点「显示原文」后也不会被翻回去。X 的趋势栏、探索页趋势和 Reddit 右栏「近期帖子」也会翻。
- **不漏译**：模型偶尔把 `W`、`ratio` 这类短梗原样返回；凡是回来仍不含中文、而原文本该翻译的项，自动再发一次带强提示的请求，结果作为最终译文缓存。
- **本地缓存**：`chrome.storage.local` LRU 2000 条，刷新页面不重复扣费；后台进程内常驻内存、改动后 0.8 秒写回，不再每批都读写整份缓存
- **显示方式**可切换：原地替换（默认）/ 双语对照（原文保留，译文紫色显示在下方）

接口都是 OpenAI 兼容的 `/chat/completions`，服务商表在 `background.js` 的 `PROVIDERS`（host、默认模型、关思考的参数写法、单价）；再加一家只需加一行和 `manifest.json` 的 `host_permissions`。关思考三种写法：硅基流动 `enable_thinking:false`，Cerebras `reasoning_effort:"none"`，OpenRouter `reasoning:{enabled:false}`（Gemini 3 只接受 `effort:"minimal"`，gpt-oss 最低 `low`）。设置页填了 Key 会自动拉 `GET /models` 给模型名做补全；「测试」会检查该模型是否保留占位符。费用按 tokens × 单价算（美元价按 7.1 折成人民币），常见模型的官网价内置，其它模型点「单价」手填。

2026-09 用同一批 6 条推文在硅基流动实测（顺序 8 次 + 3 路并发 12 批）：`Qwen3.6-35B-A3B` 0 失败、平均 1.4–1.6 秒，¥1.8/¥10.8；`Qwen3.5-122B-A10B` 0 失败、2.3–2.6 秒、口语更地道，¥0.8/¥6.4；`GLM-4.5-Air` 0 失败、1.4 秒但偶有整条不翻，¥1/¥6；`Qwen3.8-27B` 3.5 秒；`DeepSeek-V4-Flash` 首字节 0.6–6 秒不稳；`Qwen3.5-35B-A3B` / `Qwen3.5-9B` 约 30% 请求无响应；`GLM-5.3`、`Kimi-K2.6` 慢或超时。跨服务商（从日本家宽）：Cerebras `qwen-3.8-27b` 首字节 0.37 秒、第一条推文 0.46 秒、整批 0.53 秒；OpenRouter 多一跳，同一个 Qwen3.6 从 1.1 秒变 2.1 秒，Gemini 3.8 Flash 强制思考 2.7 秒、译文反而不如 Qwen，Gemini 3.1 Flash-Lite 1.5 秒尚可；Groq / SambaNova 上的 gpt-oss、DeepSeek 要么强制思考要么中文一般。

## 评论过滤

两级判定：**本地规则**（`rules.js`，零成本：推广引流、加密货币 shill、AI 工具推销、互动饵、纯链接、疑似机器人）+ **jev 判定**（`background.js`，剩余回复每 8 条一批发给 TypeSafe jev，四个 noul 问题，任一 ≥ 阈值即折叠）。判定结果按推文 id 缓存，不重复计费。

### 用户能看到什么

- **页面内**：被折叠的回复变成一行灰条（类别 + 概率，点击展开）；页面底部蓝色胶囊显示「已隐藏 N 条 · 全部展开」
- **工具栏图标**：角标数字 = 本页已隐藏条数；点开弹窗两张卡片：翻译（本页段数）、过滤（本页统计、今日额度、全部展开），各一个开关

### 让它学你的口味（反馈闭环）

- **手动标记**：悬停任意回复，右上角出现「隐藏」，点了立即折叠并存为「无效样本」；标记条上可「屏蔽 @用户」或「撤销」
- **纠正误判**：任何折叠条上点「误判」，该回复展开、存为「保留样本」，并且永不再被折叠
- **屏蔽用户**：标记条上点「屏蔽 @用户」，设置页可取消。自定义关键词（`customKeywords`，支持 `/正则/i`）仍在 `rules.js` 里生效，但设置页不再暴露入口
- AI 自己判的结果不会自动变成例子（只有你点过「隐藏」/「误判」的才算），避免它用自己的输出强化自己
- **喂给 jev**：每次判定会带上最近各 10 条无效/保留样本，并多问一个问题「是否与用户标记过的无效回复同类」。实测（`test/examples.e2e.js`）：标了 3 条「求重置」样本后，同类回复 user 分数 0.90 和 0.93，正常提问 0.08 和 0.10
- 样本只存在本机 `chrome.storage.local`，设置页可逐条删除或清空；走免费中转时样本文本会随请求发到中转再到 jev，不落库

### 两种模式

- **免费额度（默认）**：不填 key。另有每 IP 每天 600 条的上限（安装 id 是客户端生成的，可以随便换，IP 上限才是真正防一个人刷爆公共预算的闸）。插件调 Cloudflare Worker 中转（`worker/`），key 只存在 Worker secret 里。每个安装生成匿名 id，每天 300 条回复；全局日预算 $2，超了返回 429，插件自动退回纯规则模式。
- **自带 key**：设置页「jev Key」填 TypeSafe 官方 key（[console.typesafe.ai/keys](https://console.typesafe.ai/keys)），直连 `api.typesafe.ai/v1/systemone`，不限量、自己付费，回复内容不经任何第三方。「测试」按钮会发一条样例回复确认 key 可用

中转部署（一次性）：

```bash
cd worker && npx wrangler login
OPENROUTER_API_KEY=sk-or-... ./deploy.sh   # 建 KV、写 secret、部署、自动把 URL 写回 background.js
```

额度和预算在 `worker/wrangler.jsonc` 的 `vars` 里改。

### 前置：OpenRouter Guardrail（仅免费中转）

自建中转时如果统计一直为 0、控制台出现 `model-ignored-by-guardrail`，说明 OpenRouter 工作区的 Guardrail 把 `typesafe/jev` 挡了，去 https://openrouter.ai/workspaces/default/guardrails 放行。直连 TypeSafe 不涉及。

### 费用

每条回复约 4 个问题，一批 8 条约 1,500 input tokens，约 $0.00006；刷 1 万条回复约 $0.08。设置页有累计 token 和费用，可导出为 `jevlog` 格式并入 `~/content/jev-leaderboard` 的消耗榜。

## 测试

```bash
node test/rules.test.js                                   # 本地规则 + 自定义关键词/屏蔽用户
node test/translate.test.js                               # 语言识别 + 模型输出解析 + 占位符
node test/sw.load.test.js                                 # 后台实际请求链：多脚本加载、排队/并发、流式、缓存、错误
# 启动下方本地服务器后，安装了 playwright 的环境可运行：
node test/browser.acceptance.js                          # 浏览器模拟验收（不调用真实 API）
node test/stream-timeout.test.js                         # 流式返回卡住时正确超时
node test/stream.test.js                                 # SSE 尾帧、UTF-8 分块、JSON 兼容及服务错误
node test/retry.test.js                                  # 503 有限重试及 Retry-After
node test/stall.test.js                                  # 首字节 / 流中断看门狗断开重连，次数与总时限有界
SILICONFLOW_API_KEY=sk-... node test/translate.e2e.js     # 真实调用：译成中文、占位符保留、流式解析（CEREBRAS_API_KEY= / OPENROUTER_API_KEY= 同理）
OPENROUTER_API_KEY=sk-or-... node test/examples.e2e.js    # 用户样本确实改变 jev 判定（走 OpenRouter）
TYPESAFE_API_KEY=... node test/jev.e2e.js                 # 直连 TypeSafe jev，5 条样例带期望值
cd worker && npx wrangler dev --port 8787 --var DAILY_PER_ID:10 & PROXY_URL=http://localhost:8787 node test/jev.e2e.js   # 走中转，第 3 次应 429
python3 -m http.server 8766
open http://localhost:8766/test/fixture.html              # 仿 X DOM + mock chrome，看折叠 UI
open http://localhost:8766/test/translate.fixture.html    # 仿 X DOM，看原地翻译 / 原文切换 / 链接转发
open http://localhost:8766/test/ui.fixture.html           # 真实 popup.html / options.html + mock chrome
```

## 隐私

- **翻译**：只发段落文本（链接、@ 已换成占位符）到你填的接口；API Key 存 `chrome.storage.sync`；译文缓存在本机。内容脚本注入所有 http/https 页面只是为了显示右侧的小 logo，X / Reddit 之外的页面在你点「翻译此页」之前不读取、不发送任何内容
- **评论过滤发出去的数据**：原推文正文与作者名、待判定回复的正文与作者名、你确认过的例子文本（各最多 10 条）。不含你的账号、cookie、私信或浏览历史
- **去向**：免费模式经 `xrf.ship2market.ai`（Cloudflare Worker）转发到 OpenRouter 的 TypeSafe jev；自带 key 模式直连 TypeSafe 官方 API
- **中转只存计数**：每个匿名安装 id 和哈希后的 IP 的当日用量、当日总花费，26 小时过期；不存任何推文或回复内容
- **本机**：例子、判定缓存、待确认列表都在 `chrome.storage.local`；关键词、屏蔽用户、key 在 `chrome.storage.sync`
- 不想经过别人的中转？自己部署 `worker/`，把 `background.js` 里的 `proxyUrl` 改成你的域名即可

## 已知限制

- 依赖 x.com 的 `data-testid`（`tweet`、`tweetText`、`User-Name`、`icon-verified`），X 改 DOM 需要跟着改选择器
- 拿不到粉丝数、注册时间等 DOM 里没有的信号
- X 时间线本地过滤明确招嫖引流，以及手动屏蔽的用户/自定义关键词，不使用跑题、互动饵规则或调用 jev；详情页评论继续执行完整过滤。识别会结合昵称与正文，且保留用户标记过「误判」的内容。翻译在 X / Reddit 页面自动生效。
- 两把 key 都存在 `chrome.storage.sync`，随 Chrome 账号同步；不想同步就改成 `local`
- 无语言标记且只含中日共用汉字的短文本无法可靠区分；普通网页正文识别也可能漏掉特殊布局、iframe 或 Shadow DOM 中的内容
