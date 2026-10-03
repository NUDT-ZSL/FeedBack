#!/usr/bin/env node
/**
 * 太阳系运动与聚焦链路离线验证套件。
 *
 * 运行入口：npm run verify
 *
 * 全部用例在 Node.js 中以固定 delta 确定性推进，不依赖浏览器渲染、
 * 真实帧率或 GPU。行星/相机等场景对象使用确定性桩替身，
 * 被验证的轨道推进与聚焦逻辑与线上帧循环共用同一份代码
 * （src/simulation.ts + src/solarSystem.ts 的 updateSolarSystem）。
 */

// updateSolarSystem 内部会读取 window.innerWidth/innerHeight 做标签投影，
// 无浏览器环境下注入桩替身（仅影响标签坐标，不影响被验证的运动逻辑）。
globalThis.window = { innerWidth: 1920, innerHeight: 1080 };

const THREE = await import('three');
const { updateSolarSystem, PLANET_DATA } = await import('../.verify-build/solarSystem.js');
const sim = await import('../.verify-build/simulation.js');

const DELTA = 1 / 60; // 固定帧步长，复现 60fps 逻辑帧
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 桩替身：确定性构造一个最小 SolarSystem，不触碰 document / 随机数
// ---------------------------------------------------------------------------
function createStubSystem() {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 30, 80);
  camera.updateMatrixWorld();

  const planets = PLANET_DATA.map((data, index) => {
    const angle = (index + 1) * 0.7; // 确定性初始角度，替代线上的 Math.random()
    const mesh = new THREE.Mesh();
    const pos = sim.orbitalPosition(angle, data.distance);
    mesh.position.set(pos.x, pos.y, pos.z);
    return {
      mesh,
      data,
      orbit: { visible: true },
      angle,
      label: { style: {}, classList: { toggle() {} } },
      glow: { scale: { set() {} } }
    };
  });

  const particleCount = 8;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(particleCount), 1));

  const system = {
    sun: new THREE.Mesh(),
    sunGlow: { scale: { set() {} } },
    sunLight: {},
    planets,
    particles: new THREE.Points(geometry),
    group: new THREE.Group()
  };
  return { system, camera };
}

function runFrames(system, camera, focus, frames, speed, showOrbits) {
  for (let i = 0; i < frames; i++) {
    updateSolarSystem(system, DELTA, speed, camera, showOrbits, focus);
  }
}

// ---------------------------------------------------------------------------
// T1：连续多帧推进后，各行星角度增量 == orbitSpeed * delta * 0.1 * 倍率 * 帧数，
//     行星间角度增量比 == orbitSpeed 之比，位置与角度自洽
// ---------------------------------------------------------------------------
function testAngleAccumulation() {
  const { system, camera } = createStubSystem();
  const focus = sim.createFocusState();
  const speed = 2.5;
  const frames = 120;
  const initial = system.planets.map(p => p.angle);

  runFrames(system, camera, focus, frames, speed, true);

  let maxAngleErr = 0;
  let maxPosErr = 0;
  let maxRatioErr = 0;
  const rows = [];
  const earthInc = system.planets[2].angle - initial[2]; // Earth 的 orbitSpeed = 1.0

  system.planets.forEach((p, i) => {
    const inc = p.angle - initial[i];
    const expectedInc = p.data.orbitSpeed * DELTA * sim.ORBIT_ANGLE_FACTOR * speed * frames;
    maxAngleErr = Math.max(maxAngleErr, Math.abs(inc - expectedInc));

    const pos = sim.orbitalPosition(p.angle, p.data.distance);
    maxPosErr = Math.max(maxPosErr,
      Math.hypot(p.mesh.position.x - pos.x, p.mesh.position.z - pos.z));

    const ratioErr = Math.abs(inc / earthInc - p.data.orbitSpeed);
    maxRatioErr = Math.max(maxRatioErr, ratioErr);

    rows.push(`       ${p.data.name.padEnd(8)} orbitSpeed=${String(p.data.orbitSpeed).padEnd(5)} `
      + `Δangle=${inc.toFixed(6)} 期望=${expectedInc.toFixed(6)}`);
  });

  const passed = maxAngleErr < EPS && maxPosErr < EPS && maxRatioErr < EPS;
  return {
    name: 'T1 角度累积与速度倍率一致（连续推进）',
    passed,
    detail: [
      `       帧数=${frames} delta=${DELTA.toFixed(6)} 倍率=${speed}x`,
      ...rows,
      `       最大角度误差=${maxAngleErr.toExponential(2)} 最大位置偏差=${maxPosErr.toExponential(2)} `
      + `行星间增量比最大误差=${maxRatioErr.toExponential(2)}`
    ]
  };
}

