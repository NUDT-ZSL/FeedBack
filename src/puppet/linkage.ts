/**
 * 多关节联动（纯数值模块）。
 *
 * 皮影肢体由「肩/髋 → 肘/膝 → 手/脚」三段两节铰链构成，
 * 拖拽末端（手/脚）时需要同时求出肩、肘两个关节角度——即双骨逆运动学（CCD 解析解）。
 *
 * 本模块提供两类联动：
 *  1. solveTwoBoneIK：拖拽末端 → 两个关节角度（互相一致：正运动学结果必须对回末端）
 *  2. propagateChainDelta：转动父关节 → 按耦合系数向子关节传导
 *
 * 约定：角度均为「度」，0° 指向 +x 方向，逆时针为正；
 * bendSign 选择肘部弯折方向（+1 或 -1），皮影左右肢体取相反符号。
 */

import { clamp, wrapAngle180, RAD_PER_DEG, DEG_PER_RAD } from './hinge.ts';

export interface JointLimit {
  minDeg: number;
  maxDeg: number;
}

export interface TwoBoneChain {
  /** 根关节（肩/髋）位置 */
  origin: { x: number; y: number };
  /** 上臂/大腿长度 */
  upperLength: number;
  /** 下臂/小腿长度 */
  lowerLength: number;
  /** 根关节限位（相对全局角度） */
  rootLimit: JointLimit;
  /** 肘/膝关节限位（弯折幅度，非负区间，如 [0, 120]） */
  bendLimit: JointLimit;
  /** 弯折方向，+1 逆时针 / -1 顺时针 */
  bendSign: 1 | -1;
}

export interface TwoBonePose {
  /** 根关节全局角度（度） */
  rootAngleDeg: number;
  /** 肘关节弯折角（度，恒为非负；实际弯折方向由 bendSign 决定） */
  bendAngleDeg: number;
  /** 解析解要求的肘部弯折；与最终 bend 的差值即限位截断量 */
  requiredBendDeg: number;
  /** 末端（手/脚）世界坐标 */
  end: { x: number; y: number };
  /** 肘部世界坐标 */
  elbow: { x: number; y: number };
  /** 目标到根的距离 */
  reach: number;
  /** 目标是否在可达范围内（未被长度/限位强制拉伸） */
  reachable: boolean;
  /** 根关节或肘关节是否被限位截断 */
  limited: boolean;
}

function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`联动参数 ${name} 必须为有限数值，实际收到 ${String(value)}`);
  }
}

function validateChain(chain: TwoBoneChain): void {
  if (!(chain.upperLength > 0) || !(chain.lowerLength > 0)) {
    throw new RangeError('双骨长度必须为正数');
  }
  if (chain.rootLimit.minDeg > chain.rootLimit.maxDeg) {
    throw new RangeError('根关节限位非法：min > max');
  }
  if (chain.bendLimit.minDeg > chain.bendLimit.maxDeg) {
    throw new RangeError('肘关节限位非法：min > max');
  }
  if (chain.bendSign !== 1 && chain.bendSign !== -1) {
    throw new RangeError('bendSign 只能为 1 或 -1');
  }
}

/** 双骨正运动学：由根角度与肘部弯折求肘、末端世界坐标。 */
export function forwardKinematics(
  chain: Pick<TwoBoneChain, 'origin' | 'upperLength' | 'lowerLength' | 'bendSign'>,
  rootAngleDeg: number,
  bendAngleDeg: number,
): { elbow: { x: number; y: number }; end: { x: number; y: number } } {
  const rootRad = rootAngleDeg * RAD_PER_DEG;
  const cosRoot = Math.cos(rootRad);
  const sinRoot = Math.sin(rootRad);
  const elbow = {
    x: chain.origin.x + chain.upperLength * cosRoot,
    y: chain.origin.y + chain.upperLength * sinRoot,
  };
  const lowerAngleRad = rootRad + chain.bendSign * bendAngleDeg * RAD_PER_DEG;
  const end = {
    x: elbow.x + chain.lowerLength * Math.cos(lowerAngleRad),
    y: elbow.y + chain.lowerLength * Math.sin(lowerAngleRad),
  };
  return { elbow, end };
}

/**
 * 双骨逆运动学解析解。
 *
 * - 距离超出最大伸展：完全伸直朝向目标（两个关节都贴边界 0/限位）。
 * - 目标与原点重合：保持上臂朝向 +x、完全收拢（确定性退化处理，不产生 NaN）。
 * - 可达：余弦定理求肘部弯折角，再求根角度；最后逐个应用关节限位，
 *   被限位截断后以「截断后的角度 + 正运动学」为准，保证返回的 end 与角度始终互相一致。
 */
