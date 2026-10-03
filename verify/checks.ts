/**
 * 运动与聚焦链路的各项行为验证。
 * 每个检查返回结构化结果：是否通过 + 关键中间量 + 失败断言。
 */

import { createHarness } from './harness';
import {
  ORBIT_SPEED_SCALE,
  distanceVec3,
  cloneVec3,
  type Vec3Like
} from '../src/motionCore';

export interface CheckResult {
  id: string;
  title: string;
  passed: boolean;
  /** 关键中间量（无论通过与否都会输出，便于定位问题）。 */
  details: string[];
  /** 未通过的断言描述。 */
  failures: string[];
}

const DELTA = 1 / 60;
const ANGLE_TOL = 1e-9;
const POS_TOL = 1e-12;

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toPrecision(12) : String(n);
}

function expectedAngle(orbitSpeed: number, speed: number, frames: number, delta: number = DELTA): number {
  return orbitSpeed * ORBIT_SPEED_SCALE * speed * delta * frames;
}

/** 检查 1：连续多帧推进后，各行星角度与速度倍率严格对应。 */
export function checkOrbitAccumulation(): CheckResult {
  const failures: string[] = [];
  const details: string[] = [];
  const h = createHarness();

  const FRAMES = 120;
  const SPEED = 2.0;
  h.stepFrames(FRAMES, DELTA, SPEED, true);

  let maxAngleDev = 0;
  let maxPosDev = 0;
  for (const p of h.system.planets) {
    const expected = expectedAngle(p.data.orbitSpeed, SPEED, FRAMES);
    const angleDev = Math.abs(p.angle - expected);
    maxAngleDev = Math.max(maxAngleDev, angleDev);
    if (angleDev > ANGLE_TOL) {
      failures.push(`${p.data.name}: 角度 ${fmt(p.angle)} 偏离期望 ${fmt(expected)}（偏差 ${angleDev.toExponential(2)}）`);
    }
    const px = Math.cos(p.angle) * p.data.distance;
    const pz = Math.sin(p.angle) * p.data.distance;
    const posDev = Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz);
    maxPosDev = Math.max(maxPosDev, posDev);
    if (posDev > POS_TOL) {
      failures.push(`${p.data.name}: 位置与角度不一致（偏差 ${posDev.toExponential(2)}）`);
    }
  }

  const mercury = h.planetByName('Mercury');
  const earth = h.planetByName('Earth');
  const ratio = mercury.angle / earth.angle;
  const ratioDev = Math.abs(ratio - mercury.data.orbitSpeed / earth.data.orbitSpeed);
  if (ratioDev > 1e-9) {
    failures.push(`水星/地球角度比 ${fmt(ratio)} 与速度比不符（偏差 ${ratioDev.toExponential(2)}）`);
  }

  details.push(`推进 ${FRAMES} 帧 @ delta=${fmt(DELTA)}, 速度倍率=${SPEED}`);
  details.push(`水星角度=${fmt(mercury.angle)} 期望=${fmt(expectedAngle(mercury.data.orbitSpeed, SPEED, FRAMES))}`);
  details.push(`地球角度=${fmt(earth.angle)} 海王星角度=${fmt(h.planetByName('Neptune').angle)}`);
  details.push(`全行星最大角度偏差=${maxAngleDev.toExponential(2)} 最大位置偏差=${maxPosDev.toExponential(2)}`);
  details.push(`水星/地球角度比=${fmt(ratio)}（速度比 ${mercury.data.orbitSpeed / earth.data.orbitSpeed}）`);

  return { id: 'orbit-accumulation', title: '连续推进：角度与速度倍率对应', passed: failures.length === 0, details, failures };
}

