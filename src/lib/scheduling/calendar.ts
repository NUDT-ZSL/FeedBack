/**
 * 织机工作日历与工时换算。
 *
 * 时间均为自推演原点（第 0 天 00:00）起的分钟数。每台织机拥有按日重复
 * 的可用时段；工序所需的「工作台时」只在这些窗口内推进，非工作时段
 * （夜间、午歇等）挂钟时间照常流逝但不计入工时。
 */
import type { Loom } from './types'

export const MINUTES_PER_DAY = 1440

export function workMinutesRequired(baseMinutes: number, loom: Loom): number {
  if (!Number.isFinite(baseMinutes) || baseMinutes < 0) {
    throw new Error(`工序标准工时非法: ${baseMinutes}`)
  }
  if (!Number.isFinite(loom.efficiency) || loom.efficiency <= 0) {
    throw new Error(`织机 ${loom.id} 效率系数非法: ${loom.efficiency}`)
  }
  return Math.max(0, Math.ceil(baseMinutes / loom.efficiency))
}

function periodsOf(loom: Loom, day: number): Array<[number, number]> {
  if (day < (loom.availableFromDay ?? 0)) return []
  return loom.workPeriods.map((p) => [
    day * MINUTES_PER_DAY + p.startMin,
    day * MINUTES_PER_DAY + p.endMin,
  ])
}

/** 不早于 t 的第一个可工作时刻；若 t 已在工作窗口内则返回 t。 */
export function nextWorkingTime(loom: Loom, t: number): number {
  if (loom.workPeriods.length === 0) {
    throw new Error(`织机 ${loom.id} 未配置任何工作时段`)
  }
  const day = Math.floor(t / MINUTES_PER_DAY)
  const within = t - day * MINUTES_PER_DAY
  for (let d = day; ; d += 1) {
    for (const [ws, we] of periodsOf(loom, d)) {
      if (we <= t) continue
      return Math.max(t, ws)
    }
    if (d === day) {
      // 触发下一轮循环条件，无额外动作
      void within
    }
  }
}

/**
 * 从挂钟时刻 t（若不在工作窗口则先推进到窗口起点）开始，消耗 workMin
 * 分钟的织机工作台时，返回对应的挂钟结束时刻。
 */
export function addWorkMinutes(loom: Loom, t: number, workMin: number): number {
  if (workMin === 0) return nextWorkingTime(loom, t)
  let cursor = nextWorkingTime(loom, t)
  let remaining = workMin
  for (let guard = 0; guard < 100000; guard += 1) {
    const day = Math.floor(cursor / MINUTES_PER_DAY)
    let advanced = false
    for (const [ws, we] of periodsOf(loom, day)) {
      if (we <= cursor) continue
      const windowStart = Math.max(cursor, ws)
      const capacity = we - windowStart
      if (capacity >= remaining) return windowStart + remaining
      remaining -= capacity
      cursor = we
      advanced = true
      break
    }
    if (!advanced) {
      cursor = nextWorkingTime(loom, (day + 1) * MINUTES_PER_DAY + 1)
    }
  }
  throw new Error(`织机 ${loom.id} 工时推演超出最大天数`)
}

/** 统计 [start, end) 内某织机的可工作分钟数（用于校验与依据展示）。 */
export function countWorkingMinutes(loom: Loom, start: number, end: number): number {
  if (end <= start) return 0
  let total = 0
  const firstDay = Math.floor(start / MINUTES_PER_DAY)
  const lastDay = Math.floor((end - 1) / MINUTES_PER_DAY)
  for (let d = firstDay; d <= lastDay; d += 1) {
    for (const [ws, we] of periodsOf(loom, d)) {
      const s = Math.max(start, ws)
      const e = Math.min(end, we)
      if (e > s) total += e - s
    }
  }
  return total
}
