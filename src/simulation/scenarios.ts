/**
 * 命名场景库：覆盖需求要求的各类验证情形。
 * 测试与 scripts/replay.ts 共用，保证离线可复现。
 */
import { DEFAULT_SHIPS } from './defaultFleet.ts'
import type { Scenario, ShipData, SimOperation } from './types.ts'

function tickTimes(deltaSeconds: number, count: number): SimOperation[] {
  return Array.from({ length: count }, () => ({ type: 'tick', deltaSeconds }) as SimOperation)
}

function shipWith(overrides: Partial<ShipData>): ShipData {
  return { ...DEFAULT_SHIPS[0], ...overrides }
}

/** 场景一：水位与风随时间推进，观察各船状态演变 */
export const timeEvolutionScenario: Scenario = {
  name: 'time-evolution',
  description: '默认船队，先低水位推进，再升水位，再加大风，观察状态与告警演变',
  operations: [
    { type: 'setWaterLevel', value: 3 },
    ...tickTimes(1 / 60, 30),
    { type: 'setWaterLevel', value: 9 },
    ...tickTimes(1 / 60, 30),
    { type: 'setWindSpeed', value: 8 },
    ...tickTimes(1 / 60, 30),
    { type: 'setWaterLevel', value: 2 },
    { type: 'setWindSpeed', value: 1 },
    ...tickTimes(1 / 60, 30),
  ],
}

/** 场景二：同一时刻连续多组水位/风调整，最终状态只与最后生效值一致 */
export const lastWriteWinsScenario: Scenario = {
  name: 'last-write-wins',
  description: '连续覆盖水位与风速后再推进，验证最终状态只取决于最后生效值',
  operations: [
    { type: 'setWaterLevel', value: 2 },
    { type: 'setWaterLevel', value: 6 },
    { type: 'setWaterLevel', value: 8.5 },
    { type: 'setWindSpeed', value: 7 },
    { type: 'setWindSpeed', value: 3 },
    { type: 'setWindSpeed', value: 5 },
    ...tickTimes(1 / 60, 10),
  ],
}

/** 与 last-write-wins 对照：只施加最后生效值，最终状态应完全一致 */
export const lastWriteWinsControlScenario: Scenario = {
  name: 'last-write-wins-control',
  description: 'last-write-wins 的对照组：仅施加最终水位 8.5 与风速 5',
  operations: [
    { type: 'setWaterLevel', value: 8.5 },
    { type: 'setWindSpeed', value: 5 },
    ...tickTimes(1 / 60, 10),
  ],
}

/** 场景三：船舶越界 / 回到初始进度时状态被正确重置 */
export const wrapResetScenario: Scenario = {
  name: 'wrap-reset',
  description: '自定义船队处于进度边界，验证越过 1.1 后重置为 -0.1',
  initial: {
    ships: [
      shipWith({ id: 'edge-a', name: '临界限', progress: 1.1, speed: 0.5 }),
      shipWith({ id: 'edge-b', name: '越界船', progress: 1.09, speed: 2.5 }),
      shipWith({ id: 'edge-c', name: '起点船', progress: 0, speed: 1 }),
      shipWith({ id: 'edge-d', name: '归位船', progress: -0.1, speed: 0 }),
    ],
  },
  operations: [...tickTimes(1 / 60, 5), ...tickTimes(0.5, 3)],
}

/** 场景四：被选中船舶状态变化后，展示结论仍与推演结果一致 */
export const selectionLinkageScenario: Scenario = {
  name: 'selection-linkage',
  description: '选中船舶后改变水位与风速，验证选中船的展示结论与推演一致；含重复选中/取消',
  operations: [
    { type: 'selectShip', id: 'ship3' },
    { type: 'setWaterLevel', value: 10 },
    { type: 'setWindSpeed', value: 8 },
    { type: 'selectShip', id: 'ship3' },
    { type: 'selectShip', id: 'ship3' },
    { type: 'setWaterLevel', value: 1 },
    { type: 'selectShip', id: 'ship1' },
    { type: 'clearSelection' },
  ],
}

/** 场景五：异常输入——越界水位/风、非法步长、不存在的船，均不得静默生效 */
export const invalidInputsScenario: Scenario = {
  name: 'invalid-inputs',
  description: '施加一组越界/非法输入，验证全部被拒绝留痕且状态与未施加时一致',
  operations: [
    { type: 'setWaterLevel', value: 7 },
    { type: 'setWaterLevel', value: -0.5 },
    { type: 'setWaterLevel', value: 10.5 },
    { type: 'setWaterLevel', value: Number.NaN },
    { type: 'setWindSpeed', value: 4 },
    { type: 'setWindSpeed', value: 9 },
    { type: 'setWindSpeed', value: -1 },
    { type: 'tick', deltaSeconds: -0.5 },
    { type: 'selectShip', id: 'ghost-ship' },
    { type: 'selectShip', id: 'ship2' },
    { type: 'selectShip', id: 'ship2' },
    ...tickTimes(1 / 60, 5),
  ],
}

/** 与 invalid-inputs 对照：只保留合法操作 */
export const invalidInputsControlScenario: Scenario = {
  name: 'invalid-inputs-control',
  description: 'invalid-inputs 的对照组：仅含水位的 7、风速 4、选中再取消 ship2 与 5 帧推进',
  operations: [
    { type: 'setWaterLevel', value: 7 },
    { type: 'setWindSpeed', value: 4 },
    { type: 'selectShip', id: 'ship2' },
    { type: 'selectShip', id: 'ship2' },
    ...tickTimes(1 / 60, 5),
  ],
}

export const SCENARIOS: Scenario[] = [
  timeEvolutionScenario,
  lastWriteWinsScenario,
  lastWriteWinsControlScenario,
  wrapResetScenario,
  selectionLinkageScenario,
  invalidInputsScenario,
  invalidInputsControlScenario,
]