/** 检查 2：速度倍率变化后，角度按新倍率累积，不跳变、不重置。 */
export function checkSpeedChangeContinuity(): CheckResult {
  const failures: string[] = [];
  const details: string[] = [];
  const h = createHarness();

  const SPEED_A = 1.0;
  const SPEED_B = 3.5;
  const FRAMES_A = 60;
  const FRAMES_B = 60;

  h.stepFrames(FRAMES_A, DELTA, SPEED_A, true);
  const anglesBeforeSwitch = new Map(h.system.planets.map(p => [p.data.name, p.angle]));

  // 切换倍率后的第一帧：增量必须恰好等于新倍率下的单帧增量。
  h.step(DELTA, SPEED_B, true);
  let maxStepDev = 0;
  for (const p of h.system.planets) {
    const before = anglesBeforeSwitch.get(p.data.name)!;
    const increment = p.angle - before;
    const expectedIncrement = p.data.orbitSpeed * ORBIT_SPEED_SCALE * SPEED_B * DELTA;
    const dev = Math.abs(increment - expectedIncrement);
    maxStepDev = Math.max(maxStepDev, dev);
    if (dev > 1e-12) {
      failures.push(`${p.data.name}: 切速后单帧增量 ${fmt(increment)} ≠ 期望 ${fmt(expectedIncrement)}`);
    }
    if (!(p.angle > before)) {
      failures.push(`${p.data.name}: 切速后角度未继续累积（${fmt(before)} → ${fmt(p.angle)}）`);
    }
  }

  h.stepFrames(FRAMES_B - 1, DELTA, SPEED_B, true);
  let maxTotalDev = 0;
  for (const p of h.system.planets) {
    const expected = expectedAngle(p.data.orbitSpeed, SPEED_A, FRAMES_A)
      + expectedAngle(p.data.orbitSpeed, SPEED_B, FRAMES_B);
    const dev = Math.abs(p.angle - expected);
    maxTotalDev = Math.max(maxTotalDev, dev);
    if (dev > ANGLE_TOL) {
      failures.push(`${p.data.name}: 分段累积总量 ${fmt(p.angle)} 偏离期望 ${fmt(expected)}`);
    }
  }

  const earth = h.planetByName('Earth');
  details.push(`前 ${FRAMES_A} 帧 @ ${SPEED_A}x，随后 ${FRAMES_B} 帧 @ ${SPEED_B}x`);
  details.push(`地球：切速前角度=${fmt(anglesBeforeSwitch.get('Earth')!)} 切速后=${fmt(earth.angle)}`);
  details.push(`切速首帧增量最大偏差=${maxStepDev.toExponential(2)} 分段累积最大偏差=${maxTotalDev.toExponential(2)}`);

  return { id: 'speed-change-continuity', title: '速度倍率变化：按新倍率累积且无跳变', passed: failures.length === 0, details, failures };
}

/** 检查 3：聚焦时相机单调收敛至目标，完成后停止更新。 */
export function checkFocusConvergence(): CheckResult {
  const failures: string[] = [];
  const details: string[] = [];
  const h = createHarness();

  if (!h.triggerFocus('Mars')) {
    failures.push('无法触发对 Mars 的聚焦');
    return { id: 'focus-convergence', title: '聚焦：单调收敛并完成后停更', passed: false, details, failures };
  }
  const staticTarget = cloneVec3(h.focus.cameraTarget!);
  const mars = h.planetByName('Mars');

  const cameraDists: number[] = [distanceVec3(h.camera.position, staticTarget)];
  let controlsDistAtCompletion = Infinity;
  let framesToComplete = 0;
  let prevControlsDist = distanceVec3(h.controlsTarget, mars.mesh.position);
  let controlsMonotone = true;

  while (h.focus.isActive && framesToComplete < 300) {
    h.step(DELTA, 1.0, true);
    framesToComplete++;
    cameraDists.push(distanceVec3(h.camera.position, staticTarget));
    const cd = distanceVec3(h.controlsTarget, mars.mesh.position);
    // 目标行星在缓慢移动，只在距离足够大时要求严格单调。
    if (prevControlsDist > 0.5 && cd > prevControlsDist) {
      controlsMonotone = false;
      failures.push(`第 ${framesToComplete} 帧：控制器目标点距离回升 ${fmt(prevControlsDist)} → ${fmt(cd)}`);
    }
    prevControlsDist = cd;
  }
  controlsDistAtCompletion = prevControlsDist;

  for (let i = 1; i < cameraDists.length; i++) {
    if (!(cameraDists[i] < cameraDists[i - 1])) {
      failures.push(`第 ${i} 帧：相机距离未严格下降 ${fmt(cameraDists[i - 1])} → ${fmt(cameraDists[i])}`);
      break;
    }
  }

  if (!controlsMonotone) { /* 已在上面记录 */ }
  if (framesToComplete < 55 || framesToComplete > 65) {
    failures.push(`聚焦完成帧数 ${framesToComplete} 异常（delta=${fmt(DELTA)} 时应在 60 附近）`);
  }
  if (controlsDistAtCompletion >= 0.5) {
    failures.push(`完成时控制器目标点距行星 ${fmt(controlsDistAtCompletion)}，未收敛到 0.5 以内`);
  }
  if (h.focus.progress !== 1 || h.focus.cameraTarget !== null) {
    failures.push(`完成后状态未清理：progress=${h.focus.progress} cameraTarget=${h.focus.cameraTarget}`);
  }

  // 完成后再推进 30 帧：相机与控制器目标点必须完全静止。
  const camAfter: Vec3Like = cloneVec3(h.camera.position);
  const controlsAfter: Vec3Like = cloneVec3(h.controlsTarget);
  h.stepFrames(30, DELTA, 1.0, true);
  const camDrift = distanceVec3(h.camera.position, camAfter);
  const controlsDrift = distanceVec3(h.controlsTarget, controlsAfter);
  if (camDrift !== 0 || controlsDrift !== 0) {
    failures.push(`聚焦完成后仍在更新：相机漂移=${camDrift.toExponential(2)} 目标点漂移=${controlsDrift.toExponential(2)}`);
  }

  details.push(`目标=Mars 静态相机目标点=(${fmt(staticTarget.x)}, ${fmt(staticTarget.y)}, ${fmt(staticTarget.z)})`);
  details.push(`完成所需帧数=${framesToComplete} 相机距离: ${fmt(cameraDists[0])} → ${fmt(cameraDists[cameraDists.length - 1])}`);
  details.push(`完成时控制器目标点距火星=${fmt(controlsDistAtCompletion)}`);
  details.push(`完成后 30 帧漂移：相机=${camDrift} 目标点=${controlsDrift}`);

  return { id: 'focus-convergence', title: '聚焦：单调收敛并完成后停更', passed: failures.length === 0, details, failures };
}

