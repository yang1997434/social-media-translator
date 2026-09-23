# Chrome Web Store 上架材料（Social Media Translator 0.8.0）

上传包：`dist/x-reply-filter-0.8.0.zip`（`./build.sh` 生成，打包时会扫描密钥；包里只有扩展本身的代码和图标，不含任何 API Key）。
填写时可以打开 `store/listing.html`，每一段都有「复制」按钮。

## 你本人要做的（账号和付款我不能代办）

1. 打开 https://chrome.google.com/webstore/devconsole ，用你的 Google 账号登录（账号需要开启两步验证）
2. 首次使用：接受开发者协议，支付 **US$5 一次性注册费**
3. 「账号」页：填发布者名称，验证联系邮箱（不验证不能发布）；交易者声明选「非交易者」（个人、非商业）

## 表单（按后台页面顺序）

### 1 · 上传

「新增项目」→ 上传 `dist/x-reply-filter-0.8.0.zip`。名称、简短说明、图标从 zip 里的 manifest 读取，不用填。

### 2 · 商品详情（Store listing）

- **语言**：中文（简体）
- **类别**：Tools（工具）
- **详细说明**：

```
看 X（推特）和 Reddit 时，外文帖子和评论原地变成中文：译文直接出现在原文的位置，沿用原文的字体字号，读起来就像帖子本来就是中文写的。

■ 原地翻译：@用户名、链接、表情原样保留、照常可点；悬停点「原文」一键切回，也可以选双语对照
■ 滚到哪翻到哪：提前预取、流式返回，哪条先好先显示
■ 不做无用功：已经是中文的不翻；X 自带 Grok 翻译过的推文交给 X；纯链接、纯表情、数字不发请求；翻过的内容本地缓存，不重复花钱
■ 任意网页：X / Reddit 以外的网页，点右侧浮标或工具栏图标，一键翻译 / 还原整页
■ 自选服务商：硅基流动、Cerebras、OpenRouter 三选一，用你自己的 API Key，费用直接付给服务商
■ 花费透明：弹窗显示今日、本月、累计的段数和金额；同一 Chrome 账号下的多台电脑自动合计
■ 评论过滤（可选）：折叠 X 评论区的推广、互动饵、跑题和 AI 套话；本地规则免费，填自己的 TypeSafe Key 可开启 AI 判定

使用前需要自备 API Key：安装后设置页会自动打开，选服务商、粘贴 Key、点「测试」看到 ✓ 就可以用了。

隐私：开发者不运营任何服务器，不收集任何数据。文本只发给你自己选择的服务商，API Key 只存在你的浏览器里。
开源（MIT）：github.com/yang1997434/social-media-translator
```

- **截图（1280×800）**：`store/screenshot-1-inplace.png`、`screenshot-2-popup.png`、`screenshot-3-anypage.png`、`screenshot-4-providers.png`
- **小型宣传图块（440×280）**：`store/promo-small-440x280.png`
- **官方网址 / 首页**：https://github.com/yang1997434/social-media-translator
- **支持网址**：https://github.com/yang1997434/social-media-translator/issues

想加英文作为第二语言时用这段：

```
Read X (Twitter) and Reddit in Chinese. Foreign-language posts and comments are translated into Simplified Chinese in place: the translation takes the original's spot and font, so the page reads as if it were written in Chinese.

• In place: @handles, links and emoji stay clickable; hover and click "原文" to see the original, or switch to bilingual mode
• As you scroll: prefetched and streamed, each post appears as soon as it is ready
• No wasted calls: text already in Chinese, posts X translated with Grok, bare links, emoji and numbers are skipped; translations are cached locally
• Any page: outside X / Reddit, click the side tab or the toolbar icon to translate or restore the whole page
• Bring your own key: SiliconFlow, Cerebras or OpenRouter; you pay the provider directly
• Cost at a glance: today / this month / total, summed across your devices on the same Chrome account
• Optional reply filter: folds promo, engagement bait, off-topic and AI-filler replies on X; local rules are free, AI scoring uses your own TypeSafe key

Requires your own API key: the settings page opens after install. Pick a provider, paste the key, click Test.
Privacy: the developer runs no servers and collects no data. Text goes only to the provider you choose; keys stay in your browser.
Open source (MIT): github.com/yang1997434/social-media-translator
```

### 3 · 隐私权（Privacy practices）

- **单一用途说明**：

```
Translate foreign-language social media (posts and comments on X and Reddit, or any web page on demand) into Simplified Chinese in place. An optional setting folds low-quality replies on X so translated threads are easier to read.
```

- **权限理由**：
  - `storage`

```
Saves the user's settings and their own API keys, a local cache of translations so the same text is never paid for twice, the usage counters shown in the popup, and the reply examples the user marked.
```

  - `activeTab`

```
When the user clicks "Translate this page" in the popup, only the current tab is translated.
```

  - `scripting`

```
Injects the translator into the current tab when the user clicks "Translate this page" and the content script is not running there yet (for example, tabs opened before the extension was installed).
```

  - 主机权限（Host permission）

```
API hosts (api.siliconflow.cn, api.cerebras.ai, openrouter.ai, api.typesafe.ai): the extension calls only the provider the user selected, with the user's own API key; no other server is contacted. Content scripts: on x.com, twitter.com and reddit.com posts and comments are translated automatically. On other http/https pages the content script only shows a small side tab at the right edge; the page is not read and nothing is sent until the user clicks it.
```

- **远程代码**：选「否，我没有使用远程代码」（所有 JS 都在包内）
- **数据使用**：勾选 **网站内容**（要翻译的页面文字发给用户选的服务商）和 **身份验证信息**（用户填写的 API Key，只发给对应服务商）；其余都不勾
- 三条声明全部勾选：不出售给第三方 / 不用于与单一用途无关的目的 / 不用于信用评估
- **隐私权政策网址**：https://github.com/yang1997434/social-media-translator/blob/main/PRIVACY.md

### 4 · 分发（Distribution）

- 公开范围：**公开**（任何人都能搜到并安装）；只想发链接给熟人就选「不公开列出」
- 地区：所有地区

### 5 · 提交审核

点「提交以供审核」。可以取消勾选「审核通过后自动发布」，通过后自己点发布。

## 审核预期与风险

- 首次提交一般几个工作日。扩展在所有网站上运行（为了显示浮标），会触发更严格的人工审核，可能更久
- 可能的拒绝理由：「单一用途」。翻译和评论过滤是两个功能，说明里已经把过滤写成翻译的附属设置；如果仍被拒，可以把过滤从上架版里拿掉
- 界面只有中文，面向中文用户

## 通过之后

1. 两台 Mac 都从商店安装，并在 `chrome://extensions` **移除现在这个「已解压」的版本**，否则同一个页面会被两份扩展各翻一遍
2. 商店版的扩展 ID 和现在不同，相当于新扩展：API Key 要重填一次（Chrome 同步正常的话，填一台另一台自动有），已解压版里记的历史用量不会带过去
3. 以后更新：改 `manifest.json` 的 `version` → `./build.sh` → 后台「软件包」上传新 zip → 提交审核