// ---------------------------------------------------------------------------
// T2：速度倍率由 1.0x 切换为 4.0x 后，角度按新倍率继续累积，不发生跳变
// ---------------------------------------------------------------------------
function testSpeedMultiplierChange() {
  const { system, camera } = createStubSystem();
  const focus = sim.createFocusState();

  runFrames(system, camera, focus, 60, 1.0, true);
  const mid = system.planets.map(p => p.angle);

  // 切换倍率后的第一帧：角度必须连续（旧角度 + 新倍率单帧增量）
  runFrames(system, camera, focus, 1, 4.0, true);
  let maxJumpErr = 0;
  system.planets.forEach((p, i) => {
    const expected = mid[i] + sim.orbitAngleDelta(p.data.orbitSpeed, DELTA, 4.0);
    maxJumpErr = Math.max(maxJumpErr, Math.abs(p.angle - expected));
  });

  runFrames(system, camera, focus, 59, 4.0, true);

  let maxPhaseErr = 0;
  let maxRatioErr = 0;
  const rows = [];
  system.planets.forEach((p, i) => {
    const phase1 = mid[i] - ((i + 1) * 0.7);
    const phase2 = p.angle - mid[i];
    const expected1 = p.data.orbitSpeed * DELTA * sim.ORBIT_ANGLE_FACTOR * 1.0 * 60;
    const expected2 = p.data.orbitSpeed * DELTA * sim.ORBIT_ANGLE_FACTOR * 4.0 * 60;
    maxPhaseErr = Math.max(maxPhaseErr, Math.abs(phase1 - expected1), Math.abs(phase2 - expected2));
    maxRatioErr = Math.max(maxRatioErr, Math.abs(phase2 / phase1 - 4.0));
    rows.push(`       ${p.data.name.padEnd(8)} 阶段1增量=${phase1.toFixed(6)} 阶段2增量=${phase2.toFixed(6)} `
      + `比值=${(phase2 / phase1).toFixed(6)}（期望 4.0）`);
  });

  const passed = maxJumpErr < EPS && maxPhaseErr < EPS && maxRatioErr < EPS;
  return {
    name: 'T2 速度倍率切换后按新倍率累积（无跳变）',
    passed,
    detail: [
      '       阶段1：1.0x × 60帧 → 切换 → 阶段2：4.0x × 60帧',
      ...rows,
      `       切换瞬间跳变误差=${maxJumpErr.toExponential(2)} 两阶段增量误差=${maxPhaseErr.toExponential(2)} `
      + `倍率比误差=${maxRatioErr.toExponential(2)}`
    ]
  };
}

// ---------------------------------------------------------------------------
// T3：聚焦过程中相机目标点单调收敛至目标行星位置，完成后停止更新
// ---------------------------------------------------------------------------
function testFocusConvergence() {
  const cameraPos = { x: 0, y: 30, z: 80 }; // 纯对象桩替身，不依赖 three
  const target = { x: 16, y: 0, z: 0 };     // 地球轨道位置
  const focus = sim.createFocusState();
  sim.startFocus(focus, target, 'Earth');

  const d0 = sim.distanceBetween(cameraPos, target);
  const distances = [d0];
  let framesToComplete = -1;
  let updatesAfterComplete = 0;

  for (let i = 0; i < 200; i++) {
    const wasComplete = focus.progress >= 1;
    const updated = sim.advanceFocus(focus, DELTA, cameraPos);
    if (wasComplete && updated) updatesAfterComplete++;
    if (updated) distances.push(sim.distanceBetween(cameraPos, target));
    if (framesToComplete < 0 && focus.progress >= 1) framesToComplete = i + 1;
    if (focus.progress >= 1) sim.clearFocus(focus); // 与 main.ts 帧循环的收尾一致
  }

  let maxIncrease = 0;
  for (let i = 0; i < distances.length - 1; i++) {
    maxIncrease = Math.max(maxIncrease, distances[i + 1] - distances[i]);
  }
  const dEnd = distances[distances.length - 1];

  const passed =
    framesToComplete === 60 &&
    maxIncrease <= 1e-12 &&
    dEnd < d0 &&
    updatesAfterComplete === 0 &&
    focus.target === null;

  return {
    name: 'T3 聚焦相机单调收敛并在完成后停止',
    passed,
    detail: [
      `       初始距离=${d0.toFixed(6)} 收敛后距离=${dEnd.toFixed(6)} `
      + `（剩余比例=${(dEnd / d0).toFixed(4)}，渐近插值的固有残差）`,
      `       单调性：最大单帧回退=${maxIncrease.toExponential(2)}（须 ≤ 0）`,
      `       完成帧数=${framesToComplete}（期望 60） 完成后相机更新次数=${updatesAfterComplete}（期望 0）`
    ]
  };
}

