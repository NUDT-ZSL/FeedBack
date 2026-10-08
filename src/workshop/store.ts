/**
 * 统一可追溯状态来源：操作日志（event log）+ 物化视图。
 *
 * 工序推进、材料领用、修复记录三个模块不再各自维护状态，全部通过
 * commit() 把操作追加到同一条日志，再由同一组物化函数推导出：
 *   - 每册书的当前工序与工序历史
 *   - 每种材料的余量（领用/退回收支账）
 *   - 每条修复记录及记录条数
 *
 * 一致性保证：
 * 1. 所有写入串行落账，读取只来自同一份已提交日志；
 * 2. opId 幂等：重复提交不会重复扣减；
 * 3. baseVersion 乐观并发：版本不匹配时操作不生效、冲突完整留痕，
 *    当前有效状态始终可由日志确定性回放得到；
 * 4. 材料余量由收支事件推导，工序来回切换不会丢失或重复扣减。
 */
import {
  PROCESS_STAGES,
  type BookInfo,
  type BookSnapshot,
  type CommitResult,
  type ConflictRecord,
  type MaterialMovementView,
  type MaterialView,
  type OperationRequest,
  type ProcessStage,
  type RejectionRecord,
  type RepairRecordView,
  type StageTransitionView,
  type WorkshopEvent,
} from './types.js'

interface MaterialState extends MaterialView {
  movements: MaterialMovementView[]
}

interface BookState {
  info: BookInfo
  version: number
  currentStage: ProcessStage | null
  history: StageTransitionView[]
  records: RepairRecordView[]
  conflicts: ConflictRecord[]
  rejections: RejectionRecord[]
}

interface SeedOptions {
  books?: BookInfo[]
  materials?: Array<{ id: string; name: string; unit: string; total: number }>
}

let clockSeq = 0

export class WorkshopStore {
  private events: WorkshopEvent[] = []
  private appliedOpIds = new Map<string, CommitResult>()
  private books = new Map<string, BookState>()
  private materials = new Map<string, MaterialState>()

  constructor(events: WorkshopEvent[] = []) {
    for (const event of events) {
      this.apply(event)
      // 回放的历史事件同样登记幂等键，避免持久化后重复落账
      this.appliedOpIds.set(event.opId, {
        status: 'applied',
        opId: event.opId,
        bookId: event.bookId,
        version: event.bookVersion,
      })
    }
  }

  /** 预置古籍与材料（幂等，便于服务启动与测试） */
  seed(options: SeedOptions): void {
    for (const book of options.books ?? []) {
      if (!this.books.has(book.id)) {
        this.apply({
          opId: `seed-book-${book.id}`,
          bookId: book.id,
          at: 0,
          bookVersion: 0,
          payload: { type: 'book.register', title: book.title },
        })
      }
    }
    for (const material of options.materials ?? []) {
      if (!this.materials.has(material.id)) {
        this.apply({
          opId: `seed-material-${material.id}`,
          bookId: '*',
          at: 0,
          bookVersion: 0,
          payload: {
            type: 'material.define',
            materialId: material.id,
            name: material.name,
            unit: material.unit,
            total: material.total,
          },
        })
      }
    }
  }

  /** 完整操作日志（迁移与离线校验按序回放的依据） */
  getEvents(): readonly WorkshopEvent[] {
    return this.events
  }

  /** 提交一次操作。迁移场景传 unconditional=true 跳过版本校验 */
  commit(request: OperationRequest, unconditional = false): CommitResult {
    const existing = this.appliedOpIds.get(request.opId)
    if (existing) return { ...existing, status: 'duplicate' }

    const at = request.at ?? Date.now() + clockSeq++
    const book = this.books.get(request.bookId)
    if (!book) return this.reject(request, at, 'unknown book')

    if (
      !unconditional &&
      request.baseVersion !== undefined &&
      request.baseVersion !== book.version
    ) {
      const conflict: ConflictRecord = {
        opId: request.opId,
        bookId: request.bookId,
        expectedVersion: request.baseVersion,
        actualVersion: book.version,
        payload: request.payload,
        at,
      }
      book.conflicts.push(conflict)
      const result: CommitResult = {
        status: 'conflict',
        opId: request.opId,
        bookId: request.bookId,
        version: book.version,
        reason: `baseVersion ${request.baseVersion} != current ${book.version}`,
      }
      this.appliedOpIds.set(request.opId, result)
      return result
    }

    const validateError = this.validate(request)
    if (validateError) {
      book.rejections.push({
        opId: request.opId,
        bookId: request.bookId,
        reason: validateError,
        payload: request.payload,
        at,
      })
      const result: CommitResult = {
        status: 'rejected',
        opId: request.opId,
        bookId: request.bookId,
        version: book.version,
        reason: validateError,
      }
      this.appliedOpIds.set(request.opId, result)
      return result
    }

    const event: WorkshopEvent = {
      opId: request.opId,
      bookId: request.bookId,
      at,
      bookVersion: book.version + 1,
      payload: this.toEventPayload(request.payload),
    }
    this.apply(event)
    const result: CommitResult = {
      status: 'applied',
      opId: request.opId,
      bookId: request.bookId,
      version: book.version,
    }
    this.appliedOpIds.set(request.opId, result)
    return result
  }

