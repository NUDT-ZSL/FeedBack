import type {
  Pin,
  Plan,
  ScheduleErrorCode,
  SchedulingChange,
  SchedulingInput,
} from '../scheduling/types.ts';

export interface Scenario {
  id: string;
  title: string;
  input: SchedulingInput;
  /** 整体推导期望的错误码 */
  expectedError?: ScheduleErrorCode;
  /** 整体推导期望结论（独立人工参考值） */
  expectedPlan?: Plan;
  /** 局部重推场景：调整内容 */
  change?: SchedulingChange;
  /** 冲突来源保留裁决 */
  pins?: Pin[];
  expectedPartialError?: ScheduleErrorCode;
  expectedPartialPlan?: Plan;
  /** 受影响集合的精确期望，用于钉住“只重推受影响部分”边界 */
  expectedAffected?: string[];
}

/* 公共基线：D1 便宜但会与 O1/O2/O4 形成同设备串行；D2 较贵 */
function baseInput(): SchedulingInput {
  return {
    devices: [
      { id: 'D1', capabilities: ['cut', 'weld'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
      { id: 'D2', capabilities: ['cut', 'weld'], windows: [{ start: 0, end: 20 }], energyRate: 2 },
    ],
    operations: [
      { id: 'O1', capability: 'cut', duration: 5, deps: [] },
      { id: 'O2', capability: 'weld', duration: 5, deps: ['O1'] },
      { id: 'O3', capability: 'cut', duration: 5, deps: [] },
      { id: 'O4', capability: 'cut', duration: 5, deps: ['O2', 'O3'] },
    ],
  };
}

const planA: Plan = {
  assignments: [
    { opId: 'O1', deviceId: 'D1', start: 0, end: 5, cost: 5 },
    { opId: 'O2', deviceId: 'D1', start: 5, end: 10, cost: 5 },
    { opId: 'O3', deviceId: 'D2', start: 0, end: 5, cost: 10 },
    { opId: 'O4', deviceId: 'D1', start: 10, end: 15, cost: 5 },
  ],
  totalCost: 25,
};

export const scenarios: Scenario[] = [
  {
    id: 'A-baseline',
    title: '基线排布：依赖顺序、设备能力、可用时段与能耗代价',
    input: baseInput(),
    expectedPlan: planA,
  },
  {
    id: 'B-dep-cycle',
    title: '依赖成环必须被整体推导拒绝',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
      ],
      operations: [
        { id: 'O1', capability: 'cut', duration: 5, deps: ['O3'] },
        { id: 'O2', capability: 'cut', duration: 5, deps: ['O1'] },
        { id: 'O3', capability: 'cut', duration: 5, deps: ['O2'] },
      ],
    },
    expectedError: 'DEPENDENCY_CYCLE',
  },
  {
    id: 'C-dep-missing',
    title: '依赖指向缺失工序必须被拒绝',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
      ],
      operations: [
        { id: 'O1', capability: 'cut', duration: 5, deps: [] },
        { id: 'O2', capability: 'cut', duration: 5, deps: ['O1', 'GHOST'] },
      ],
    },
    expectedError: 'DEPENDENCY_MISSING',
  },
  {
    id: 'D-capability-uncovered',
    title: '静态输入中设备能力无法覆盖工序必须被拒绝',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
        { id: 'D2', capabilities: ['weld'], windows: [{ start: 0, end: 20 }], energyRate: 2 },
      ],
      operations: [
        { id: 'O1', capability: 'cut', duration: 5, deps: [] },
        { id: 'O2', capability: 'polish', duration: 5, deps: ['O1'] },
      ],
    },
    expectedError: 'CAPABILITY_UNCOVERED',
  },
  {
    id: 'E-window-shrink',
    title: '设备可用时段收缩：只重推受影响工序，结论与整体重排一致',
    input: baseInput(),
    expectedPlan: planA,
    change: { kind: 'device-windows', deviceId: 'D1', windows: [{ start: 5, end: 20 }] },
    expectedPartialPlan: {
      assignments: [
        { opId: 'O1', deviceId: 'D2', start: 0, end: 5, cost: 10 },
        { opId: 'O2', deviceId: 'D1', start: 5, end: 10, cost: 5 },
        { opId: 'O3', deviceId: 'D2', start: 5, end: 10, cost: 10 },
        { opId: 'O4', deviceId: 'D1', start: 10, end: 15, cost: 5 },
      ],
      totalCost: 30,
    },
    expectedAffected: ['O1', 'O3'],
  },
  {
    id: 'F-energy-rate',
    title: '设备能耗率调整：排布可不变但代价结论必须更新，只波及代价相关工序',
    input: baseInput(),
    expectedPlan: planA,
    change: { kind: 'device-energy-rate', deviceId: 'D2', energyRate: 1 },
    expectedPartialPlan: {
      assignments: [
        { opId: 'O1', deviceId: 'D1', start: 0, end: 5, cost: 5 },
        { opId: 'O2', deviceId: 'D1', start: 5, end: 10, cost: 5 },
        { opId: 'O3', deviceId: 'D2', start: 0, end: 5, cost: 5 },
        { opId: 'O4', deviceId: 'D1', start: 10, end: 15, cost: 5 },
      ],
      totalCost: 20,
    },
    expectedAffected: ['O3'],
  },
  {
    id: 'G-capability-removed',
    title: '设备能力被改动后无法覆盖工序：局部重推必须识别为同一错误',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut', 'weld'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
        { id: 'D2', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 2 },
      ],
      operations: [
        { id: 'O1', capability: 'cut', duration: 5, deps: [] },
        { id: 'O2', capability: 'weld', duration: 5, deps: ['O1'] },
      ],
    },
    expectedPlan: {
      assignments: [
        { opId: 'O1', deviceId: 'D1', start: 0, end: 5, cost: 5 },
        { opId: 'O2', deviceId: 'D1', start: 5, end: 10, cost: 5 },
      ],
      totalCost: 10,
    },
    change: { kind: 'device-capabilities', deviceId: 'D1', capabilities: ['cut'] },
    expectedPartialError: 'CAPABILITY_UNCOVERED',
  },
  {
    id: 'H-pin-conflict',
    title: '冲突来源保留裁决：钉住工序不动，其余重推，结果与整体重排一致',
    input: baseInput(),
    expectedPlan: planA,
    change: { kind: 'device-windows', deviceId: 'D1', windows: [{ start: 5, end: 20 }] },
    pins: [{ opId: 'O3', deviceId: 'D1', start: 5 }],
    expectedPartialPlan: {
      assignments: [
        { opId: 'O1', deviceId: 'D2', start: 0, end: 5, cost: 10 },
        { opId: 'O2', deviceId: 'D2', start: 5, end: 10, cost: 10 },
        { opId: 'O3', deviceId: 'D1', start: 5, end: 10, cost: 5 },
        { opId: 'O4', deviceId: 'D1', start: 10, end: 15, cost: 5 },
      ],
      totalCost: 30,
    },
    expectedAffected: ['O1', 'O2'],
  },
  {
    id: 'I-rate-tie-break',
    title: '能耗率反转改变并列设备选择：工序必须迁移到更便宜的设备',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 2 },
        { id: 'D2', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
      ],
      operations: [{ id: 'O1', capability: 'cut', duration: 5, deps: [] }],
    },
    expectedPlan: {
      assignments: [{ opId: 'O1', deviceId: 'D2', start: 0, end: 5, cost: 5 }],
      totalCost: 5,
    },
    change: { kind: 'device-energy-rate', deviceId: 'D2', energyRate: 5 },
    expectedPartialPlan: {
      assignments: [{ opId: 'O1', deviceId: 'D1', start: 0, end: 5, cost: 10 }],
      totalCost: 10,
    },
    expectedAffected: ['O1'],
  },
  {
    id: 'J-pin-invalid',
    title: '钉住到不具备能力的设备必须被拒绝',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
        { id: 'D3', capabilities: ['weld'], windows: [{ start: 0, end: 20 }], energyRate: 3 },
      ],
      operations: [{ id: 'O1', capability: 'cut', duration: 5, deps: [] }],
    },
    expectedPlan: {
      assignments: [{ opId: 'O1', deviceId: 'D1', start: 0, end: 5, cost: 5 }],
      totalCost: 5,
    },
    change: { kind: 'device-energy-rate', deviceId: 'D1', energyRate: 1 },
    pins: [{ opId: 'O1', deviceId: 'D3', start: 0 }],
    expectedPartialError: 'PIN_INVALID',
  },
  {
    id: 'K-unfeasible-static',
    title: '工序时长超出全部可用时段：整体推导返回 UNFEASIBLE',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 4 }], energyRate: 1 },
        { id: 'D2', capabilities: ['cut'], windows: [{ start: 0, end: 3 }], energyRate: 2 },
      ],
      operations: [{ id: 'O1', capability: 'cut', duration: 5, deps: [] }],
    },
    expectedError: 'UNFEASIBLE',
  },
  {
    id: 'L-unfeasible-after-change',
    title: '时段收缩后无可行排布：局部重推与整体重排均失败且错误一致',
    input: {
      devices: [
        { id: 'D1', capabilities: ['cut'], windows: [{ start: 0, end: 20 }], energyRate: 1 },
        { id: 'D2', capabilities: ['weld'], windows: [{ start: 0, end: 20 }], energyRate: 2 },
      ],
      operations: [
        { id: 'O1', capability: 'cut', duration: 5, deps: [] },
        { id: 'O2', capability: 'weld', duration: 5, deps: ['O1'] },
      ],
    },
    expectedPlan: {
      assignments: [
        { opId: 'O1', deviceId: 'D1', start: 0, end: 5, cost: 5 },
        { opId: 'O2', deviceId: 'D2', start: 5, end: 10, cost: 10 },
      ],
      totalCost: 15,
    },
    change: { kind: 'device-windows', deviceId: 'D1', windows: [{ start: 0, end: 3 }] },
    expectedPartialError: 'UNFEASIBLE',
  },
];
