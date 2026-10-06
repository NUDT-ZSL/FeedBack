/** 用例断言工具：失败时抛出带类别前缀的错误，供批量入口归因。 */
export class CaseFailure extends Error {
  category: string;
  constructor(category: string, message: string) {
    super(`[${category}] ${message}`);
    this.category = category;
  }
}

export function assert(condition: unknown, category: string, message: string): asserts condition {
  if (!condition) throw new CaseFailure(category, message);
}

export function assertEqual<T>(actual: T, expected: T, category: string, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new CaseFailure(category, `${label}: 期望 ${b}，实际 ${a}`);
  }
}

/** 确定性伪随机（mulberry32），保证离线可重复。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性洗牌。 */
export function shuffled<T>(items: T[], seed: number): T[] {
  const rand = seededRandom(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
