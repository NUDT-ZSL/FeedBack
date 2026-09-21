/*
 * relations.js — 笔记关联引擎（纯函数，无 DOM 依赖，浏览器与 Node 均可加载）。
 * 输入：notes = [{ id, title, tags: [..], text }]
 * 输出：Map<noteId, [{ id, score, reasons: { tags: [..], keywords: [..] } }]>
 *       每个条目按相关程度从高到低排序；没有关联的笔记对应空数组。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else root.Relations = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 常见停用字/词：不参与文本线索，避免“的地得”之类造成误连。
  const STOP_CHARS = new Set(
    "的了是在我有和就不人都一上也很到说要去你会着没有看好这那它们他她我们自己以及一个可以什么时候如果因为所以但是就是还是不是这个那个已经通过对于进行相关一些".split("")
  );
  const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are",
    "was", "were", "be", "been", "it", "this", "that", "with", "for",
    "as", "at", "by", "not", "but", "we", "you", "i", "he", "she", "they",
  ]);

  // 把自由文本切成“线索词”：英文/数字按单词，中文按二字滑窗。
  function tokenize(text) {
    const tokens = [];
    if (!text) return tokens;
    const lower = String(text).toLowerCase();
    const latin = lower.match(/[a-z0-9][a-z0-9_\-]*/g) || [];
    for (const w of latin) {
      if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.push(w);
    }
    const cjkRuns = String(text).match(/[一-鿿]+/g) || [];
    for (const run of cjkRuns) {
      if (run.length === 1) {
        if (!STOP_CHARS.has(run)) tokens.push(run);
        continue;
      }
      for (let i = 0; i < run.length - 1; i++) {
        const bg = run.slice(i, i + 2);
        if (!STOP_CHARS.has(bg[0]) && !STOP_CHARS.has(bg[1])) tokens.push(bg);
      }
    }
    return tokens;
  }

  function normalizeTags(tags) {
    const out = [];
    const seen = new Set();
    for (const t of tags || []) {
      const v = String(t).trim().toLowerCase();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    return out;
  }

  // idf：在越多笔记中出现，权重越低；df>=1 保证权重恒正但趋近于 0。
  function idf(totalNotes, docFreq) {
    return Math.log((totalNotes + 1) / docFreq);
  }

  const TAG_BASE_WEIGHT = 2.0;   // 共同标签的基础分
  const TEXT_THRESHOLD = 0.4;    // 纯文本线索的最低分，低于此视为噪声不连边

  function computeRelations(notes) {
    const N = notes.length;
    const prepared = notes.map((n) => ({
      id: n.id,
      tags: normalizeTags(n.tags),
      tokens: new Set(tokenize((n.title || "") + " " + (n.text || ""))),
    }));

    const tagDf = new Map();
    const tokDf = new Map();
    for (const p of prepared) {
      for (const t of p.tags) tagDf.set(t, (tagDf.get(t) || 0) + 1);
      for (const tok of p.tokens) tokDf.set(tok, (tokDf.get(tok) || 0) + 1);
    }

    const result = new Map();
    for (const p of prepared) result.set(p.id, []);

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = prepared[i], b = prepared[j];
        const sharedTags = a.tags.filter((t) => b.tags.includes(t));
        const sharedTokens = [];
        for (const tok of a.tokens) if (b.tokens.has(tok)) sharedTokens.push(tok);

        let tagScore = 0;
        for (const t of sharedTags) tagScore += TAG_BASE_WEIGHT + idf(N, tagDf.get(t));

        const kwWeights = sharedTokens
          .map((tok) => ({ tok, w: idf(N, tokDf.get(tok)) }))
          .filter((x) => x.w > 0)
          .sort((x, y) => y.w - x.w);
        let textScore = 0;
        for (const x of kwWeights) textScore += x.w;

        // 纯文本连边要求至少 2 个共享线索词，避免单个泛词造成误连；
        // 只要有共同标签则直接连边。
        const connected =
          sharedTags.length > 0 ||
          (textScore >= TEXT_THRESHOLD && kwWeights.length >= 2);
        if (!connected) continue;

        const score = tagScore + textScore;
        const reasons = {
          tags: sharedTags.slice(),
          keywords: kwWeights.slice(0, 5).map((x) => x.tok),
        };
        result.get(a.id).push({ id: b.id, score, reasons });
        result.get(b.id).push({ id: a.id, score, reasons });
      }
    }

    for (const list of result.values()) {
      list.sort((x, y) => y.score - x.score || String(x.id).localeCompare(String(y.id)));
    }
    return result;
  }

  return { tokenize, computeRelations, normalizeTags };
});
