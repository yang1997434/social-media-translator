# X 助手：自动翻译 + 评论过滤

Chrome 扩展（MV3，无构建步骤）。两件事：

1. **自动翻译**：看 X / Reddit 时，把外文帖子和评论**原地**变成中文——译文直接出现在原文的位置、用原文的字体字号，看起来就像帖子本来就是中文写的。@用户名、链接、表情原样保留、可点击。悬停译文右侧出现「原文」按钮，一键切回。走硅基流动，默认 `Qwen/Qwen3.5-35B-A3B`（快、便宜，一批 4 段约 300 tokens、1 秒内）
2. **评论过滤**：推文详情页折叠低质量回复（推广、互动饵、跑题、AI 套话），折叠成一行灰条，点一下展开，不删内容，会学你的口味

## 安装

1. Chrome 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 「加载已解压的扩展程序」，选这个目录
3. 首次安装会自动打开设置页：粘贴硅基流动 API Key（[cloud.siliconflow.cn/account/ak](https://cloud.siliconflow.cn/account/ak)），点「测试」看到 ✓ 就行。评论过滤不用配置，开箱即用

## 翻译是怎么做的

- **只翻非中文**：X 的每条推文带 `lang` 属性，`zh` 直接跳过；其它按字符构成判断（`lang.js`），纯链接 / 纯 @ / 纯表情 / 太短的不发请求
- **滚到哪翻到哪**：IntersectionObserver 进视口才请求（提前 300px），无限滚动新加载的内容自动跟上；每批 6 段、3 个请求并发（`background.js` 的 `TR_DEFAULTS`）
- **原地替换不破坏站点**：不动 React 管理的节点。原文子节点用 CSS 收成零尺寸，译文作为新节点追加进去，继承元素自己的字号行高。链接 / @ / 表情在发给模型前换成 `[[n]]` 占位符，译文回来后把克隆的原节点放回对应位置，点击时转发到原节点，所以 X 的站内跳转照常工作。站点重渲染（如「显示更多」）时自动检测并重翻
- **流式逐段渲染**：模型按 JSON 数组输出，`llm.js` 边流边解析，哪段完整了先显示哪段
- **本地缓存**：`chrome.storage.local` LRU 2000 条，刷新页面不重复扣费
- **显示方式**可切换：原地替换（默认）/ 双语对照（原文保留，译文紫色显示在下方）

接口是 OpenAI 兼容的 `/chat/completions`，换服务商只需改 `TR_DEFAULTS.baseUrl` 和 `manifest.json` 的 `host_permissions`。设置页填了 Key 会自动拉 `GET /models` 给模型名做补全；「测试」会检查该模型是否保留占位符。费用按 tokens × 单价算，`Qwen3.5-35B-A3B` / `Qwen3.6-35B-A3B` 的官网价内置，其它模型点「单价」手填。

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
node test/sw.load.test.js                                 # service worker 同作用域加载（防重复声明）
SILICONFLOW_API_KEY=sk-... node test/translate.e2e.js     # 真实调用：译成中文、占位符保留、流式解析
OPENROUTER_API_KEY=sk-or-... node test/examples.e2e.js    # 用户样本确实改变 jev 判定（走 OpenRouter）
TYPESAFE_API_KEY=... node test/jev.e2e.js                 # 直连 TypeSafe jev，5 条样例带期望值
cd worker && npx wrangler dev --port 8787 --var DAILY_PER_ID:10 & PROXY_URL=http://localhost:8787 node test/jev.e2e.js   # 走中转，第 3 次应 429
python3 -m http.server 8766
open http://localhost:8766/test/fixture.html              # 仿 X DOM + mock chrome，看折叠 UI
open http://localhost:8766/test/translate.fixture.html    # 仿 X DOM，看原地翻译 / 原文切换 / 链接转发
open http://localhost:8766/test/ui.fixture.html           # 真实 popup.html / options.html + mock chrome
```

## 隐私

- **翻译**：只发段落文本（链接、@ 已换成占位符）到你填的接口；API Key 存 `chrome.storage.sync`；译文缓存在本机
- **评论过滤发出去的数据**：原推文正文与作者名、待判定回复的正文与作者名、你确认过的例子文本（各最多 10 条）。不含你的账号、cookie、私信或浏览历史
- **去向**：免费模式经 `xrf.ship2market.ai`（Cloudflare Worker）转发到 OpenRouter 的 TypeSafe jev；自带 key 模式直连 TypeSafe 官方 API
- **中转只存计数**：每个匿名安装 id 和哈希后的 IP 的当日用量、当日总花费，26 小时过期；不存任何推文或回复内容
- **本机**：例子、判定缓存、待确认列表都在 `chrome.storage.local`；关键词、屏蔽用户、key 在 `chrome.storage.sync`
- 不想经过别人的中转？自己部署 `worker/`，把 `background.js` 里的 `proxyUrl` 改成你的域名即可

## 已知限制

- 依赖 x.com 的 `data-testid`（`tweet`、`tweetText`、`User-Name`、`icon-verified`），X 改 DOM 需要跟着改选择器
- 拿不到粉丝数、注册时间等 DOM 里没有的信号
- 评论过滤只在详情页生效，时间线不处理；翻译在所有 X / Reddit 页面生效
- 两把 key 都存在 `chrome.storage.sync`，随 Chrome 账号同步；不想同步就改成 `local`
- Reddit 没有 `lang` 属性，全靠字符构成判断；混排段落可能漏翻
