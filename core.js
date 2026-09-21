// 纯数据规则模块：不访问 DOM，也不缓存关联结果。
// 每次调用 findRelated 都基于当前笔记重新计算，避免编辑后残留旧判断。

export const TAG_DELIMITER = /[,，;；、\s]+/;

const CJK_RANGE = /[㐀-鿿]+/g;
const WORD_RANGE = /[a-z0-9]+(?:[._-][a-z0-9]+)*/g;
const CJK_STOP_CHARS = new Set(
  "的了和与是在我有及或这那你他它们吧呢吗呀把被让向对于之中上下也都很就还要会能可而但则之其以".split("")
);
const STOP_PHRASES = new Set([
  "一个", "这个", "那个", "什么", "怎么", "如何", "可以", "可能", "应该",
  "需要", "因为", "所以", "但是", "如果", "然后", "现在", "之前", "之后",
  "里面", "东西", "事情", "没有", "不是", "就是", "还是", "以及", "对于",
  "关于", "通过", "进行", "相关", "关联", "笔记", "内容", "记录", "一下",
  "一些", "很多", "比较", "非常", "觉得", "认为", "知道", "看到", "时候",
  "地方", "问题", "方法", "工作", "个人", "系统", "用户",
  "个事情", "个问题", "个地方", "个东西", "个方法", "个工作"
]);
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
  "with", "is", "are", "was", "were", "be", "been", "as", "at", "by",
  "from", "this", "that", "these", "those", "it", "its", "my", "our",
  "we", "you", "i", "note", "notes"
]);

export function normalizeText(value = "") {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function parseTags(value = "") {
  const seen = new Set();
  const result = [];
  for (const raw of normalizeText(value).split(TAG_DELIMITER)) {
    const tag = normalizeText(raw);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      result.push(tag);
    }
  }
  return result;
}

function getRuns(text, field) {
  const normalized = normalizeText(text).toLowerCase();
  return [...normalized.matchAll(CJK_RANGE)]
    .map((match) => ({ value: match[0], start: match.index, field }));
}

function getLatinTerms(title, body) {
  const terms = new Map();
  for (const field of ["title", "body"]) {
    const normalized = normalizeText(field === "title" ? title : body).toLowerCase();
    for (const match of normalized.matchAll(WORD_RANGE)) {
      const value = match[0];
      if (STOP_WORDS.has(value) || (value.length === 1 && !/\d/.test(value))) continue;
      const existing = terms.get(value);
      const type = /^\d+$/.test(value) ? "number" : "word";
      if (existing) existing.inTitle ||= field === "title";
      else terms.set(value, { value, type, inTitle: field === "title" });
    }
  }
  return terms;
}

function analyzeNote(note) {
  return {
    note,
    tags: new Map(note.tags.map((tag) => [tag.toLowerCase(), tag])),
    latin: getLatinTerms(note.title, note.body),
    runs: [...getRuns(note.title, "title"), ...getRuns(note.body, "body")]
  };
}

function buildIndex(notes) {
  const analyzed = notes.map(analyzeNote);
  const latinFrequency = new Map();
  const bigramFrequency = new Map();

  for (const item of analyzed) {
    for (const value of item.latin.keys()) {
      latinFrequency.set(value, (latinFrequency.get(value) ?? 0) + 1);
    }
    const bigrams = new Set();
    for (const run of item.runs) {
      for (let index = 0; index < run.value.length - 1; index += 1) {
        bigrams.add(run.value.slice(index, index + 2));
      }
    }
    for (const bigram of bigrams) {
      bigramFrequency.set(bigram, (bigramFrequency.get(bigram) ?? 0) + 1);
    }
  }
  return { analyzed, latinFrequency, bigramFrequency };
}

function commonLength(a, b, startA, startB) {
  let length = 0;
  while (startA + length < a.length && startB + length < b.length &&
    a[startA + length] === b[startB + length]) {
    length += 1;
  }
  return length;
}

function intervalFree(used, start, length) {
  for (let index = start; index < start + length; index += 1) {
    if (used.has(index)) return false;
  }
  return true;
}

function markInterval(used, start, length) {
  for (let index = start; index < start + length; index += 1) used.add(index);
}

function validPhrase(phrase) {
  if (phrase.length < 2 || STOP_PHRASES.has(phrase)) return false;
  return ![...phrase].some((char) => CJK_STOP_CHARS.has(char));
}

function meaningfulSegments(phrase, start) {
  const segments = [];
  const isStop = (char) => CJK_STOP_CHARS.has(char);
  let segmentStart = 0;

  for (let index = 0; index <= phrase.length; index += 1) {
    if (index === phrase.length || isStop(phrase[index])) {
      const value = phrase.slice(segmentStart, index);
      if (value.length >= 2 && !STOP_PHRASES.has(value)) {
        segments.push({ value, sourceStart: start + segmentStart, length: value.length });
      }
      segmentStart = index + 1;
    }
  }
  return segments;
}