export function solveTwoBoneIK(chain: TwoBoneChain, target: { x: number; y: number }): TwoBonePose {
  validateChain(chain);
  assertFinite(target.x, 'target.x');
  assertFinite(target.y, 'target.y');

  const { origin, upperLength: a, lowerLength: b } = chain;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const reach = Math.hypot(dx, dy);
  const maxReach = a + b;

  let rootAngleDeg: number;
  let bendAngleDeg: number;
  let reachable = true;

  if (reach === 0) {
    // 退化：末端被拖回关节根部。收拢到上臂 +x 方向，完全折叠。
    rootAngleDeg = 0;
    bendAngleDeg = 180;
    reachable = false;
  } else if (reach >= maxReach) {
    // 越界：伸直朝向目标。根角度=方位角，弯折归零。
    rootAngleDeg = Math.atan2(dy, dx) * DEG_PER_RAD;
    bendAngleDeg = 0;
    reachable = false;
  } else {
    // 肘部三角形内角 ψ（余弦定理），弯折角 = 180° − ψ（相对完全伸直的偏离量）
    const cosInner = clamp((a * a + b * b - reach * reach) / (2 * a * b), -1, 1);
    const innerDeg = Math.acos(cosInner) * DEG_PER_RAD;
    bendAngleDeg = 180 - innerDeg;
    const cosRoot = (reach * reach + a * a - b * b) / (2 * reach * a);
    const shoulderOffset = Math.acos(clamp(cosRoot, -1, 1)) * DEG_PER_RAD;
    const heading = Math.atan2(dy, dx) * DEG_PER_RAD;
    rootAngleDeg = heading - chain.bendSign * shoulderOffset;
  }

  const requiredBendDeg = bendAngleDeg;

  let limited = false;
  const clampedBend = clamp(bendAngleDeg, chain.bendLimit.minDeg, chain.bendLimit.maxDeg);
  if (clampedBend !== bendAngleDeg) {
    bendAngleDeg = clampedBend;
    limited = true;
  }
  const clampedRoot = clamp(rootAngleDeg, chain.rootLimit.minDeg, chain.rootLimit.maxDeg);
  if (clampedRoot !== rootAngleDeg) {
    rootAngleDeg = clampedRoot;
    limited = true;
  }

  const { elbow, end } = forwardKinematics(chain, rootAngleDeg, bendAngleDeg);
  return {
    rootAngleDeg,
    bendAngleDeg,
    requiredBendDeg,
    end,
    elbow,
    reach,
    reachable,
    limited,
  };
}

export interface ChainNode {
  id: string;
  limit: JointLimit;
  /** 传导给下一个关节的耦合系数（0 不传导，1 完全联动） */
  couplingToChild: number;
}

export interface ChainDeltaResult {
  /** 每个关节最终相对初始姿态的角度增量（度），已按各自限位截断 */
  realizedDeltaDeg: number[];
  /** 各关节因限位吃掉的角度（截断量，绝对值） */
  blockedDeg: number[];
}

/**
 * 沿关节链（如 肩→肘→腕）传导一次拖拽产生的角度增量。
 *
 * raw 输入先按本关节限位截断，实际生效量按 couplingToChild 传导给子关节；
 * 被限位吃掉的部分不继续传导（皮影铆钉结构的约束：父关节到不了的位置子关节无法补偿）。
 * 非有限输入抛错，非法耦合系数（不在 [0,1]）抛错。
 */
export function propagateChainDelta(nodes: ChainNode[], rawDeltaDeg: number): ChainDeltaResult {
  assertFinite(rawDeltaDeg, 'rawDeltaDeg');
  if (nodes.length === 0) {
    throw new RangeError('联动关节链不能为空');
  }
  const realized: number[] = [];
  const blocked: number[] = [];
  let incoming = rawDeltaDeg;
  for (const node of nodes) {
    if (node.limit.minDeg > node.limit.maxDeg) {
      throw new RangeError(`关节 ${node.id} 限位非法：min > max`);
    }
    if (node.couplingToChild < 0 || node.couplingToChild > 1) {
      throw new RangeError(`关节 ${node.id} 耦合系数必须在 [0,1] 内`);
    }
    const clipped = clamp(incoming, node.limit.minDeg, node.limit.maxDeg);
    realized.push(clipped);
    blocked.push(Math.abs(wrapAngle180(incoming - clipped)));
    incoming = clipped * node.couplingToChild;
  }
  return { realizedDeltaDeg: realized, blockedDeg: blocked };
}
