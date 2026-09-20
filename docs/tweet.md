# 推文文案（X，长文；你有 Premium+ 可以直接发一条）

开源了一个 Chrome 扩展：Social Media Translator
刷 X / Reddit 时，外文帖子和评论「原地」变成中文——译文直接长在原文的位置、用原文的字体字号，看起来像帖子本来就是中文写的。

🧬 来源
魔改自 Jason Zhu 的 Reply Filter for X（github.com/zhuyansen/x-reply-filter，MIT）。上游是一个评论过滤器，我把重心换成了翻译，过滤功能原样保留。

🔧 重点改了什么
• 原地翻译引擎：@、链接、表情原样保留可点击；悬停出现「原文」一键切回；也有双语对照
• 三家服务商一键切换：硅基流动 / Cerebras / OpenRouter，各自记 Key 和模型
• 卡死自愈：8 秒无首字节、15 秒无新内容就断开重连；429/5xx 退避重试；页面侧还会自动重试两次
• 不做无用功：已是中文不发请求；X 自带的 Grok 翻译完全交给 X，点「显示原文」不会被翻回去
• 任意网页右侧一个玻璃质感的小浮标，悬停展开，一键翻译 / 还原整页
• 弹窗显示今日 / 本月 / 累计花费，按每次请求当时的模型单价记账

🤔 为什么是这三家
硅基流动：国内直连、便宜（¥0.3 / 千条推文），默认
Cerebras：专用芯片 1850 tok/s，6 条推文 0.5 秒翻完，译文也最地道；要付费层
OpenRouter：什么模型都有，前两家不通时兜底

⚡ 速度（同一批 6 条推文，思考全关，日本家宽实测）
Cerebras qwen-3.8-27b：第一条 0.46s，整批 0.53s
硅基流动 Qwen3.6-35B-A3B：第一条 0.75s，整批 1.3s
OpenRouter gemini-3.1-flash-lite：整批 1.5s
Gemini 3.8 Flash 反而 2.7s（强制思考），硅基流动上旧的 Qwen3.5-35B 有 30% 请求直接无响应——这也是为什么要换默认模型、加看门狗

📦 装法
github.com/yang1997434/social-media-translator
Releases 下 zip → chrome://extensions → 开发者模式 → 加载已解压 → 填自己的 API Key。仓库和安装包里没有任何 Key。

MIT 开源，欢迎 PR。

# 配图（最多 4 张，按这个顺序）
1. docs/timeline.png   — 时间线原地翻译效果
2. docs/speed.png      — 速度对比
3. docs/popup.png      — 弹窗（花费统计）
4. docs/side-tab.png   — 侧边玻璃浮标 浅色/深色页

# 短版（≤280 字，不想发长文时用）
开源了个 Chrome 扩展 Social Media Translator：刷 X / Reddit 时外文帖子和评论原地变成中文，@、链接、表情照常可点。硅基流动 / Cerebras / OpenRouter 三选一，Cerebras 上 6 条推文 0.5 秒翻完。魔改自 Reply Filter for X（MIT）。仓库不含任何 Key：github.com/yang1997434/social-media-translator
