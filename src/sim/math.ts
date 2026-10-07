/** 推演核心内部数学工具（纯函数，无外部依赖） */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function deg2rad(d: number): number {
  return d * DEG2RAD;
}

export function rad2deg(r: number): number {
  return r * RAD2DEG;
}

/** 归一化到 [0, 360) */
export function normalizeDeg360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** 归一化到 [0, 2π) */
export function normalizeAngleRad(rad: number): number {
  const r = rad % TAU;
  return r < 0 ? r + TAU : r;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * 求解开普勒方程 M = E - e·sinE。
 * 固定迭代次数（非容差循环），保证同一输入在任何机器/任何调用次序下
 * 都执行完全相同的运算序列，结果逐位一致。
 */
export function solveKepler(meanAnomalyRad: number, eccentricity: number): number {
  let eccentricAnomaly = meanAnomalyRad;
  for (let i = 0; i < KEPLER_ITERATIONS; i += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRad;
    const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly);
    eccentricAnomaly -= residual / derivative;
  }
  return eccentricAnomaly;
}

/** 8 次牛顿迭代对本项目偏心率范围（< 0.3）远超双精度收敛需求 */
export const KEPLER_ITERATIONS = 8;