  /** 直接追加一条迁移事件（无条件，用于历史数据迁移） */
  replay(event: WorkshopEvent): void {
    if (this.appliedOpIds.has(event.opId)) return
    this.apply(event)
  }

  private toEventPayload(payload: OperationRequest['payload']): WorkshopEvent['payload'] {
    if (payload.type === 'record.append') {
      return {
        type: 'record.append',
        recordId: payload.recordId ?? `record-${Date.now()}-${clockSeq++}`,
        stage: payload.stage,
        content: payload.content,
      }
    }
    return payload
  }

  private validate(request: OperationRequest): string | null {
    const { payload } = request
    switch (payload.type) {
      case 'process.advance': {
        if (!PROCESS_STAGES.includes(payload.to)) return `unknown stage ${payload.to}`
        return null
      }
      case 'material.checkout':
      case 'material.return': {
        const material = this.materials.get(payload.materialId)
        if (!material) return `unknown material ${payload.materialId}`
        if (!(payload.quantity > 0)) return 'quantity must be positive'
        if (payload.type === 'material.checkout' && material.remaining < payload.quantity) {
          return `insufficient balance: ${material.remaining} < ${payload.quantity}`
        }
        const consumed = this.consumedByBook(payload.materialId, request.bookId)
        if (payload.type === 'material.return' && consumed < payload.quantity) {
          return `return exceeds checked-out quantity: ${consumed} < ${payload.quantity}`
        }
        return null
      }
      case 'record.append': {
        if (!payload.content.trim()) return 'record content is empty'
        return null
      }
      default:
        return 'unsupported operation'
    }
  }

  /** 某册书已领用且未退回的材料数量（退回不允许超过它） */
  private consumedByBook(materialId: string, bookId: string): number {
    const material = this.materials.get(materialId)
    if (!material) return 0
    return material.movements
      .filter((movement) => movement.bookId === bookId)
      .reduce((sum, movement) => sum - movement.delta, 0)
  }

  private apply(event: WorkshopEvent): void {
    const { payload } = event
    switch (payload.type) {
      case 'book.register': {
        if (!this.books.has(event.bookId)) {
          this.books.set(event.bookId, {
            info: { id: event.bookId, title: payload.title },
            version: 0,
            currentStage: null,
            history: [],
            records: [],
            conflicts: [],
            rejections: [],
          })
        }
        break
      }
      case 'material.define': {
        if (!this.materials.has(payload.materialId)) {
          this.materials.set(payload.materialId, {
            id: payload.materialId,
            name: payload.name,
            unit: payload.unit,
            total: payload.total,
            remaining: payload.total,
            movements: [],
          })
        }
        break
      }
      case 'process.advance': {
        const book = this.requireBook(event.bookId)
        const transition: StageTransitionView = {
          from: book.currentStage,
          to: payload.to,
          at: event.at,
          opId: event.opId,
        }
        book.history.push(transition)
        book.currentStage = payload.to
        book.version = event.bookVersion
        break
      }
      case 'material.checkout':
      case 'material.return': {
        const material = this.requireMaterial(payload.materialId)
        const delta = payload.type === 'material.checkout' ? -payload.quantity : payload.quantity
        material.remaining += delta
        material.movements.push({
          materialId: payload.materialId,
          bookId: event.bookId,
          stage: payload.stage,
          delta,
          kind: payload.type === 'material.checkout' ? 'checkout' : 'return',
          at: event.at,
          opId: event.opId,
        })
        this.requireBook(event.bookId).version = event.bookVersion
        break
      }
      case 'material.adjust': {
        const material = this.requireMaterial(payload.materialId)
        material.remaining += payload.delta
        material.movements.push({
          materialId: payload.materialId,
          bookId: event.bookId,
          stage: '清点',
          delta: payload.delta,
          kind: 'migration',
          at: event.at,
          opId: event.opId,
        })
        break
      }
      case 'record.append': {
        const book = this.requireBook(event.bookId)
        book.records.push({
          id: payload.recordId,
          bookId: event.bookId,
          stage: payload.stage,
          content: payload.content,
          at: event.at,
        })
        book.version = event.bookVersion
        break
      }
    }
  }

