import {
  ScheduleError,
  applyDeviceChanges,
  reschedulePartial,
  scheduleAll,
} from '../engine.js';

export const CATEGORY = {
  PLACEMENT: '排布结论错',
  COST: '代价结论错',
  SCOPE: '受影响范围漏推',
  REJECTION: '边界拒绝不符合预期',
};

const BASELINE_DEVICES = [
  { id: 'D1', capabilities: ['cut'], windows: [[0, 100]], energyRate: 2 },
  { id: 'D2', capabilities: ['cut'], windows: [[0, 100]], energyRate: 5 },
  { id: 'D3', capabilities: ['polish'], windows: [[0, 100]], energyRate: 3 },
];

const BASELINE_OPS = [
  { id: 'A', type: 'cut', duration: 10, deps: [] },
  { id: 'B', type: 'cut', duration: 6, deps: ['A'] },
  { id: 'C', type: 'polish', duration: 4, deps: ['B'] },
  { id: 'D', type: 'polish', duration: 4, deps: [] },
];

const BASELINE_MODEL = { devices: BASELINE_DEVICES, operations: BASELINE_OPS };

const EXPECTED_BASELINE = {
  A: { deviceId: 'D1', start: 0, end: 10, cost: 20 },
  B: { deviceId: 'D1', start: 10, end: 16, cost: 12 },
  C: { deviceId: 'D3', start: 16, end: 20, cost: 12 },
  D: { deviceId: 'D3', start: 0, end: 4, cost: 12 },
};
const BASELINE_TOTAL = 56;

function samePlacement(actual, expected) {
  return (
    actual.deviceId === expected.deviceId &&
    actual.start === expected.start &&
    actual.end === expected.end
  );
}

function placementFailures(actual, expected, label = '工序') {
  const failures = [];
  const ids = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const id of ids) {
    if (!actual[id]) {
      failures.push(`${label} ${id} 在排布结论中缺失`);
    } else if (!samePlacement(actual[id], expected[id])) {
      const exp = expected[id];
      failures.push(
        `${label} ${id} 期望 ${exp.deviceId}[${exp.start},${exp.end})，` +
          `实际 ${actual[id].deviceId}[${actual[id].start},${actual[id].end})`
      );
    }
  }
  return failures;
}

function placementDiff(a, b) {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diff = [];
  for (const id of ids) {
    if (!a[id] || !b[id] || !samePlacement(a[id], b[id])) diff.push(id);
  }
  return diff.sort();
}

function expectRejection(model, expectedCode) {
  const failures = [];
  try {
    scheduleAll(model);
    failures.push(`应抛出 ${expectedCode} 但排布推导成功完成`);
  } catch (error) {
    if (!(error instanceof ScheduleError) || error.code !== expectedCode) {
      const code = error instanceof ScheduleError ? error.code : error.constructor.name;
      failures.push(`期望拒绝码 ${expectedCode}，实际为 ${code}：${error.message}`);
    }
  }
  return failures;
}

