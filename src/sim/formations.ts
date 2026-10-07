import type { Vec2 } from './geometry';
import { add, dist, rotate, sub } from './geometry';
import type { FormationType } from './types';

export const SLOT_SPACING = 6;

/**
 * 以旗舰为原点的标准槽位（旗舰本地坐标系：+x 为舰艏方向）。
 * 返回长度为 wingmanCount 的僚舰相对偏移表。
 */
export function canonicalSlots(
  type: FormationType,
  wingmanCount: number,
): Vec2[] {
  const d = SLOT_SPACING;
  const slots: Vec2[] = [];
  if (type === 'yanxing') {
    // V 型雁行：成对分列旗舰两舷后方。
    let k = 1;
    while (slots.length < wingmanCount) {
      slots.push({ x: -d * k, y: d * k });
      if (slots.length < wingmanCount) {
        slots.push({ x: -d * k, y: -d * k });
      }
      k += 1;
    }
  } else if (type === 'yulin') {
    // 菱形鱼鳞：围绕旗舰逐环展开（前、左、右、后）。
    let k = 1;
    while (slots.length < wingmanCount) {
      const ring = [
        { x: d * k, y: 0 },
        { x: 0, y: d * k },
        { x: 0, y: -d * k },
        { x: -d * k, y: 0 },
      ];
      for (const s of ring) {
        if (slots.length >= wingmanCount) break;
        slots.push(s);
      }
      k += 1;
    }
  } else {
    // 偃月阵：旗舰前方左右对称展开的弧形，角度从舰艏向两舷递增。
    let k = 1;
    while (slots.length < wingmanCount) {
      const side = k % 2 === 1 ? 1 : -1;
      const step = Math.floor(k / 2);
      const theta = side * (Math.PI / 6) * (step + 1);
      slots.push({ x: d * k * Math.cos(theta), y: d * k * Math.sin(theta) });
      k += 1;
    }
  }
  return slots.slice(0, wingmanCount);
}

export interface SlotAssignmentInput {
  shipId: string;
  pos: Vec2;
}

/**
 * 按当前阵型规则补位：以“当前世界位置到标准槽位最近”做贪心匹配，
 * 按 shipId 顺序依次选槽，保证任意执行顺序下结果确定。
 */
export function assignSlots(
  wingmen: SlotAssignmentInput[],
  flagshipPos: Vec2,
  flagshipHeading: number,
  slots: Vec2[],
): Map<string, Vec2> {
  const result = new Map<string, Vec2>();
  const used = new Set<number>();
  const ordered = [...wingmen].sort((a, b) =>
    a.shipId < b.shipId ? -1 : a.shipId > b.shipId ? 1 : 0,
  );
  for (const w of ordered) {
    let best = -1;
    let bestDist = Infinity;
    slots.forEach((local, idx) => {
      if (used.has(idx)) return;
      const world = add(flagshipPos, rotate(local, flagshipHeading));
      const dd = dist(w.pos, world);
      if (dd < bestDist || (dd === bestDist && idx < best)) {
        best = idx;
        bestDist = dd;
      }
    });
    if (best >= 0) {
      used.add(best);
      result.set(w.shipId, slots[best]);
    }
  }
  return result;
}

/** 由世界位置反算某舰相对旗舰本地坐标系的偏移（阵型依据）。 */
export function localOffset(
  pos: Vec2,
  flagshipPos: Vec2,
  flagshipHeading: number,
): Vec2 {
  const world = sub(pos, flagshipPos);
  return rotate(world, -flagshipHeading);
}
