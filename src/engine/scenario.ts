// 确定性示例星体生成：用固定种子的 PRNG，保证 CLI 与页面拿到完全相同的场景。
import type { OrbitalBodyParams, RingKey } from './types.ts';
import { RING_KEYS, RING_COLORS } from './types.ts';

/** mulberry32：确定性伪随机（仅用于生成示例场景，推演引擎本身不依赖随机数） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BODY_NAMES = [
  '岁星', '荧惑', '镇星', '太白', '辰星',
  '轩辕', '天狼', '织女', '河鼓', '心宿',
  '尾宿', '箕宿', '斗宿', '牛宿', '女宿'
];

/**
 * 生成示例星体。为演示遮挡判定：
 *  - 同环星体按均匀相位排布；
 *  - 每 5 颗中的最后一颗与前一颗同环且相位差约 1~2.5°（低于默认角度阈值），
 *    但深度/亮度不同，用于检验“按观测者视角决胜”而不是按遍历顺序覆盖。
 */
export function generateBodies(count: number, seed = 42): OrbitalBodyParams[] {
  const rand = mulberry32(seed);
  const bodies: OrbitalBodyParams[] = [];
  const ringCounts: Record<RingKey, number> = { ecliptic: 0, equator: 0, galactic: 0 };

  for (let i = 0; i < count; i++) {
    const homeRing: RingKey = RING_KEYS[i % RING_KEYS.length];
    const indexInRing = ringCounts[homeRing];
    const perRing = Math.ceil(count / RING_KEYS.length);
    let phase0 = (indexInRing * 360) / perRing;
    if (indexInRing % 5 === 4) {
      // 与同环前一颗构成近重合对
      phase0 = ((indexInRing - 1) * 360) / perRing + 1 + rand() * 1.5;
    } else {
      phase0 += (rand() - 0.5) * 2;
    }
    ringCounts[homeRing] = indexInRing + 1;
    bodies.push({
      id: `body-${String(i).padStart(3, '0')}`,
      name:
        BODY_NAMES[i % BODY_NAMES.length] +
        (i >= BODY_NAMES.length ? `·${Math.floor(i / BODY_NAMES.length) + 1}` : ''),
      homeRing,
      radius: 3.2 + rand() * 1.6,
      phase0: phase0 % 360,
      period: 20000 + rand() * 80000,
      // 轨道倾角修正：大多数星体基本共面，少量有明显修正
      inclination: rand() < 0.75 ? rand() * 2 : rand() * 12,
      azimuth: rand() * 360,
      depthOrder: i,
      magnitude: Math.round((rand() * 4 + 0.5) * 10) / 10,
      color: RING_COLORS[homeRing],
      revision: 0
    });
  }
  return bodies;
}