function commonPhraseClues(source, target, bigramFrequency, total) {
  const candidates = new Map();

  for (const sourceRun of source.runs) {
    for (const targetRun of target.runs) {
      for (let startA = 0; startA < sourceRun.value.length - 1; startA += 1) {
        for (let startB = 0; startB < targetRun.value.length - 1; startB += 1) {
          const length = commonLength(sourceRun.value, targetRun.value, startA, startB);
          if (length < 2) continue;
          const value = sourceRun.value.slice(startA, startA + length);
          const inTitle = sourceRun.field === "title" || targetRun.field === "title";
          const previous = candidates.get(value);
          if (!previous || (inTitle && !previous.inTitle)) {
            candidates.set(value, {
              value,
              length,
              inTitle,
              sourceStart: sourceRun.start + startA,
              sourceField: sourceRun.field
            });
          }
        }
      }
    }
  }

  const ordered = [...candidates.values()]
    .sort((a, b) => b.length - a.length ||
      a.value.localeCompare(b.value, "zh-Hans-CN"));
  const usedByField = { title: new Set(), body: new Set() };
  const clues = [];

  for (const candidate of ordered) {
    const used = usedByField[candidate.sourceField];
    if (!intervalFree(used, candidate.sourceStart, candidate.length)) continue;
    const segments = validPhrase(candidate.value)
      ? [{ value: candidate.value, sourceStart: candidate.sourceStart, length: candidate.length }]
      : meaningfulSegments(candidate.value, candidate.sourceStart);

    for (const segment of segments) {
      if (!intervalFree(used, segment.sourceStart, segment.length)) continue;
      markInterval(used, segment.sourceStart, segment.length);

      let rarestFrequency = total;
      for (let index = 0; index < segment.length - 1; index += 1) {
        const bigram = segment.value.slice(index, index + 2);
        rarestFrequency = Math.min(rarestFrequency, bigramFrequency.get(bigram) ?? 1);
      }
      const idf = Math.log((total + 1) / (rarestFrequency + 0.5)) + 1;
      const base = 3.1 + Math.min(segment.length, 5) * 0.8;
      const score = base * idf * (candidate.inTitle ? 1.35 : 1);
      clues.push({
        kind: "text",
        value: segment.value,
        type: segment.length >= 3 ? "cjk3" : "cjk2",
        inTitle: candidate.inTitle,
        score: Number(score.toFixed(3))
      });
    }
  }
  return clues;
}

function latinClues(source, target, latinFrequency, total) {
  const clues = [];
  for (const [value, term] of source.latin) {
    const other = target.latin.get(value);
    if (!other) continue;
    const frequency = latinFrequency.get(value) ?? 1;
    const idf = Math.log((total + 1) / (frequency + 0.5)) + 1;
    const base = term.type === "number" ? 1.4 : 2.75 + Math.min(value.length, 8) * 0.08;
    clues.push({
      kind: "text",
      value,
      type: term.type,
      inTitle: term.inTitle || other.inTitle,
      score: Number((base * idf * (term.inTitle || other.inTitle ? 1.35 : 1)).toFixed(3))
    });
  }
  return clues;
}

function isMeaningful(tagClues, textClues) {
  if (tagClues.length > 0) return true;
  if (textClues.some((clue) => clue.score >= 5.5)) return true;
  const supportive = textClues.filter((clue) => clue.score >= 4.2);
  return supportive.length >= 2;
}

const compareClues = (a, b) => b.score - a.score ||
  a.value.localeCompare(b.value, "zh-Hans-CN");

export function findRelated(notes = [], selectedId) {
  const current = notes.find((note) => note.id === selectedId);
  if (!current) return [];
  const { analyzed, latinFrequency, bigramFrequency } = buildIndex(notes);
  const source = analyzed.find((item) => item.note.id === selectedId);

  return analyzed
    .filter((item) => item.note.id !== selectedId)
    .map((target) => {
      const tagClues = [];
      for (const [key, tag] of source.tags) {
        if (target.tags.has(key)) tagClues.push({ kind: "tag", value: tag, score: 12 });
      }

      const textClues = [
        ...commonPhraseClues(source, target, bigramFrequency, notes.length),
        ...latinClues(source, target, latinFrequency, notes.length)
      ].sort(compareClues).slice(0, 8);

      tagClues.sort(compareClues);
      const score = Number(
        [...tagClues, ...textClues].reduce((sum, clue) => sum + clue.score, 0).toFixed(3)
      );
      return {
        id: target.note.id,
        note: target.note,
        score,
        tagClues,
        textClues,
        connected: isMeaningful(tagClues, textClues)
      };
    })
    .filter((result) => result.connected)
    .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt ||
      a.note.title.localeCompare(b.note.title, "zh-Hans-CN"));
}
