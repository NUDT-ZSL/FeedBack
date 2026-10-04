/**
 * 编辑器核心引擎（纯函数、无框架依赖）。
 *
 * 历史、选区、效果链三者的唯一事实来源：
 * - history 是一条可复现的操作序列，每条效果记录携带效果类型、参数与作用区间；
 * - 当前选区与已生效效果链永远通过 deriveAtIndex 从序列重新推导，不单独维护副本；
 * - 撤销 / 重做 / 跳转都只是移动 historyIndex 后重新推导。
 */

export type EffectType = 'fadeIn' | 'fadeOut' | 'echo' | 'speed' | 'reverse'

export interface EffectParams {
  fadeIn?: { start: number; end: number; duration: number }
  fadeOut?: { start: number; end: number; duration: number }
  echo?: { delay: number; decay: number }
  speed?: { rate: number }
  reverse?: Record<string, never>
}

export interface SelectionRange {
  inPoint: number
  outPoint: number
}

export interface HistoryEntry {
  id: string
  timestamp: number
  kind: 'baseline' | 'effect'
  effect: EffectType | null
  params: EffectParams
  /** 该记录生效时的选区（秒），跳转 / 撤销时选区恢复到此值 */
  range: SelectionRange
  description: string
  icon: string
}

export interface AppliedEffect {
  effect: EffectType
  params: EffectParams
  range: SelectionRange
}

export interface EditorState {
  /** 当前音频时长（秒），无音频时为 0 */
  duration: number
  selection: SelectionRange
  history: HistoryEntry[]
  historyIndex: number
  /** 跳转动画进行中：此时一切变更操作都被忽略，UI 可据此展示忙碌态 */
  jumpInProgress: boolean
  /** 进行中的跳转目标，完成时应用到 historyIndex */
  jumpTarget: number | null
}

export interface DerivedState {
  selection: SelectionRange
  effects: AppliedEffect[]
}

const EFFECT_LABELS: Record<EffectType, string> = {
  fadeIn: '淡入',
  fadeOut: '淡出',
  echo: '回声',
  speed: '变速',
  reverse: '翻转',
}

let idCounter = 0

