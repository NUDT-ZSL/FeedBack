/**
 * 皮影关节铰链物理模型（纯数值模块，不依赖 DOM/浏览器）。
 *
 * 对应技术架构文档 6.2「物理铰链模拟」：阻尼系数默认 0.3，
 * 关节受弹簧力趋近拖拽目标，角速度与角度均可被外部观察。
 *
 * 角度统一使用「度」对外暴露；内部物理积分采用临界阻尼弹簧，
 * 角度带有 [minDeg, maxDeg] 限位，碰到限位时速度清零（非弹性碰撞）。
 */

export interface HingeOptions {
  /** 关节角度下限（度） */
  minDeg: number;
  /** 关节角度上限（度） */
  maxDeg: number;
  /** 初始角度（度），默认取限位中点 */
  angleDeg?: number;
  /** 角阻尼系数，默认 0.3（架构文档约定值） */
  damping: number;
  /** 弹簧刚度，越大收敛越快；默认 30（临界阻尼附近，约 250ms 收敛） */
  stiffness?: number;
}

const RAD = Math.PI / 180;

function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`关节参数 ${name} 必须为有限数值，实际收到 ${String(value)}`);
  }
}

export class HingeJoint {
  readonly minDeg: number;
  readonly maxDeg: number;
  readonly damping: number;
  readonly stiffness: number;

  private angleDeg: number;
  private angularVelocityDegPerSec: number;
  private targetDeg: number;

  constructor(options: HingeOptions) {
    assertFinite(options.minDeg, 'minDeg');
    assertFinite(options.maxDeg, 'maxDeg');
    assertFinite(options.damping, 'damping');
    if (options.stiffness !== undefined) {
      assertFinite(options.stiffness, 'stiffness');
    }
    if (options.minDeg > options.maxDeg) {
      throw new RangeError(`关节限位非法：minDeg(${options.minDeg}) > maxDeg(${options.maxDeg})`);
    }
    if (options.damping < 0) {
      throw new RangeError(`阻尼系数不能为负：${options.damping}`);
    }
    if ((options.stiffness ?? 30) < 0) {
      throw new RangeError(`弹簧刚度不能为负：${options.stiffness}`);
    }
    this.minDeg = options.minDeg;
    this.maxDeg = options.maxDeg;
    this.damping = options.damping;
    this.stiffness = options.stiffness ?? 30;
    const initial = options.angleDeg ?? (options.minDeg + options.maxDeg) / 2;
    assertFinite(initial, 'angleDeg');
    this.angleDeg = clamp(initial, this.minDeg, this.maxDeg);
    this.angularVelocityDegPerSec = 0;
    this.targetDeg = this.angleDeg;
  }

  get angle(): number {
    return this.angleDeg;
  }

  get velocity(): number {
    return this.angularVelocityDegPerSec;
  }

  get target(): number {
    return this.targetDeg;
  }

  /**
   * 设置用户拖拽目标角度。目标会被收敛到关节限位内（越界输入不产生越界状态），
   * 返回值说明输入是否被截断以及截断后的目标，便于上层区分「边界输入」。
   */
  setTarget(inputDeg: number): { targetDeg: number; clamped: boolean } {
    assertFinite(inputDeg, 'targetDeg');
    const clamped = inputDeg < this.minDeg || inputDeg > this.maxDeg;
    this.targetDeg = clamp(inputDeg, this.minDeg, this.maxDeg);
    return { targetDeg: this.targetDeg, clamped };
  }

  /**
   * 直接施加一个瞬时角力（对应快速甩动竹签的操纵）。
   * 力本身不截断，但产生的运动在下一帧积分时仍受限位约束。
   */
  applyForce(forceDegPerSecSq: number): void {
    assertFinite(forceDegPerSecSq, 'force');
    const dt = 1 / 60;
    this.integrate(dt, forceDegPerSecSq);
  }

  /**
   * 直接把角度放到指定位置（装配吸附 / 夹具初始化用）。
   * 非有限输入抛错；越界输入截断到限位，运动状态清零。
   */
  snapTo(inputDeg: number): { angleDeg: number; clamped: boolean } {
    assertFinite(inputDeg, 'angleDeg');
    const clamped = inputDeg < this.minDeg || inputDeg > this.maxDeg;
    this.angleDeg = clamp(inputDeg, this.minDeg, this.maxDeg);
    this.angularVelocityDegPerSec = 0;
    this.targetDeg = this.angleDeg;
    return { angleDeg: this.angleDeg, clamped };
  }

  /** 前进一步固定步长积分（60fps），保证可重复、与渲染帧率解耦。 */
  step(): void {
    this.integrate(1 / 60, 0);
  }

  /**
   * 半隐式欧拉积分：临界阻尼弹簧趋近目标角度。
   * 碰撞到硬限位时速度清零，因此越界目标最终精确停在边界，不会在边界抖动。
   */
  private integrate(dt: number, externalForce: number): void {
    const displacement = this.angleDeg - this.targetDeg;
    const acceleration =
      -this.stiffness * displacement - this.damping * this.angularVelocityDegPerSec + externalForce;
    this.angularVelocityDegPerSec += acceleration * dt;
    // 架构文档 6.2：每帧角速度额外衰减 5%（与渲染帧率解耦的等效形式）
    this.angularVelocityDegPerSec *= Math.pow(0.95, dt * 60);
    let next = this.angleDeg + this.angularVelocityDegPerSec * dt;
    if (next <= this.minDeg) {
      next = this.minDeg;
      this.angularVelocityDegPerSec = 0;
    } else if (next >= this.maxDeg) {
      next = this.maxDeg;
      this.angularVelocityDegPerSec = 0;
    }
    this.angleDeg = next;
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 角度归一化到 [-180, 180)，供联动模块使用。 */
export function wrapAngle180(deg: number): number {
  let wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180) wrapped = 180;
  return wrapped;
}

export const RAD_PER_DEG = RAD;
export const DEG_PER_RAD = 1 / RAD;
