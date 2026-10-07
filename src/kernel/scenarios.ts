import { runBatch } from './batch.ts';
import {
  BEAM_DURATION_MS,
  ERROR_DURATION_MS,
  ROTATION_SPEED,
  SECTOR_COUNT,
  SECTOR_DEGREES,
  computeBeamPosition,
  resolveTrigramPosition,
  type KernelEvent,
  type KernelState,
} from './divinationKernel.ts';

export interface ScenarioReport {
  name: string;
  description: string;
  failures: string[];
}

interface Scenario {
  name: string;
  description: string;
  run(): string[];
}

/** 卦位 p 的中心方向（x 向右，y 向上），可附加缩放验证长度无关性 */
function directionOf(position: number, scale = 1): [number, number] {
  const angle = ((position * SECTOR_DEGREES - 90) * Math.PI) / 180;
  return [Math.cos(angle) * scale, Math.sin(angle) * scale];
}

function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function vecApproxEqual(a: number[], b: number[], eps = 1e-9): boolean {
  return a.length === b.length && a.every((v, i) => approxEqual(v, b[i], eps));
}

function stateEquals(a: KernelState, b: KernelState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function wrapDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

const scenarios: Scenario[] = [
  {
    name: 'hit-beam-lifecycle',
    description: '符咒命中期望卦位：触发对应位置光柱，并在有限时长后自行消失',
    run() {
      const failures: string[] = [];
      const report = runBatch([
        { type: 'talismanDragStart', at: 1000, talisman: '乾' },
        { type: 'baguaDragOver', at: 1050 },
        { type: 'baguaDrop', at: 1100, talisman: '乾', direction: directionOf(0) },
        { type: 'advanceTo', at: 1100 + BEAM_DURATION_MS - 1 },
        { type: 'advanceTo', at: 1100 + BEAM_DURATION_MS },
      ]);
      const [result] = report.results;
      if (report.results.length !== 1) failures.push(`期望 1 条推演结果，实际 ${report.results.length}`);
      if (!result?.matched) failures.push('乾 落于 0 号方向应判定为命中');
      if (result?.position !== 0 || result?.expectedPosition !== 0) {
        failures.push(`卦位判定错误：position=${result?.position} expected=${result?.expectedPosition}`);
      }
      if (!result?.beam || !vecApproxEqual(result.beam.position, computeBeamPosition(0))) {
        failures.push(`光柱落点错误：${JSON.stringify(result?.beam?.position)}`);
      }
      const afterDrop = report.steps[2].state;
      if (!afterDrop.lightBeam?.visible) failures.push('命中后光柱应立即可见');
      if (afterDrop.draggedTalisman !== null) failures.push('落点后拖拽会话应结束');
      if (afterDrop.isDragOverBagua) failures.push('落点后悬停态应复位');
      if (!report.steps[3].state.lightBeam) failures.push('光柱在到期前不得提前消失');
      if (report.finalState.lightBeam !== null) failures.push('光柱到期后应自行消失');
      if (report.finalState.baguaError) failures.push('命中流程不应产生错误标志');
      return failures;
    },
  },
  {
    name: 'miss-error-lifecycle',
    description: '符咒未命中：给出短暂错误提示并自动复位，不产生光柱',
    run() {
      const failures: string[] = [];
      const report = runBatch([
        { type: 'talismanDragStart', at: 0, talisman: '乾' },
        { type: 'baguaDrop', at: 100, talisman: '乾', direction: directionOf(3) },
        { type: 'advanceTo', at: 100 + ERROR_DURATION_MS - 1 },
        { type: 'advanceTo', at: 100 + ERROR_DURATION_MS },
      ]);
      const [result] = report.results;
      if (result?.matched !== false) failures.push('乾 落于 3 号方向应判定为未命中');
      const afterDrop = report.steps[1].state;
      if (!afterDrop.baguaError) failures.push('未命中后应立即置位错误标志');
      if (afterDrop.lightBeam !== null) failures.push('未命中不应产生光柱');
      if (!report.steps[2].state.baguaError) failures.push('错误提示在到期前不得提前复位');
      if (report.finalState.baguaError) failures.push('错误提示到期后应自动复位');
      if (report.finalState.errorExpiresAt !== null) failures.push('错误复位后到期时间应清空');
      return failures;
    },
  },
  {
    name: 'duplicate-delivery-idempotent',
    description: '同一次拖拽被重复投递：结果与单次干净投递完全一致',
    run() {
      const failures: string[] = [];
      const clean = runBatch([
        { type: 'talismanDragStart', at: 100, talisman: '离' },
        { type: 'baguaDrop', at: 200, talisman: '离', direction: directionOf(2) },
      ]);
      const duplicated = runBatch([
        { type: 'talismanDragStart', at: 100, talisman: '离' },
        { type: 'baguaDrop', at: 200, talisman: '离', direction: directionOf(2) },
        { type: 'baguaDrop', at: 201, talisman: '离', direction: directionOf(2) },
        { type: 'baguaDrop', at: 202, talisman: '离', direction: directionOf(2) },
      ]);
      if (duplicated.results.length !== 1) {
        failures.push(`重复投递应只产生 1 条结果，实际 ${duplicated.results.length}`);
      }
      if (!duplicated.steps[2].ignored || !duplicated.steps[3].ignored) {
        failures.push('重复投递的落点事件应被标记为忽略');
      }
      if (!stateEquals(duplicated.finalState, clean.finalState)) {
        failures.push('重复投递后的最终状态应与单次投递一致');
      }
      if (duplicated.finalState.lightBeam?.beamId !== clean.finalState.lightBeam?.beamId) {
        failures.push('重复投递不应产生新的光柱');
      }
      return failures;
    },
  },
  {
    name: 'mid-drag-talisman-switch',
    description: '拖拽中途切换符咒：陈旧投递被忽略，结果与一次干净投递一致',
    run() {
      const failures: string[] = [];
      const switched = runBatch([
        { type: 'talismanDragStart', at: 100, talisman: '乾' },
        { type: 'talismanDragStart', at: 150, talisman: '坤' },
        { type: 'baguaDrop', at: 200, talisman: '乾', direction: directionOf(0) },
        { type: 'baguaDrop', at: 300, talisman: '坤', direction: directionOf(7) },
      ]);
      const clean = runBatch([
        { type: 'talismanDragStart', at: 50, talisman: '乾' },
        { type: 'talismanDragEnd', at: 60 },
        { type: 'talismanDragStart', at: 100, talisman: '坤' },
        { type: 'baguaDrop', at: 300, talisman: '坤', direction: directionOf(7) },
      ]);
      if (!switched.steps[2].ignored) failures.push('切换后携带旧符咒的投递应被忽略');
      if (switched.steps[2].state.draggedTalisman !== '坤') {
        failures.push('陈旧投递不得打断进行中的新拖拽');
      }
      if (switched.results.length !== 1 || !switched.results[0].matched) {
        failures.push('切换后应只有新符咒的一次命中结果');
      }
      if (switched.results[0]?.position !== 7) failures.push('坤 应命中 7 号卦位');
      if (!stateEquals(switched.finalState, clean.finalState)) {
        failures.push('中途切换后的最终状态应与干净投递一致，不得有残留');
      }
      return failures;
    },
  },
  {
    name: 'direction-boundary-and-scale-invariance',
    description: '方向边界与尺度不变性：卦位只由方向决定，边界处判定确定',
    run() {
      const failures: string[] = [];
      for (let p = 0; p < SECTOR_COUNT; p++) {
        for (const scale of [1e-3, 1, 200, 1e6]) {
          const resolved = resolveTrigramPosition(directionOf(p, scale));
          if (resolved !== p) {
            failures.push(`卦位 ${p} 在缩放 ${scale} 下被判定为 ${resolved}`);
          }
        }
        const center = p * SECTOR_DEGREES - 90;
        const toRad = (deg: number): [number, number] => {
          const rad = (deg * Math.PI) / 180;
          return [Math.cos(rad), Math.sin(rad)];
        };
        const jitter = resolveTrigramPosition(toRad(center + 22.4999));
        if (jitter !== p) failures.push(`卦位 ${p} 边界内抖动不应改变判定，实际 ${jitter}`);

        // 边界：两侧微小偏移确定地归入相邻两侧，边界正上判定确定且可复现
        const boundary = center + SECTOR_DEGREES / 2;
        const below = resolveTrigramPosition(toRad(boundary - 1e-6));
        const above = resolveTrigramPosition(toRad(boundary + 1e-6));
        if (below !== p) failures.push(`卦位 ${p} 边界下侧应归入 ${p}，实际 ${below}`);
        if (above !== (p + 1) % SECTOR_COUNT) {
          failures.push(`卦位 ${p} 边界上侧应归入 ${(p + 1) % SECTOR_COUNT}，实际 ${above}`);
        }
        const exact = resolveTrigramPosition(toRad(boundary));
        if (exact !== p && exact !== (p + 1) % SECTOR_COUNT) {
          failures.push(`卦位 ${p} 边界判定应落在相邻两卦之一，实际 ${exact}`);
        }
        for (let i = 0; i < 16; i++) {
          if (resolveTrigramPosition(toRad(boundary)) !== exact) {
            failures.push(`卦位 ${p} 边界判定不确定（多次求值结果不一致）`);
            break;
          }
        }
      }
      if (resolveTrigramPosition([0, 0]) !== 2) {
        failures.push('零向量的退化判定应为确定值 2');
      }
      return failures;
    },
  },
  {
    name: 'rotation-stacking-with-interleaved-drags',
    description: '连续快速旋转叠加多次拖拽：旋转、拖拽、光柱、错误各自自洽',
    run() {
      const failures: string[] = [];
      const events: KernelEvent[] = [
        { type: 'sphereRotate', at: 10, deltaX: 5, deltaY: 5 },
        { type: 'sphereDragStart', at: 100 },
        { type: 'sphereRotate', at: 110, deltaX: 10, deltaY: 20 },
        { type: 'sphereRotate', at: 120, deltaX: -30, deltaY: 5 },
        { type: 'talismanDragStart', at: 130, talisman: '乾' },
        { type: 'sphereRotate', at: 140, deltaX: 15, deltaY: -40 },
        { type: 'baguaDrop', at: 150, talisman: '乾', direction: directionOf(0) },
        { type: 'sphereDragEnd', at: 160 },
        { type: 'sphereRotate', at: 170, deltaX: 7, deltaY: 7 },
        { type: 'talismanDragStart', at: 180, talisman: '离' },
        { type: 'baguaDrop', at: 190, talisman: '离', direction: directionOf(0) },
        { type: 'sphereDragStart', at: 200 },
        { type: 'sphereRotate', at: 210, deltaX: 25, deltaY: -10 },
        { type: 'sphereDragEnd', at: 220 },
        { type: 'advanceTo', at: 190 + ERROR_DURATION_MS },
        { type: 'advanceTo', at: 150 + BEAM_DURATION_MS },
      ];
      const report = runBatch(events);

      let rotX = 0;
      let rotY = 0;
      for (const [dx, dy] of [[10, 20], [-30, 5], [15, -40], [25, -10]]) {
        rotX = wrapDegrees(rotX + dy * ROTATION_SPEED);
        rotY = wrapDegrees(rotY + dx * ROTATION_SPEED);
      }
      const [finalX, finalY] = report.finalState.rotation;
      if (!approxEqual(finalX, rotX) || !approxEqual(finalY, rotY)) {
        failures.push(`旋转叠加结果错误：期望 [${rotX}, ${rotY}]，实际 [${finalX}, ${finalY}]`);
      }
      if (report.steps[0].ignored !== true) failures.push('未按下浑天仪时的旋转事件应被忽略');
      if (report.steps[8].ignored !== true) failures.push('拖拽结束后的旋转事件应被忽略');

      if (report.results.length !== 2) failures.push(`应产生 2 条推演结果，实际 ${report.results.length}`);
      if (!report.results[0]?.matched) failures.push('第一次投递（乾→0）应命中');
      if (report.results[1]?.matched !== false) failures.push('第二次投递（离→0）应未命中');

      const final = report.finalState;
      if (final.lightBeam !== null) failures.push('全部到期后光柱不得残留');
      if (final.baguaError) failures.push('全部到期后错误标志不得残留');
      if (final.draggedTalisman !== null) failures.push('全部结束后不得残留拖拽符咒');
      if (final.isRotating) failures.push('全部结束后旋转态应复位');
      return failures;
    },
  },
  {
    name: 'rapid-hits-replace-beam-without-residue',
    description: '光柱未消失时再次命中：新光柱替换旧光柱，旧到期时间不得误清新光柱',
    run() {
      const failures: string[] = [];
      const report = runBatch([
        { type: 'talismanDragStart', at: 1000, talisman: '乾' },
        { type: 'baguaDrop', at: 1010, talisman: '乾', direction: directionOf(0) },
        { type: 'talismanDragStart', at: 2000, talisman: '兑' },
        { type: 'baguaDrop', at: 2010, talisman: '兑', direction: directionOf(1) },
        { type: 'advanceTo', at: 1010 + BEAM_DURATION_MS + 500 },
        { type: 'advanceTo', at: 2010 + BEAM_DURATION_MS },
      ]);
      const beams = report.results.map((r) => r.beam);
      if (beams[0]?.beamId === beams[1]?.beamId) failures.push('两次命中应产生不同的光柱 id');
      const mid = report.steps[4].state;
      if (!mid.lightBeam || mid.lightBeam.beamId !== beams[1]?.beamId) {
        failures.push('旧光柱到期不得误删新光柱');
      }
      if (mid.lightBeam && !vecApproxEqual(mid.lightBeam.position, computeBeamPosition(1))) {
        failures.push('新光柱应位于 1 号卦位');
      }
      if (report.finalState.lightBeam !== null) failures.push('新光柱到期后应消失，不得残留');
      if (report.finalState.baguaError) failures.push('纯命中流程不应置位错误标志');
      return failures;
    },
  },
];

export function runScenarios(): ScenarioReport[] {
  return scenarios.map((scenario) => ({
    name: scenario.name,
    description: scenario.description,
    failures: scenario.run(),
  }));
}