/** 检查 4：聚焦未完成时切换目标，旧进度与旧目标被彻底替换。 */
export function checkFocusSwitchReset(): CheckResult {
  const failures: string[] = [];
  const details: string[] = [];
  const h = createHarness();

  h.triggerFocus('Venus');
  h.stepFrames(30, DELTA, 1.0, true);
  const progressBeforeSwitch = h.focus.progress;
  const venusTarget = cloneVec3(h.focus.cameraTarget!);
  if (!(progressBeforeSwitch > 0 && progressBeforeSwitch < 1)) {
    failures.push(`切换前聚焦进度 ${fmt(progressBeforeSwitch)} 不在 (0,1) 区间，前置条件不成立`);
  }

  h.triggerFocus('Jupiter');
  const jupiter = h.planetByName('Jupiter');
  const venus = h.planetByName('Venus');
  const progressAfterSwitch = h.focus.progress;

  if (h.focus.progress !== 0) {
    failures.push(`切换后进度未重置：progress=${fmt(h.focus.progress)}`);
  }
  if (h.focus.planetName !== 'Jupiter') {
    failures.push(`切换后目标行星名未替换：${h.focus.planetName}`);
  }
  if (!h.focus.cameraTarget) {
    failures.push('切换后相机目标点为空');
  } else {
    const leftover = distanceVec3(h.focus.cameraTarget, venusTarget);
    if (leftover < 1) {
      failures.push(`切换后相机目标点仍残留旧目标（与金星目标距离 ${fmt(leftover)}）`);
    }
  }
  const newTarget = cloneVec3(h.focus.cameraTarget!);
  const distAtSwitch = distanceVec3(h.camera.position, newTarget);

  // 切换到完成：相机必须单调收敛到新目标。
  let frames = 0;
  let prevDist = distAtSwitch;
  while (h.focus.isActive && frames < 300) {
    h.step(DELTA, 1.0, true);
    frames++;
    const d = distanceVec3(h.camera.position, newTarget);
    if (!(d < prevDist)) {
      failures.push(`切换后第 ${frames} 帧：相机未向新目标单调收敛 ${fmt(prevDist)} → ${fmt(d)}`);
      break;
    }
    prevDist = d;
  }

  const finalControlsToJupiter = distanceVec3(h.controlsTarget, jupiter.mesh.position);
  const finalControlsToVenus = distanceVec3(h.controlsTarget, venus.mesh.position);
  if (finalControlsToJupiter >= 0.5) {
    failures.push(`控制器目标点未收敛到木星（距离 ${fmt(finalControlsToJupiter)}）`);
  }
  if (finalControlsToVenus < 1) {
    failures.push(`控制器目标点仍停留在金星附近（距离 ${fmt(finalControlsToVenus)}），疑似旧进度叠加`);
  }

  details.push(`切换前进度=${fmt(progressBeforeSwitch)} 切换瞬间进度=${fmt(progressAfterSwitch)}`);
  details.push(`新旧相机目标点间距=${fmt(distanceVec3(newTarget, venusTarget))}`);
  details.push(`切换后相机距离: ${fmt(distAtSwitch)} → ${fmt(prevDist)}（${frames} 帧收敛）`);
  details.push(`最终控制器目标点：距木星=${fmt(finalControlsToJupiter)} 距金星=${fmt(finalControlsToVenus)}`);

  return { id: 'focus-switch-reset', title: '聚焦切换：旧进度与目标彻底替换', passed: failures.length === 0, details, failures };
}