// ---------------------------------------------------------------------------
// T4：聚焦未完成时切换目标行星，旧进度与旧目标被彻底替换而非叠加
// ---------------------------------------------------------------------------
function testFocusSwitchReplacesState() {
  const cameraPos = { x: 0, y: 30, z: 80 };
  const targetA = { x: 8, y: 0, z: 0 };    // 水星
  const targetB = { x: -30, y: 0, z: 0 };  // 木星
  const focus = sim.createFocusState();

  sim.startFocus(focus, targetA, 'Mercury');
  for (let i = 0; i < 20; i++) sim.advanceFocus(focus, DELTA, cameraPos);
  const progressBeforeSwitch = focus.progress;

  // 聚焦进行到 1/3 时切换目标
  sim.startFocus(focus, targetB, 'Jupiter');
  const targetWasB = focus.target === targetB;
  const stateReplaced =
    focus.progress === 0 &&
    targetWasB &&
    focus.planetName === 'Jupiter';

  // 切换后向新目标推进：距离必须逐帧单调下降，且需要完整 60 帧才完成
  // （若旧进度被叠加保留，只需 40 帧即完成）
  const distToB = [sim.distanceBetween(cameraPos, targetB)];
  let framesToComplete = -1;
  for (let i = 0; i < 200; i++) {
    const updated = sim.advanceFocus(focus, DELTA, cameraPos);
    if (updated) distToB.push(sim.distanceBetween(cameraPos, targetB));
    if (framesToComplete < 0 && focus.progress >= 1) framesToComplete = i + 1;
    if (focus.progress >= 1) sim.clearFocus(focus);
  }

  let maxIncrease = 0;
  for (let i = 0; i < distToB.length - 1; i++) {
    maxIncrease = Math.max(maxIncrease, distToB[i + 1] - distToB[i]);
  }

  const passed =
    stateReplaced &&
    framesToComplete === 60 &&
    maxIncrease <= 1e-12 &&
    focus.target === null;

  return {
    name: 'T4 聚焦中途切换目标，旧进度/旧目标彻底替换',
    passed,
    detail: [
      `       切换时旧进度=${progressBeforeSwitch.toFixed(4)}（20/60 帧）`,
      `       切换瞬间：progress=0 且 target===新目标(${targetWasB}) `
      + `planetName='${focus.planetName}'`,
      `       切换后完成帧数=${framesToComplete}（期望 60；若为 40 说明旧进度被叠加）`,
      `       向新目标距离单调性：最大单帧回退=${maxIncrease.toExponential(2)}（须 ≤ 0）`
    ]
  };
}

// ---------------------------------------------------------------------------
// T5：轨道环显隐切换不影响行星角度与位置（与常显参照系统逐帧一致）
// ---------------------------------------------------------------------------
function testOrbitToggleDoesNotAffectMotion() {
  const toggled = createStubSystem();
  const reference = createStubSystem();
  const focusT = sim.createFocusState();
  const focusR = sim.createFocusState();
  const speed = 1.5;
  const frames = 90;

  let visibilityErrors = 0;
  for (let i = 0; i < frames; i++) {
    const show = Math.floor(i / 10) % 2 === 0; // 每 10 帧翻转一次显隐
    updateSolarSystem(toggled.system, DELTA, speed, toggled.camera, show, focusT);
    updateSolarSystem(reference.system, DELTA, speed, reference.camera, true, focusR);
    toggled.system.planets.forEach(p => {
      if (p.orbit.visible !== show) visibilityErrors++;
    });
  }

  let maxAngleDiff = 0;
  let maxPosDiff = 0;
  toggled.system.planets.forEach((p, i) => {
    const ref = reference.system.planets[i];
    maxAngleDiff = Math.max(maxAngleDiff, Math.abs(p.angle - ref.angle));
    maxPosDiff = Math.max(maxPosDiff,
      Math.hypot(p.mesh.position.x - ref.mesh.position.x, p.mesh.position.z - ref.mesh.position.z));
  });

  const passed = maxAngleDiff === 0 && maxPosDiff === 0 && visibilityErrors === 0;
  return {
    name: 'T5 轨道环显隐切换不影响行星位置与角度',
    passed,
    detail: [
      `       帧数=${frames}（每 10 帧翻转显隐） 倍率=${speed}x`,
      `       与常显参照系统对比：最大角度差=${maxAngleDiff} 最大位置差=${maxPosDiff}`,
      `       orbit.visible 与实际显隐标志不一致次数=${visibilityErrors}`
    ]
  };
}

// ---------------------------------------------------------------------------
// 统一批量运行入口
// ---------------------------------------------------------------------------
const tests = [
  testAngleAccumulation,
  testSpeedMultiplierChange,
  testFocusConvergence,
  testFocusSwitchReplacesState,
  testOrbitToggleDoesNotAffectMotion
];

console.log('太阳系运动与聚焦链路离线验证');
console.log(`固定帧步长 delta=${DELTA.toFixed(6)}s（60fps 逻辑帧），全部用例确定性可复现\n`);

let passCount = 0;
for (const test of tests) {
  const result = test();
  if (result.passed) passCount++;
  console.log(`${result.passed ? '[PASS]' : '[FAIL]'} ${result.name}`);
  result.detail.forEach(line => console.log(line));
  console.log('');
}

console.log(`结果：${passCount}/${tests.length} 通过`);
process.exit(passCount === tests.length ? 0 : 1);
