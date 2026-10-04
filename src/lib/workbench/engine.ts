import type { EffectParams, EffectRecord, EffectType, Selection, WorkbenchState } from './types'

let recordSeq = 0
const nextId = () => `fx_${Date.now().toString(36)}_${(recordSeq++).toString(36)}`

const round = (v: number) => Math.round(v * 1000) / 1000

export function createState(duration = 0): WorkbenchState {
  const initial: Selection = duration > 0 ? { in: 0, out: duration } : { in: 0, out: 0 }
  return {
    duration,
    records: [],
    appliedCount: 0,
    selection: initial,
    initialSelection: initial,
    jumpStatus: 'idle',
    pendingCount: null,
  }
}

/** 加载音频：重建状态，初始选区为整段 */
export function loadAudio(duration: number): WorkbenchState {
  return createState(Math.max(0, duration))
}

export function clampSelection(sel: { in: number; out: number }, duration: number): Selection {
  const out = Math.max(0, Math.min(duration, sel.out))
  const inPoint = Math.max(0, Math.min(out, Math.min(duration, sel.in)))
  return { in: round(inPoint), out: round(out) }
}

/**
 * 拖拽入/出点。入点始终被夹住为不晚于出点（反之亦然）。
 * 纯选区修改，不产生历史记录。
 */
export function setSelection(state: WorkbenchState, sel: Partial<Selection>): WorkbenchState {
  if (state.jumpStatus !== 'idle') return state
  const next = clampSelection(
    {
      in: sel.in ?? state.selection.in,
      out: sel.out ?? state.selection.out,
    },
    state.duration
  )
  if (next.in === state.selection.in && next.out === state.selection.out) return state
  return { ...state, selection: next }
}

/** 索引 i 处记录生效后的选区，即该记录作用区间 */
export function deriveSelection(state: WorkbenchState, appliedCount: number): Selection {
  if (appliedCount <= 0) return state.initialSelection
  return state.records[Math.min(appliedCount, state.records.length) - 1].range
}

/** 当前已生效的效果链（records 的前缀） */
export function deriveEffects(state: WorkbenchState): EffectRecord[] {
  return state.records.slice(0, state.appliedCount)
}

export function describeEffect(type: EffectType, params: EffectParams): string {
  switch (type) {
    case 'fadeIn':
      return `淡入 ${params.fadeIn?.duration ?? 0}s`
    case 'fadeOut':
      return `淡出 ${params.fadeOut?.duration ?? 0}s`
    case 'echo':
      return `回声 延迟 ${params.echo?.delay ?? 0}s 衰减 ${params.echo?.decay ?? 0}`
    case 'speed':
      return `变速 ${params.speed?.rate ?? 1}x`
    case 'reverse':
      return '翻转'
  }
}

function sameEffect(a: EffectRecord | undefined, type: EffectType, params: EffectParams, range: Selection): boolean {
  if (!a || a.type !== type) return false
  if (a.range.in !== range.in || a.range.out !== range.out) return false
  return JSON.stringify(a.params) === JSON.stringify(params)
}

export interface ApplyMeta {
  id?: string
  timestamp?: number
}

/**
 * 应用一个效果：
 * - 截断被撤销的后续记录（appliedCount 之后的分支）；
 * - 与序列末端记录的类型/参数/区间完全相同时合并，快速连点只推进一格；
 * - 新记录使用当前（已夹住的）选区，并把选区推导为该记录区间。
 * 跳转进行中时忽略。
 */
export function applyEffect(
  state: WorkbenchState,
  type: EffectType,
  params: EffectParams,
  meta: ApplyMeta = {}
): WorkbenchState {
  if (state.jumpStatus !== 'idle') return state
  if (state.duration <= 0) return state

  const range = clampSelection(state.selection, state.duration)
  if (range.in >= range.out) return state // 零宽选区上的效果是空操作，不产生记录
  const tip = state.appliedCount > 0 ? state.records[state.appliedCount - 1] : undefined
  if (sameEffect(tip, type, params, range)) return state

  const record: EffectRecord = {
    id: meta.id ?? nextId(),
    timestamp: meta.timestamp ?? Date.now(),
    type,
    params,
    range,
    description: describeEffect(type, params),
  }
  const records = state.records.slice(0, state.appliedCount).concat(record)
  const appliedCount = records.length
  return {
    ...state,
    records,
    appliedCount,
    selection: deriveSelection({ ...state, records }, appliedCount),
  }
}

function beginJump(state: WorkbenchState, targetCount: number): WorkbenchState {
  if (state.jumpStatus !== 'idle') return state
  const target = Math.max(0, Math.min(state.records.length, Math.round(targetCount)))
  if (target === state.appliedCount) return state
  return { ...state, jumpStatus: 'jumping', pendingCount: target }
}

/** 跳转结束：索引、选区、效果链统一由记录序列推导 */
export function completeJump(state: WorkbenchState): WorkbenchState {
  if (state.jumpStatus !== 'jumping' || state.pendingCount === null) return state
  const appliedCount = state.pendingCount
  return {
    ...state,
    appliedCount,
    selection: deriveSelection(state, appliedCount),
    jumpStatus: 'idle',
    pendingCount: null,
  }
}

/** 跳转到某条记录（index 为记录下标），异步完成走 completeJump */
export function jumpTo(state: WorkbenchState, index: number): WorkbenchState {
  return beginJump(state, index + 1)
}

/** 撤销（带回滚动画，完成走 completeJump） */
export function requestUndo(state: WorkbenchState): WorkbenchState {
  return beginJump(state, state.appliedCount - 1)
}

/** 重做（带回滚动画，完成走 completeJump） */
export function requestRedo(state: WorkbenchState): WorkbenchState {
  return beginJump(state, state.appliedCount + 1)
}

export function canUndo(state: WorkbenchState): boolean {
  return state.jumpStatus === 'idle' && state.appliedCount > 0
}

export function canRedo(state: WorkbenchState): boolean {
  return state.jumpStatus === 'idle' && state.appliedCount < state.records.length
}

/** 历史面板使用的当前记录下标；无已生效记录时为 -1 */
export function currentIndex(state: WorkbenchState): number {
  return state.appliedCount - 1
}

/**
 * 一致性不变量：
 * 索引合法、选区满足 0 <= in <= out <= duration、
 * 当前选区等于由序列推导出的选区、
 * 进行中的跳转目标合法。
 */
export function checkInvariant(state: WorkbenchState): void {
  const { duration, records, appliedCount, selection } = state
  if (appliedCount < 0 || appliedCount > records.length) {
    throw new Error(`appliedCount 越界: ${appliedCount}/${records.length}`)
  }
  if (!(selection.in >= 0 && selection.out <= duration && selection.in <= selection.out)) {
    throw new Error(`选区反向或越界: ${JSON.stringify(selection)} (duration=${duration})`)
  }
  if (state.jumpStatus !== 'idle' &&
    (state.pendingCount === null || state.pendingCount < 0 || state.pendingCount > records.length)) {
    throw new Error('进行中的跳转目标非法')
  }
}