export function createEntryId(): string {
  idCounter += 1
  return `entry-${Date.now()}-${idCounter}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 把任意区间规范化为 [0, duration] 内且 inPoint <= outPoint */
export function normalizeSelection(range: SelectionRange, duration: number): SelectionRange {
  const inPoint = clamp(range.inPoint, 0, duration)
  const outPoint = clamp(range.outPoint, 0, duration)
  return inPoint <= outPoint
    ? { inPoint, outPoint }
    : { inPoint: outPoint, outPoint: inPoint }
}

export function describeEffect(effect: EffectType, range: SelectionRange): string {
  return `应用${EFFECT_LABELS[effect]}-从${range.inPoint.toFixed(1)}s到${range.outPoint.toFixed(1)}s`
}

function paramsEqual(a: EffectParams, b: EffectParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function rangeEqual(a: SelectionRange, b: SelectionRange): boolean {
  return a.inPoint === b.inPoint && a.outPoint === b.outPoint
}

/** 两条记录是否为同一操作（用于快速连续点击去重） */
export function isSameOperation(
  entry: HistoryEntry,
  effect: EffectType,
  params: EffectParams,
  range: SelectionRange,
): boolean {
  return (
    entry.kind === 'effect' &&
    entry.effect === effect &&
    paramsEqual(entry.params, params) &&
    rangeEqual(entry.range, range)
  )
}

/** 从序列重新推导第 index 步的选区与已生效效果链 */
export function deriveAtIndex(history: HistoryEntry[], index: number): DerivedState {
  const safeIndex = clamp(index, 0, history.length - 1)
  const effects: AppliedEffect[] = []
  for (let i = 1; i <= safeIndex; i += 1) {
    const entry = history[i]
    if (entry.kind === 'effect' && entry.effect) {
      effects.push({ effect: entry.effect, params: entry.params, range: entry.range })
    }
  }
  const current = history[safeIndex]
  return {
    selection: current ? { ...current.range } : { inPoint: 0, outPoint: 0 },
    effects,
  }
}

export function createInitialState(): EditorState {
  return {
    duration: 0,
    selection: { inPoint: 0, outPoint: 0 },
    history: [],
    historyIndex: 0,
    jumpInProgress: false,
    jumpTarget: null,
  }
}

/** 加载音频：重置历史，写入基线记录（全选区、无效果） */
export function loadAudio(state: EditorState, duration: number, now = Date.now()): EditorState {
  const baseline: HistoryEntry = {
    id: createEntryId(),
    timestamp: now,
    kind: 'baseline',
    effect: null,
    params: {},
    range: { inPoint: 0, outPoint: duration },
    description: `上传音频-时长${duration.toFixed(1)}s`,
    icon: 'upload',
  }
  return {
    ...state,
    duration,
    selection: { inPoint: 0, outPoint: duration },
    history: [baseline],
    historyIndex: 0,
    jumpInProgress: false,
    jumpTarget: null,
  }
}

/**
 * 拖入点：夹在 [0, outPoint]。越界拖拽被夹住而非形成反向区间。
 * 选区调整不产生历史记录，纠正也不会。
 */
export function setInPoint(state: EditorState, time: number): EditorState {
  if (state.jumpInProgress) return state
  const inPoint = clamp(time, 0, state.selection.outPoint)
  if (inPoint === state.selection.inPoint) return state
  return { ...state, selection: { ...state.selection, inPoint } }
}

/** 拖出点：夹在 [inPoint, duration] */
export function setOutPoint(state: EditorState, time: number): EditorState {
  if (state.jumpInProgress) return state
  const outPoint = clamp(time, state.selection.inPoint, state.duration)
  if (outPoint === state.selection.outPoint) return state
  return { ...state, selection: { ...state.selection, outPoint } }
}

/**
 * 应用效果：
 * - 跳转进行中忽略；
 * - 选区先规范化，空选区不生效；
 * - 与当前栈顶记录完全相同时去重（快速连续点击只推进一格）；
 * - 截断 historyIndex 之后的被撤销分支再追加。
 */
export function applyEffect(
  state: EditorState,
  effect: EffectType,
  params: EffectParams,
  now = Date.now(),
): EditorState {
  if (state.jumpInProgress) return state
  if (state.history.length === 0) return state

  const range = normalizeSelection(state.selection, state.duration)
  if (range.outPoint - range.inPoint <= 0) return state

  const top = state.history[state.historyIndex]
  if (top && isSameOperation(top, effect, params, range)) {
    return state
  }

  const entry: HistoryEntry = {
    id: createEntryId(),
    timestamp: now,
    kind: 'effect',
    effect,
    params,
    range,
    description: describeEffect(effect, range),
    icon: effect,
  }

  const history = [...state.history.slice(0, state.historyIndex + 1), entry]
  const historyIndex = history.length - 1
  const derived = deriveAtIndex(history, historyIndex)
  return { ...state, history, historyIndex, selection: derived.selection }
}

export function undo(state: EditorState): EditorState {
  if (state.jumpInProgress || state.historyIndex <= 0) return state
  const historyIndex = state.historyIndex - 1
  const derived = deriveAtIndex(state.history, historyIndex)
  return { ...state, historyIndex, selection: derived.selection }
}

export function redo(state: EditorState): EditorState {
  if (state.jumpInProgress || state.historyIndex >= state.history.length - 1) return state
  const historyIndex = state.historyIndex + 1
  const derived = deriveAtIndex(state.history, historyIndex)
  return { ...state, historyIndex, selection: derived.selection }
}

/** 开始跳转：只置忙碌标记与目标，实际状态在 completeJump 时一次性落地 */
export function beginJump(state: EditorState, target: number): EditorState {
  if (state.jumpInProgress) return state
  if (target < 0 || target >= state.history.length || target === state.historyIndex) return state
  return { ...state, jumpInProgress: true, jumpTarget: target }
}

/** 结束跳转：索引、选区与效果链一并回到目标记录对应的状态 */
export function completeJump(state: EditorState): EditorState {
  if (!state.jumpInProgress || state.jumpTarget === null) return state
  const historyIndex = state.jumpTarget
  const derived = deriveAtIndex(state.history, historyIndex)
  return {
    ...state,
    historyIndex,
    selection: derived.selection,
    jumpInProgress: false,
    jumpTarget: null,
  }
}

/** 撤销 / 重做同样走两阶段（供 UI 播放卷起动画），语义与 beginJump 一致 */
export function beginUndo(state: EditorState): EditorState {
  if (state.jumpInProgress || state.historyIndex <= 0) return state
  return { ...state, jumpInProgress: true, jumpTarget: state.historyIndex - 1 }
}

export function beginRedo(state: EditorState): EditorState {
  if (state.jumpInProgress || state.historyIndex >= state.history.length - 1) return state
  return { ...state, jumpInProgress: true, jumpTarget: state.historyIndex + 1 }
}

/** 当前已生效效果链（从序列推导，不缓存） */
export function activeEffects(state: EditorState): AppliedEffect[] {
  return deriveAtIndex(state.history, state.historyIndex).effects
}
