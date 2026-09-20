// Local zero-cost rules. Each returns a reason string or null.
// Shared by the content script (browser) and the fixture test (mock chrome).
const XRF_RULES = (() => {
  const PROMO = /\b(link in (my )?bio|dm me|check my (profile|pinned)|follow (me|back)|promo ?code|free (money|crypto|airdrop)|whatsapp|telegram)\b/i;
  const CRYPTO = /\$[A-Z]{2,6}\b|\b(airdrop|presale|memecoin|to the moon|pump|100x|shitcoin|mint(ing)? now)\b/i;
  const BAIT = /^(first|so true|this|facts|real|w|l|based|same|exactly|agreed|lol|lmao|🔥+|💯+|😂+)[.!]*$/i;
  const AI_TOOL = /\b(this ai tool|ai agent that|automate your|try (this|our) (ai|tool)|built with ai)\b/i;
  const MIN_WORDS_FOR_TEXT = 2;
  const compact = t => String(t || "").normalize("NFKC").replace(/[\p{P}\p{S}\p{Z}\p{Cf}]/gu, "");
  function obviousSpam(reply) {
    const name = compact(reply.displayName);
    const t = compact(reply.text);
    const service = /同城上[门門]|[线線]下[选選]妃|[约約]炮|援交|外围|外圍/;
    // Promotional profile names are strong evidence; ordinary service names are not.
    if (service.test(name) && /[选選]妃|[约約]炮|援交|外围|外圍|高[颜顏]|嫩妹|御姐|空姐|[萝蘿]莉/.test(name)) return "招嫖引流";
    // Don't hide news, warnings, or discussions just for quoting a spam phrase.
    if (/警惕|曝光|举报|舉報|诈骗|詐騙|骗局|騙局|新闻|新聞|警方|打击|打擊|不要相信/.test(t)) return null;
    if (/维修|維修|保洁|保潔|家政|安装|安裝|回收|搬家|护理|護理/.test(t) && !/[选選]妃|[约約]炮|援交|外围|外圍/.test(t)) return null;
    if (service.test(t) && /私信|[联聯][系繫]|加[我微vV]|看主[页頁]|点主[页頁]|點主[頁页]|[预預][约約]|下[单單]/.test(t)) return "招嫖引流";
    return null;
  }

  const wordCount = t => t.trim().split(/\s+/).filter(Boolean).length;
  const emojiOnly = t => t.trim().length > 0 && /^[\p{Extended_Pictographic}\s‍️]+$/u.test(t);
  const looksBotHandle = h => /\d{6,}$/.test(h) || /^[a-z]+_[a-z]+\d{4,}$/i.test(h);

  // custom = { keywords: ["giveaway", "/reset.*please/i"], handles: ["spammer123"] }
  function compile(keyword) {
    const m = /^\/(.+)\/([a-z]*)$/.exec(keyword.trim());
    try { return m ? new RegExp(m[1], m[2] || "i") : new RegExp(keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
    catch { return null; }
  }

  function customHit(reply, custom) {
    if (!custom) return null;
    const h = (reply.handle || "").toLowerCase();
    if ((custom.handles || []).some(x => x.replace(/^@/, "").toLowerCase() === h)) return "已屏蔽用户";
    const hit = (custom.keywords || []).filter(k => k && k.trim()).map(compile).some(re => re && re.test(reply.text || ""));
    return hit ? "自定义关键词" : null;
  }

  function classify(reply, custom) {
    const t = reply.text || "";
    const mine = customHit(reply, custom);
    if (mine) return mine;
    const spam = obviousSpam(reply);
    if (spam) return spam;
    if (PROMO.test(t)) return "推广引流";
    if (CRYPTO.test(t)) return "加密货币 shill";
    if (AI_TOOL.test(t)) return "AI 工具推销";
    if (emojiOnly(t) || BAIT.test(t)) return "互动饵";
    if (wordCount(t) < MIN_WORDS_FOR_TEXT && reply.hasLink) return "纯链接";
    if (looksBotHandle(reply.handle) && wordCount(t) < 6) return "疑似机器人";
    return null;
  }
  // Timelines only use explicit account/keyword preferences and high-confidence ads.
  const classifyTimeline = (reply, custom) => customHit(reply, custom) || obviousSpam(reply);
  return { classify, classifyTimeline };
})();
if (typeof module !== "undefined") module.exports = XRF_RULES;
