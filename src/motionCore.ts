/**
 * 运动与聚焦链路的纯逻辑核心。
 *
 * 本模块不依赖 three.js、DOM 或任何浏览器 API，所有状态（行星角度、
 * 聚焦进度、相机目标点）都有独立、可复现的入口，可以在无渲染环境下
 * 用固定 delta 逐帧推进并得到确定性结果。
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 公转速度的全局缩放系数（与历史行为保持一致）。 */
export const ORBIT_SPEED_SCALE = 0.1;
/** 聚焦过程中相机位置每帧向目标插值的最大比例。 */
export const FOCUS_CAMERA_LERP = 0.05;
/** 聚焦过程中控制器目标点每帧向行星位置插值的比例。 */
export const FOCUS_CONTROLS_LERP = 0.05;

/**
 * 推进一帧的公转角度。
 * 角度完全由 (angle, orbitSpeed, delta, speedMultiplier) 决定，
 * 速度倍率变化只影响后续增量，不会重置或跳变已有角度。
 */
export function advanceOrbitAngle(
  angle: number,
  orbitSpeed: number,
  delta: number,
  speedMultiplier: number
): number {
  return angle + orbitSpeed * delta * ORBIT_SPEED_SCALE * speedMultiplier;
}

/** 推进一帧的自转角度，规则与公转一致。 */
export function advanceRotationAngle(
  rotation: number,
  rotationSpeed: number,
  delta: number,
  speedMultiplier: number
): number {
  return rotation + rotationSpeed * delta * speedMultiplier;
}

/** 由轨道半径与角度计算行星在轨道平面上的位置。 */
export function orbitPosition(distance: number, angle: number): Vec3Like {
  return {
    x: Math.cos(angle) * distance,
    y: 0,
    z: Math.sin(angle) * distance
  };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerpVec3(from: Vec3Like, to: Vec3Like, alpha: number): Vec3Like {
  return {
    x: from.x + (to.x - from.x) * alpha,
    y: from.y + (to.y - from.y) * alpha,
    z: from.z + (to.z - from.z) * alpha
  };
}

/** 就地插值，兼容 THREE.Vector3 等具有 x/y/z 字段的可变对象。 */
export function lerpVec3InPlace(from: Vec3Like, to: Vec3Like, alpha: number): void {
  from.x += (to.x - from.x) * alpha;
  from.y += (to.y - from.y) * alpha;
  from.z += (to.z - from.z) * alpha;
}

export function distanceVec3(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function cloneVec3(v: Vec3Like): Vec3Like {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * 计算聚焦某行星时相机应到达的位置：
 * 从行星指向当前相机方向、距离行星 radius * 6 + 5 处。
 */
export function computeFocusCameraPosition(
  planetPos: Vec3Like,
  cameraPos: Vec3Like,
  planetRadius: number
): Vec3Like {
  const dir = {
    x: cameraPos.x - planetPos.x,
    y: cameraPos.y - planetPos.y,
    z: cameraPos.z - planetPos.z
  };
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  const distance = planetRadius * 6 + 5;
  return {
    x: planetPos.x + (dir.x / len) * distance,
    y: planetPos.y + (dir.y / len) * distance,
    z: planetPos.z + (dir.z / len) * distance
  };
}

/**
 * 聚焦状态机。集中管理原来散落在帧循环闭包里的
 * focusTarget / focusProgress / focusPlanetName 三个状态。
 *
 * 关键语义：
 * - startFocus 会彻底替换旧目标并把进度重置为 0，绝不叠加；
 * - update 在进度达到 1 后清空目标，后续帧不再触碰相机与控制器目标点。
 */
export class FocusController {
  /** 聚焦进度，范围 [0, 1]。 */
  progress = 0;
  /** 相机位置的聚焦目标（聚焦开始时的快照），未完成时为 null。 */
  cameraTarget: Vec3Like | null = null;
  /** 当前聚焦的行星名，未聚焦时为空字符串。 */
  planetName = '';

  /** 开始一次新的聚焦：替换目标、重置进度。 */
  startFocus(cameraTarget: Vec3Like, planetName: string): void {
    this.cameraTarget = cloneVec3(cameraTarget);
    this.planetName = planetName;
    this.progress = 0;
  }

  /** 是否仍处于聚焦进行中（下一帧还会更新相机/控制器）。 */
  get isActive(): boolean {
    return this.cameraTarget !== null && this.progress < 1;
  }

  /**
   * 推进一帧聚焦。
   *
   * @param delta          本帧时间步长
   * @param cameraPos      相机位置（会被就地修改）
   * @param controlsTarget 轨道控制器目标点（可选，会被就地修改）
   * @param planetPos      被聚焦行星的当前位置（可选）
   * @returns 本帧是否更新了相机/控制器
   */
  update(
    delta: number,
    cameraPos: Vec3Like,
    controlsTarget?: Vec3Like | null,
    planetPos?: Vec3Like | null
  ): boolean {
    if (!this.cameraTarget || this.progress >= 1) {
      return false;
    }

    this.progress = Math.min(1, this.progress + delta);
    const t = easeInOutCubic(this.progress);
    lerpVec3InPlace(cameraPos, this.cameraTarget, t * FOCUS_CAMERA_LERP);

    if (controlsTarget && planetPos) {
      lerpVec3InPlace(controlsTarget, planetPos, FOCUS_CONTROLS_LERP);
    }

    if (this.progress >= 1) {
      this.cameraTarget = null;
    }
    return true;
  }
}
