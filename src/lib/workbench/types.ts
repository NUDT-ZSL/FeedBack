export type EffectType = 'fadeIn' | 'fadeOut' | 'echo' | 'speed' | 'reverse'

export interface EffectParams {
  fadeIn?: { start: number; end: number; duration: number }
  fadeOut?: { start: number; end: number; duration: number }
  echo?: { delay: number; decay: number }
  speed?: { rate: number }
  reverse?: Record<string, never>
}

/** 选区（秒）。不变量：0 <= in <= out <= duration */
export interface Selection {
  in: number
  out: number
}

/**
 * 一条历史记录 = 一个确定的效果 + 参数 + 作用区间。
 * 当前选区与已生效效果链始终由 records[0..appliedCount) 重新推导。
 */
export interface EffectRecord {
  id: string
  timestamp: number
  type: EffectType
  params: EffectParams
  range: Selection
  description: string
}

export type JumpStatus = 'idle' | 'jumping'

export interface WorkbenchState {
  /** 音频总时长（秒），0 表示未加载 */
  duration: number
  /** 已截断到当前分支的记录序列（被撤销的分支不会残留） */
  records: EffectRecord[]
  /** 已生效的记录条数，0..records.length */
  appliedCount: number
  /** 当前选区：操作后由序列推导，两次操作之间可被拖拽修改（拖拽不产生历史） */
  selection: Selection
  /** 音频加载时的初始选区，撤销到 0 条记录时回到这里 */
  initialSelection: Selection
  /** 跳转（含撤销/重做动画）是否进行中；进行中的一切操作都被忽略 */
  jumpStatus: JumpStatus
  /** 进行中的跳转目标（appliedCount 目标值） */
  pendingCount: number | null
}
