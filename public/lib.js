/* 纯函数工具库：分段、分句、分栏计算、滚动恢复。浏览器与 Node 均可用。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReflowLib = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 按空行分段，段内换行合并为空格
  function splitParagraphs(text) {
    return String(text)
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter((p) => p.length > 0);
  }

  // 把段落切成句子，保留句末标点（中英文）
  function splitSentences(paragraph) {
    const re = /[^。！？；!?;.…]+[。！？；!?;.…]*["'”’）)\]]*|\s+/g;
    const out = [];
    let m;
    while ((m = re.exec(paragraph)) !== null) {
      if (m[0].trim().length > 0) out.push(m[0].replace(/^\s+/, ""));
    }
    return out.length ? out : [paragraph];
  }

  const MIN_COL_CHARS = 16; // 每栏最少容纳的字符数
  const MAX_COLS = 3;
  const GAP_EM = 2.5;

  // 栏数是 (视窗宽, 字号) 的纯函数：同样输入永远得到同样结果，不会累积漂移
  function computeColumns(widthPx, fontSizePx) {
    if (!(widthPx > 0) || !(fontSizePx > 0)) return 1;
    const colPx = MIN_COL_CHARS * fontSizePx;
    const gapPx = GAP_EM * fontSizePx;
    const n = Math.floor((widthPx + gapPx) / (colPx + gapPx));
    return clamp(n, 1, MAX_COLS);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // 目标滚动位置：让内容坐标 elTop 落在视口高度的 frac 处
  function restoreScrollTop(elTop, frac, viewportH) {
    return Math.max(0, Math.round(elTop - frac * viewportH));
  }

  return {
    splitParagraphs,
    splitSentences,
    computeColumns,
    clamp,
    restoreScrollTop,
    MIN_COL_CHARS,
    MAX_COLS,
  };
});