/** 检查 5：轨道环显隐切换不影响行星位置与角度。 */
export function checkOrbitToggleIsolation(): CheckResult {
  const failures: string[] = [];
  const details: string[] = [];
  const h = createHarness();

  const SPEED = 1.5;
  h.stepFrames(30, DELTA, SPEED, true);
  const visibleWhenOn = h.system.planets.every(p => p.orbit.visible === true);
  if (!visibleWhenOn) {
    failures.push('showOrbits=true 时存在不可见的轨道环');
  }

  // 关闭显隐的第一帧：角度增量必须与显隐无关、严格按公式推进。
  const anglesBefore = new Map(h.system.planets.map(p => [p.data.name, p.angle]));
  h.step(DELTA, SPEED, false);
  const visibleWhenOff = h.system.planets.every(p => p.orbit.visible === false);
  if (!visibleWhenOff) {
    failures.push('showOrbits=false 时仍存在可见的轨道环');
  }
  let maxToggleStepDev = 0;
  for (const p of h.system.planets) {
    const increment = p.angle - anglesBefore.get(p.data.name)!;
    const expected = p.data.orbitSpeed * ORBIT_SPEED_SCALE * SPEED * DELTA;
    const dev = Math.abs(increment - expected);
    maxToggleStepDev = Math.max(maxToggleStepDev, dev);
    if (dev > 1e-12) {
      failures.push(`${p.data.name}: 关闭轨道环当帧角度增量异常（${fmt(increment)} ≠ ${fmt(expected)}）`);
    }
    const px = Math.cos(p.angle) * p.data.distance;
    const pz = Math.sin(p.angle) * p.data.distance;
    if (Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz) > POS_TOL) {
      failures.push(`${p.data.name}: 关闭轨道环后位置与角度不一致`);
    }
  }

  // 隐藏状态下继续推进，再切回显示：总量仍须严格等于公式值。
  h.stepFrames(60, DELTA, SPEED, false);
  h.step(DELTA, SPEED, true);
  const visibleAgain = h.system.planets.every(p => p.orbit.visible === true);
  if (!visibleAgain) {
    failures.push('重新开启 showOrbits 后轨道环未恢复可见');
  }
  const TOTAL_FRAMES = 30 + 1 + 60 + 1;
  let maxTotalDev = 0;
  for (const p of h.system.planets) {
    const expected = expectedAngle(p.data.orbitSpeed, SPEED, TOTAL_FRAMES);
    const dev = Math.abs(p.angle - expected);
    maxTotalDev = Math.max(maxTotalDev, dev);
    if (dev > ANGLE_TOL) {
      failures.push(`${p.data.name}: 显隐切换全程角度 ${fmt(p.angle)} 偏离期望 ${fmt(expected)}`);
    }
  }

  details.push(`显隐序列: 开(30帧) → 关(61帧) → 开(1帧)，速度倍率=${SPEED}`);
  details.push(`可见性: 开=${visibleWhenOn} 关=${visibleWhenOff} 重开=${visibleAgain}`);
  details.push(`切换当帧角度增量最大偏差=${maxToggleStepDev.toExponential(2)} 全程最大角度偏差=${maxTotalDev.toExponential(2)}`);

  return { id: 'orbit-toggle-isolation', title: '轨道环显隐：不影响行星位置与角度', passed: failures.length === 0, details, failures };
}

export const ALL_CHECKS = [
  checkOrbitAccumulation,
  checkSpeedChangeContinuity,
  checkFocusConvergence,
  checkFocusSwitchReset,
  checkOrbitToggleIsolation
];