  private requireBook(bookId: string): BookState {
    const book = this.books.get(bookId)
    if (!book) throw new Error(`unknown book ${bookId}`)
    return book
  }

  private requireMaterial(materialId: string): MaterialState {
    const material = this.materials.get(materialId)
    if (!material) throw new Error(`unknown material ${materialId}`)
    return material
  }

  private reject(request: OperationRequest, at: number, reason: string): CommitResult {
    return {
      status: 'rejected',
      opId: request.opId,
      bookId: request.bookId,
      version: 0,
      reason,
    }
  }

  // ---- 三个模块的只读视图（同一日志的不同投影） ----

  /** 工序模块：读取某册书的工序进度 */
  getProgress(bookId: string) {
    const book = this.requireBook(bookId)
    return this.toProgressView(book)
  }

  /** 材料模块：读取材料清单与某册书的领用流水 */
  getMaterials(bookId?: string): MaterialView[] {
    const views: MaterialView[] = []
    for (const material of this.materials.values()) {
      if (bookId !== undefined && !material.movements.some((m) => m.bookId === bookId)) continue
      views.push({
        id: material.id,
        name: material.name,
        unit: material.unit,
        total: material.total,
        remaining: material.remaining,
      })
    }
    return views
  }

  getMaterial(materialId: string): MaterialView {
    const material = this.requireMaterial(materialId)
    return {
      id: material.id,
      name: material.name,
      unit: material.unit,
      total: material.total,
      remaining: material.remaining,
    }
  }

  getMovements(bookId?: string): MaterialMovementView[] {
    const movements: MaterialMovementView[] = []
    for (const material of this.materials.values()) {
      movements.push(...material.movements)
    }
    movements.sort((a, b) => a.at - b.at)
    return bookId === undefined ? movements : movements.filter((m) => m.bookId === bookId)
  }

  /** 修复记录模块：读取某册书的记录 */
  getRecords(bookId: string): RepairRecordView[] {
    return [...this.requireBook(bookId).records]
  }

  getRecordCount(bookId: string): number {
    return this.requireBook(bookId).records.length
  }

  getConflicts(bookId: string): ConflictRecord[] {
    return [...this.requireBook(bookId).conflicts]
  }

  getRejections(bookId: string): RejectionRecord[] {
    return [...this.requireBook(bookId).rejections]
  }

  listBooks(): BookInfo[] {
    return [...this.books.values()].map((book) => ({ ...book.info }))
  }

  private toProgressView(book: BookState) {
    return {
      bookId: book.info.id,
      title: book.info.title,
      currentStage: book.currentStage,
      completedStages: book.currentStage ? PROCESS_STAGES.indexOf(book.currentStage) : 0,
      totalStages: PROCESS_STAGES.length,
      history: [...book.history],
    }
  }

  /** 三模块一致性快照：各入口的读取结果必须与此相等 */
  getBookSnapshot(bookId: string): BookSnapshot {
    const book = this.requireBook(bookId)
    return {
      version: book.version,
      progress: this.toProgressView(book),
      materials: this.getMaterials(),
      recordCount: book.records.length,
      conflicts: [...book.conflicts],
    }
  }
}

/** 进程内单例：Express 路由与未来其它模块共享同一状态来源 */
let singleton: WorkshopStore | null = null

export function getWorkshopStore(): WorkshopStore {
  if (!singleton) {
    singleton = new WorkshopStore()
    singleton.seed({
      books: [
        { id: 'book-001', title: '山海经' },
        { id: 'book-002', title: '水经注' },
      ],
      materials: [
        { id: 'mat-paper', name: '宣纸', unit: '张', total: 100 },
        { id: 'mat-paste', name: '糨糊', unit: '克', total: 500 },
        { id: 'mat-thread', name: '装订线', unit: '米', total: 50 },
      ],
    })
  }
  return singleton
}

export function resetWorkshopStore(store?: WorkshopStore): WorkshopStore {
  singleton = store ?? new WorkshopStore()
  return singleton
}
