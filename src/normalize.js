export const RELATIONS = {
  related: { label: "相关", polarity: 0, directed: false },
  supports: { label: "支持", polarity: 1, directed: false },
  refines: { label: "细化", polarity: 1, directed: true },
  contradicts: { label: "矛盾", polarity: -1, directed: false },
  supersedes: { label: "被替代为", polarity: -1, directed: true },
  merges_into: { label: "并入", polarity: -1, directed: true }
};

export const STATUS_LABELS = {
  active: "生效中",
  merged: "已合并",
  deprecated: "已废弃"
};

const GENERIC_WORDS = new Set([
  "经验", "方案", "问题", "处理", "进行", "需要", "应该", "可以",
  "一个", "这些", "那些", "我们", "他们", "时候", "如果", "then",
  "with", "from", "this", "that", "should", "must"
]);

export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export function normalizeTags(tags = []) {
  return [...new Set(tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))]
    .sort();
}

function latinTokens(value) {
  return (String(value).toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])
    .filter(word => !GENERIC_WORDS.has(word));
}

function hanRuns(value) {
  return String(value).match(/\p{Script=Han}{2,}/gu) || [];
}

export function commonPhrases(a, b, minLength = 2, limit = 4) {
  if (!a.length || !b.length) return [];
  const grid = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  const matches = new Set();

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        grid[i][j] = grid[i - 1][j - 1] + 1;
        if (grid[i][j] >= minLength) {
          const maxLength = Math.min(grid[i][j], 6);
          for (let length = minLength; length <= maxLength; length += 1) {
            matches.add(a.slice(i - length, i));
          }
        }
      }
    }
  }

  return [...matches]
    .filter(phrase => !GENERIC_WORDS.has(phrase))
    .filter(phrase => {
      const positions = [];
      let cursor = 0;
      while (cursor <= a.length - phrase.length) {
        const index = a.indexOf(phrase, cursor);
        if (index < 0) break;
        positions.push(index);
        cursor = index + 1;
      }
      return positions.some(index =>
        (!a[index - 1] || !b.includes(a.slice(index - 1, index + phrase.length))) &&
        (!a[index + phrase.length] || !b.includes(a.slice(index, index + phrase.length + 1)))
      );
    })
    .sort((x, y) => y.length - x.length || x.localeCompare(y, "zh-Hans-CN"))
    .filter((phrase, index, array) =>
      !array.slice(0, index).some(other => other.includes(phrase))
    )
    .slice(0, limit);
}

export function bodyClues(a, b) {
  const sharedLatin = [...new Set(latinTokens(a))].filter(word =>
    new Set(latinTokens(b)).has(word)
  ).slice(0, 4);
  const runsA = hanRuns(a);
  const runsB = hanRuns(b);
  const phrases = [];

  for (const runA of runsA) {
    for (const runB of runsB) {
      for (const phrase of commonPhrases(runA, runB, 2, 3)) {
        if (!phrases.some(existing => existing.includes(phrase) || phrase.includes(existing))) {
          phrases.push(phrase);
        }
      }
    }
  }

  return [...new Set([...sharedLatin, ...phrases])].slice(0, 4);
}

function inferenceTokens(value) {
  const tokens = new Set(latinTokens(value));
  const normalized = normalizeText(value);
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const pair = normalized.slice(i, i + 2);
    if (/[\u4e00-\u9fff]{2}/u.test(pair) && !GENERIC_WORDS.has(pair)) tokens.add(pair);
  }
  return tokens;
}

export function jaccard(left, right) {
  const a = left instanceof Set ? left : new Set(left);
  const b = right instanceof Set ? right : new Set(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function textSimilarity(a, b) {
  return jaccard(inferenceTokens(a), inferenceTokens(b));
}

export function contentSignature(entry) {
  return JSON.stringify({
    body: normalizeText(entry.body),
    tags: normalizeTags(entry.tags),
    status: entry.status
  });
}

export function pairId(a, b, kind = "related") {
  return [a, b].sort().join("|") + `|${kind}`;
}