export const CASES = [
  {
    id: 'full-baseline-pinned',
    path: '排布推导',
    title: '正常模型的排布结论与代价结论固定',
    run() {
      const failures = [];
      const result = scheduleAll(BASELINE_MODEL);
      for (const detail of placementFailures(result.placements, EXPECTED_BASELINE)) {
        failures.push({ category: CATEGORY.PLACEMENT, detail });
      }
      if (result.totalCost !== BASELINE_TOTAL) {
        failures.push({
          category: CATEGORY.COST,
          detail: `总能耗代价期望 ${BASELINE_TOTAL}，实际 ${result.totalCost}`,
        });
      }
      return failures;
    },
  },
  {
    id: 'boundary-dependency-cycle',
    path: '排布推导',
    title: '依赖成环必须被拒绝',
    run() {
      const model = {
        devices: BASELINE_DEVICES,
        operations: [
          { id: 'X', type: 'cut', duration: 4, deps: ['Y'] },
          { id: 'Y', type: 'cut', duration: 4, deps: ['X'] },
        ],
      };
      return expectRejection(model, 'DEPENDENCY_CYCLE').map((detail) => ({
        category: CATEGORY.REJECTION,
        detail,
      }));
    },
  },
  {
    id: 'boundary-dependency-missing',
    path: '排布推导',
    title: '依赖指向缺失工序必须被拒绝',
    run() {
      const model = {
        devices: BASELINE_DEVICES,
        operations: [{ id: 'P', type: 'cut', duration: 4, deps: ['ghost'] }],
      };
      return expectRejection(model, 'MISSING_DEPENDENCY').map((detail) => ({
        category: CATEGORY.REJECTION,
        detail,
      }));
    },
  },
  {
    id: 'boundary-capability-uncovered',
    path: '排布推导',
    title: '设备能力无法覆盖工序必须被拒绝',
    run() {
      const model = {
        devices: BASELINE_DEVICES,
        operations: [{ id: 'Q', type: 'weld', duration: 4, deps: [] }],
      };
      return expectRejection(model, 'CAPABILITY_UNCOVERED').map((detail) => ({
        category: CATEGORY.REJECTION,
        detail,
      }));
    },
  },
  {
    id: 'partial-device-window-shrunk',
    path: '局部重推',
    title: '设备时段收缩后只重推受影响工序，且与整体重排一致',
    run() {
      const failures = [];
      const previous = scheduleAll(BASELINE_MODEL).placements;
      const newModel = applyDeviceChanges(BASELINE_MODEL, {
        D1: { windows: [[0, 12]] },
      });
      const expectedAffected = ['A', 'B', 'C'];
      const partial = reschedulePartial(newModel, previous, ['D1']);
      const full = scheduleAll(newModel);

      if (JSON.stringify(partial.affected) !== JSON.stringify(expectedAffected)) {
        failures.push({
          category: CATEGORY.SCOPE,
          detail: `受影响范围期望 [${expectedAffected.join(',')}]，实际 [${partial.affected.join(',')}]`,
        });
      }
      const actuallyChanged = new Set(placementDiff(previous, full.placements));
      for (const id of actuallyChanged) {
        if (!partial.affected.includes(id)) {
          failures.push({
            category: CATEGORY.SCOPE,
            detail: `工序 ${id} 在整体重排中结论已变，但未被纳入局部重推范围`,
          });
        }
      }
      for (const detail of placementFailures(partial.placements, full.placements)) {
        failures.push({ category: CATEGORY.PLACEMENT, detail: `局部重推与整体重排不一致：${detail}` });
      }
      if (!samePlacement(partial.placements.D, previous.D)) {
        failures.push({
          category: CATEGORY.PLACEMENT,
          detail: `未受影响工序 D 的排布被改动，未做到只重推受影响部分`,
        });
      }
      if (partial.totalCost !== full.totalCost) {
        failures.push({
          category: CATEGORY.COST,
          detail: `局部重推代价 ${partial.totalCost} 与整体重排代价 ${full.totalCost} 不一致`,
        });
      }
      if (full.totalCost === BASELINE_TOTAL) {
        failures.push({
          category: CATEGORY.COST,
          detail: '设备时段收缩后代价结论未随排布变化重新计算',
        });
      }
      return failures;
    },
  },
  {
    id: 'partial-conflict-source-retained',
    path: '局部重推',
    title: '冲突来源保留裁决后，局部重推与整体重排一致',
    run() {
      const failures = [];
      const devices = [
        { id: 'M1', capabilities: ['a'], windows: [[0, 10]], energyRate: 1 },
        { id: 'M2', capabilities: ['a', 'b'], windows: [[0, 10]], energyRate: 1 },
      ];
      const operations = [
        { id: 'K1', type: 'a', duration: 5, deps: [] },
        { id: 'K2', type: 'b', duration: 5, deps: [] },
        { id: 'K3', type: 'a', duration: 5, deps: [] },
      ];
      const model = { devices, operations };
      const previous = scheduleAll(model).placements;
      const newModel = applyDeviceChanges(model, {
        M1: { windows: [[0, 5]] },
      });
      const partial = reschedulePartial(newModel, previous, ['M1']);
      const full = scheduleAll(newModel);

      if (JSON.stringify(partial.affected) !== JSON.stringify(['K1', 'K3'])) {
        failures.push({
          category: CATEGORY.SCOPE,
          detail: `受影响范围期望 [K1,K3]，实际 [${partial.affected.join(',')}]`,
        });
      }
      if (!samePlacement(partial.placements.K2, previous.K2)) {
        failures.push({
          category: CATEGORY.PLACEMENT,
          detail: '作为冲突来源的工序 K2 未被保留，裁决未遵循来源保留',
        });
      }
      for (const detail of placementFailures(partial.placements, full.placements)) {
        failures.push({ category: CATEGORY.PLACEMENT, detail: `裁决后与整体重排不一致：${detail}` });
      }
      if (partial.totalCost !== full.totalCost) {
        failures.push({
          category: CATEGORY.COST,
          detail: `裁决后局部代价 ${partial.totalCost} 与整体代价 ${full.totalCost} 不一致`,
        });
      }
      return failures;
    },
  },
  {
    id: 'partial-energy-rate-changed',
    path: '局部重推',
    title: '设备能耗属性改动后代价结论必须重算',
    run() {
      const failures = [];
      const previous = scheduleAll(BASELINE_MODEL).placements;
      const newModel = applyDeviceChanges(BASELINE_MODEL, {
        D3: { energyRate: 4 },
      });
      const partial = reschedulePartial(newModel, previous, ['D3']);
      const full = scheduleAll(newModel);

      for (const detail of placementFailures(partial.placements, full.placements)) {
        failures.push({ category: CATEGORY.PLACEMENT, detail });
      }
      if (partial.totalCost !== full.totalCost || partial.totalCost !== 64) {
        failures.push({
          category: CATEGORY.COST,
          detail: `能耗单价调整后代价期望 64，局部 ${partial.totalCost} / 整体 ${full.totalCost}`,
        });
      }
      if (partial.totalCost === BASELINE_TOTAL) {
        failures.push({
          category: CATEGORY.COST,
          detail: '设备能耗属性改动后代价结论未重新计算',
        });
      }
      return failures;
    },
  },
];
