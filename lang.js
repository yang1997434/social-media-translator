// Language detection: should this text be translated into Simplified Chinese?
// Classic script (content script) + node (tests). Nothing here leaks except XRF_LANG.
const XRF_LANG = (() => {
  // Remove everything that carries no language signal: placeholders, URLs, @mentions, #tags, emoji, punctuation, digits.
  const strip = t => String(t || "")
    .replace(/\[\[\d+\]\]/g, " ")
    .replace(/https?:\/\/\S+|\b[\w-]+\.(com|net|org|io|ai|co|me|dev|app|gg|xyz)(\/\S*)?/gi, " ")
    .replace(/[@#][\w一-鿿]+/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{P}\p{S}\d\s]+/gu, " ");

  // lang: the element's lang attribute when the site provides one (X sets it on every tweet).
  function shouldTranslate(text, lang) {
    if (lang && /^zh\b/i.test(lang)) return false;
    const t = strip(text).trim();
    if (t.length < 2) return false;
    if (!/[A-Za-zÀ-ɏЀ-ӿ぀-ヿ가-힯]/.test(t)) return false;   // needs at least one alphabetic script
    if (t.length < 4 && !/\s/.test(t)) return false;         // "OK", "lol": not worth a request
    const chars = [...t].filter(c => /\S/.test(c));
    const kana = chars.filter(c => /[぀-ヿ]/.test(c)).length;
    if (kana / chars.length > 0.05) return true;              // Japanese
    const cjk = chars.filter(c => /[㐀-鿿]/.test(c)).length;
    return cjk / chars.length < 0.3;                          // mostly Chinese already: skip
  }
  return { shouldTranslate, strip };
})();
if (typeof module !== "undefined") module.exports = XRF_LANG;
