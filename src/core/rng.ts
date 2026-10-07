/**
 * 确定性随机工具：同一种子永远得到同一序列。
 *
 * 纹样（如冰裂纹）、洒金分布、宣纸纤维的所有随机量都由此产生，
 * 因此同一份参数无论渲染/导出多少次，结果逐指令一致。
 */

/** FNV-1a 32 位字符串哈希，跨引擎稳定（输出为无符号 32 位整数） */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32：种子确定的伪随机数生成器，返回 [0, 1) */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由字符串种子构造确定性随机序列 */
export function seededRandom(seedString: string): () => number {
  return mulberry32(fnv1a(seedString));
}

/** 数值保留 3 位小数，保证显示指令可稳定哈希/比对 */
export function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
