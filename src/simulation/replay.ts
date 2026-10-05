/**
 * 离线回放：给定初始条件 + 操作序列，产出确定的逐步轨迹。
 * 每步都附带判定依据，并对整段轨迹生成校验和，便于口径调整前后做 diff。
 */
import { createSimulation } from './engine.ts'
import type { ReplayResult, Scenario, SimState, StepTrace } from './types.ts'

/** 数值归一化：消除浮点尾差，保证同一口径下轨迹逐字节一致 */
function normalizeNumber(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9
  return Object.is(rounded, -0) ? 0 : rounded
}

function normalize(value: unknown): unknown {
  if (typeof value === 'number') return normalizeNumber(value)
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      result[key] = normalize(source[key])
    }
    return result
  }
  return value
}

/** FNV-1a 32 位哈希，对归一化后的轨迹 JSON 计算 */
export function checksumOf(value: unknown): string {
  const text = JSON.stringify(normalize(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function snapshotState(state: SimState): SimState {
  return normalize(state) as SimState
}

/** 执行一个场景，返回完整轨迹（含每步依据）与最终状态 */
export function runScenario(scenario: Scenario): ReplayResult {
  const simulation = createSimulation(scenario.initial ?? {})
  const steps: StepTrace[] = []
  scenario.operations.forEach((op, index) => {
    const record = simulation.apply(op)
    steps.push({
      step: index,
      record,
      state: snapshotState(simulation.getState()),
      evaluation: simulation.evaluate(),
    })
  })
  const finalState = snapshotState(simulation.getState())
  return {
    scenario: scenario.name,
    description: scenario.description,
    steps,
    finalState,
    checksum: checksumOf(steps),
  }
}

/** 批量回放，键为场景名 */
export function runScenarios(scenarios: Scenario[]): Record<string, ReplayResult> {
  const results: Record<string, ReplayResult> = {}
  for (const scenario of scenarios) {
    results[scenario.name] = runScenario(scenario)
  }
  return results
}
