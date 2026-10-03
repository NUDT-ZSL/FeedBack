/**
 * 太阳系运动与聚焦的纯逻辑模块。
 *
 * 不依赖 three.js / DOM / 帧率，可在 Node.js 中离线确定性地复现：
 *  - 行星轨道角度累积（含速度倍率）
 *  - 聚焦进度推进与相机位置插值
 *  - 聚焦目标切换时的状态替换
 *
 * 渲染层（solarSystem.ts / main.ts）与离线验证（verify/）共用本模块，
 * 保证验证覆盖的就是线上真实代码路径。
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 行星公转角度累积系数：angle += orbitSpeed * delta * ORBIT_ANGLE_FACTOR * speedMultiplier */
export const ORBIT_ANGLE_FACTOR = 0.1;

/** 聚焦插值系数：每帧 camera.position 向目标点靠近的比例（乘以缓动值） */
export const FOCUS_LERP_FACTOR = 0.05;

/** 聚焦进度推进速率：progress += delta * FOCUS_PROGRESS_RATE，1 秒完成 */
export const FOCUS_PROGRESS_RATE = 1;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 单帧公转角度增量 */
export function orbitAngleDelta(orbitSpeed: number, delta: number, speedMultiplier: number): number {
  return orbitSpeed * delta * ORBIT_ANGLE_FACTOR * speedMultiplier;
}

/** 单帧自转角度增量 */
export function rotationAngleDelta(rotationSpeed: number, delta: number, speedMultiplier: number): number {
  return rotationSpeed * delta * speedMultiplier;
}

/** 由公转角度与轨道半径计算行星在轨道平面上的位置（y 恒为 0） */
export function orbitalPosition(angle: number, distance: number): Vec3Like {
  return {
    x: Math.cos(angle) * distance,
    y: 0,
    z: Math.sin(angle) * distance
  };
}

/** position = position + (target - position) * t，原地修改 */
export function lerpVec3(position: Vec3Like, target: Vec3Like, t: number): void {
  position.x += (target.x - position.x) * t;
  position.y += (target.y - position.y) * t;
  position.z += (target.z - position.z) * t;
}

export function distanceBetween(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 聚焦状态。切换聚焦目标时必须通过 startFocus 整体替换，
 * 保证旧目标与旧进度被彻底丢弃而非叠加。
 */
export interface FocusState {
  /** 相机聚焦目标点；null 表示当前无聚焦 */
  target: Vec3Like | null;
  /** 聚焦进度 [0, 1]，到达 1 后停止更新 */
  progress: number;
  /** 当前聚焦的行星英文名；空串表示无 */
  planetName: string;
}

export function createFocusState(): FocusState {
  return { target: null, progress: 0, planetName: '' };
}

/** 开始聚焦新目标：目标点与行星名整体替换，进度归零 */
export function startFocus(state: FocusState, target: Vec3Like, planetName: string): void {
  state.target = target;
  state.progress = 0;
  state.planetName = planetName;
}

/** 聚焦完成（或主动取消）后清空目标，后续帧不再更新相机 */
export function clearFocus(state: FocusState): void {
  state.target = null;
}

export function isFocusActive(state: FocusState): boolean {
  return state.target !== null && state.progress < 1;
}

/**
 * 推进一帧聚焦：进度按 delta 累积并钳制到 1，
 * 相机位置按缓动后的比例向目标点插值。
 * 返回本帧是否更新了相机位置。
 */
export function advanceFocus(state: FocusState, delta: number, cameraPosition: Vec3Like): boolean {
  if (!isFocusActive(state)) {
    return false;
  }
  state.progress = Math.min(1, state.progress + delta * FOCUS_PROGRESS_RATE);
  const t = easeInOutCubic(state.progress);
  lerpVec3(cameraPosition, state.target as Vec3Like, t * FOCUS_LERP_FACTOR);
  return true;
}
