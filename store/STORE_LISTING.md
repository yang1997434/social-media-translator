# Chrome Web Store 上架材料（Reply Filter for X 0.5.1）

上传包：`dist/x-reply-filter-0.5.1.zip`（由 `./build.sh` 生成，已做密钥扫描）

## 你本人要做的三步（我不能代办）
1. 打开 https://chrome.google.com/webstore/devconsole ，用 Google 账号重新验证身份
2. 首次使用需注册开发者：接受开发者协议，支付 **$5 一次性注册费**
3. 账号设置里验证联系邮箱（不验证无法发布）

## 表单填写（按后台页面顺序）

### Store listing
- **Language**：Chinese (Simplified)；之后可再加 English
- **名称**：取自 manifest，`Reply Filter for X`
- **简短说明**：取自 manifest description
- **详细说明（中文）**：

> 刷 X 的评论区，总被推广、复读机和 AI 套话淹没？Reply Filter for X 自动把这些低价值回复折叠成一行灰条，真正有内容的讨论留在眼前。
>
> ■ 折叠四类回复：推广/垃圾、互动饵（"so true"、纯 emoji）、跑题、AI 套话
> ■ 不删除任何内容：每条被折叠的回复点一下即可展开，页面底部可一键全部展开
> ■ 会学你的口味：悬停回复点「隐藏」，它就成为例子，AI 以后把同类也折叠；判错了点「误判」，该回复永不再折叠
> ■ 自定义规则：关键词（支持正则）和屏蔽用户列表，本地生效
> ■ 零配置：安装即用，每天 300 条免费 AI 判定额度；填自己的 OpenRouter key 可不限量
> ■ 透明：点工具栏图标查看本页扫描数、隐藏数、今日额度和总开关
>
> 工作方式：先用本地规则过滤明显的垃圾（零成本、不联网），其余回复交给 TypeSafe Jev 决策模型打分，超过阈值才折叠。
>
> 隐私：只处理你正在看的推文页上的公开回复文本，不读取账号、Cookie、私信或浏览历史。详见隐私政策。开源（MIT）：github.com/zhuyansen/x-reply-filter

- **详细说明（English，可选第二语言）**：

> Tired of promo, copy-paste reactions and AI filler burying the real discussion under X posts? Reply Filter for X collapses low-value replies into a one-line bar so the useful ones stand out.
>
> • Collapses four kinds of replies: spam/promo, engagement bait, off-topic, AI filler
> • Nothing is deleted: click any bar to expand, or expand all at once
> • Learns your taste: hover a reply and click Hide to make it an example; click "wrong" on a bar and that reply is never hidden again
> • Custom rules: keywords (regex supported) and blocked handles, applied locally
> • Zero setup: 300 free AI evaluations per day; add your own OpenRouter key for unlimited use
>
> Local rules run first (free, offline). Remaining replies are scored by the TypeSafe Jev decision model and collapsed only above a threshold. Open source (MIT).

- **Category**：Social & Communication（或 Productivity）
- **图标**：zip 内已含 128×128
- **截图（1280×800）**：`store/screenshot-1-thread.png`、`screenshot-2-teach.png`、`screenshot-3-popup.png`
- **Small promo tile（440×280）**：`store/promo-small-440x280.png`
- **Homepage URL**：https://xrf.ship2market.ai/
- **Support URL**：https://github.com/zhuyansen/x-reply-filter/issues （需先建公开仓库）

### Privacy practices
- **Single purpose**：Collapse low-value replies on X (x.com) post pages so users can focus on substantive discussion.
- **Permission justification**
  - `storage`：Saves the user's settings (on/off, threshold, custom keywords, blocked handles, optional API key), the examples they marked, and cached verdicts so a reply is never evaluated twice.
  - Host `https://x.com/*`, `https://twitter.com/*`（content script）：Reads the public reply text on the post page the user is viewing and collapses low-value replies in place.
  - Host `https://xrf.ship2market.ai/*`：The extension's own free-tier API, which forwards reply text to the decision model and returns scores.
  - Host `https://openrouter.ai/*`：Used only when the user enters their own OpenRouter API key, to call the model directly from the browser.
- **Remote code**：No. 所有 JS 都在包内，不加载远程脚本。
- **Data usage 勾选**
  - 勾选 **Website content**（读取页面上的回复文本并发送给模型判定）
  - 其余（个人身份信息、健康、财务、认证信息、个人通信、位置、浏览历史、用户活动）**都不勾**
  - 三条声明全部勾选：不出售数据 / 不用于与单一用途无关的目的 / 不用于信用评估
- **Privacy policy URL**：https://xrf.ship2market.ai/privacy

### Distribution
- Visibility：Public；Regions：All；Pricing：Free

## 审核预期与风险
- 首次提交通常 1 到 3 个工作日；用了 host 权限可能触发人工复审，会更久
- 名称用 `Reply Filter for X` 而非 `X Reply Filter`：「for + 平台名」是商店对第三方商标的惯例写法，降低被拒概率
- 界面目前只有中文。面向全球用户前建议补英文界面（`_locales` + UI 文案），否则英文区评分会受影响
- 公开上架后免费额度的花费由你承担：全局 $2/天封顶，外加 key 本身 $5/周上限；超了所有免费用户当天退回纯规则模式
