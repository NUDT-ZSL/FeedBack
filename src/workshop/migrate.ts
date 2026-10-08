/**
 * 历史数据迁移：把旧架构下分散在三个模块里的快照收敛到统一操作日志。
 *
 * 旧数据形态（各模块各自维护、互不对齐）：
 *   - 工序模块：每册书当前工序 + 切换历史
 *   - 材料模块：材料总量/余量 + 各册领用流水（领用为负、退回为正）
 *   - 记录模块：每册书的修复记录列表
 *
 * 迁移策略：把三份数据里的事实统一转成带时间戳的事件，按时间归并后
 * 确定性回放进 WorkshopStore；若旧材料流水之和与其记录的余量对不上，
 * 以旧模块展示的余量为准补一条 migration 校正事件，并在校验报告中标出，
 * 保证迁移后各模块读到的结果与迁移前一致。
 */
import {
  PROCESS_STAGES,
  type BookInfo,
  type MaterialView,
  type ProcessStage,
  type RepairRecordView,
  type WorkshopEvent,
} from './types.js'
import { WorkshopStore } from './store.js'

export interface LegacyProcessModule {
  books: Record<
    string,
    {
      title: string
      currentStage: ProcessStage | null
      history: Array<{ from: ProcessStage | null; to: ProcessStage; at: number }>
    }
  >
}

export interface LegacyMaterialModule {
  materials: Record<
    string,
    {
      name: string
      unit: string
      total: number
      remaining: number
      transactions: Array<{
        id: string
        bookId: string
        stage: ProcessStage
        /** 领用为负、退回为正 */
        quantity: number
        at: number
      }>
    }
  >
}

export interface LegacyRecordModule {
  records: Record<
    string,
    Array<{ id: string; stage: ProcessStage; content: string; at: number }>
  >
}

export interface LegacyState {
  process: LegacyProcessModule
  material: LegacyMaterialModule
  records: LegacyRecordModule
}

export interface MigrationMismatch {
  kind: 'material.balance' | 'process.stage'
  targetId: string
  legacyValue: string | number | null
  migratedValue: string | number | null
}

export interface MigrationReport {
  store: WorkshopStore
  events: WorkshopEvent[]
  mismatches: MigrationMismatch[]
  migratedAt: number
}

export function migrateLegacyState(
  legacy: LegacyState,
  migratedAt = Date.now(),
): MigrationReport {
  const store = new WorkshopStore()
  const events: WorkshopEvent[] = []
  const bookOrder: BookInfo[] = []

  for (const [bookId, book] of Object.entries(legacy.process.books)) {
    bookOrder.push({ id: bookId, title: book.title })
    events.push({
      opId: `migrate-book-${bookId}`,
      bookId,
      at: 0,
      bookVersion: 0,
      payload: { type: 'book.register', title: book.title },
    })
  }

  for (const [materialId, material] of Object.entries(legacy.material.materials)) {
    events.push({
      opId: `migrate-material-${materialId}`,
      bookId: '*',
      at: 0,
      bookVersion: 0,
      payload: {
        type: 'material.define',
        materialId,
        name: material.name,
        unit: material.unit,
        total: material.total,
      },
    })
  }

  // 三模块事实按时间归并，保持确定的先后顺序
  const versionCounters: Record<string, number> = {}
  const nextVersion = (bookId: string) => {
    versionCounters[bookId] = (versionCounters[bookId] ?? 0) + 1
    return versionCounters[bookId]
  }

  const timed: Array<{ at: number; seq: number; event: WorkshopEvent }> = []
  let seq = 0

  for (const [bookId, book] of Object.entries(legacy.process.books)) {
    book.history.forEach((transition, index) => {
      timed.push({
        at: transition.at,
        seq: seq++,
        event: {
          opId: `migrate-${bookId}-stage-${index}-${transition.at}`,
          bookId,
          at: transition.at,
          bookVersion: 0,
          payload: { type: 'process.advance', to: transition.to },
        },
      })
    })
  }

  for (const [materialId, material] of Object.entries(legacy.material.materials)) {
    for (const tx of material.transactions) {
      const type = tx.quantity < 0 ? 'material.checkout' : 'material.return'
      timed.push({
        at: tx.at,
        seq: seq++,
        event: {
          opId: `migrate-tx-${tx.id}`,
          bookId: tx.bookId,
          at: tx.at,
          bookVersion: 0,
          payload: {
            type,
            materialId,
            stage: tx.stage,
            quantity: Math.abs(tx.quantity),
          },
        } as WorkshopEvent,
      })
    }
  }

  for (const [bookId, list] of Object.entries(legacy.records.records)) {
    for (const record of list) {
      timed.push({
        at: record.at,
        seq: seq++,
        event: {
          opId: `migrate-record-${record.id}`,
          bookId,
          at: record.at,
          bookVersion: 0,
          payload: {
            type: 'record.append',
            recordId: record.id,
            stage: record.stage,
            content: record.content,
          },
        },
      })
    }
  }

  timed.sort((a, b) => a.at - b.at || a.seq - b.seq)
  for (const item of timed) {
    if (item.event.bookId !== '*') item.event.bookVersion = nextVersion(item.event.bookId)
    events.push(item.event)
  }

  // 先回放全部事实
  for (const event of events) store.replay(event)

  const mismatches: MigrationMismatch[] = []

  // 材料余量核对：流水推导出的余量必须与旧模块记录一致，否则校正
  for (const [materialId, material] of Object.entries(legacy.material.materials)) {
    const migrated: MaterialView = store.getMaterial(materialId)
    if (migrated.remaining !== material.remaining) {
      const delta = material.remaining - migrated.remaining
      const correction: WorkshopEvent = {
        opId: `migrate-correction-${materialId}`,
        bookId: '*',
        at: migratedAt,
        bookVersion: 0,
        payload: {
          type: 'material.adjust',
          materialId,
          delta,
          reason: 'legacy balance reconciliation',
        },
      }
      store.replay(correction)
      events.push(correction)
      mismatches.push({
        kind: 'material.balance',
        targetId: materialId,
        legacyValue: material.remaining,
        migratedValue: migrated.remaining,
      })
    }
  }

  // 工序核对：历史回放后的当前工序必须与旧模块一致
  for (const [bookId, book] of Object.entries(legacy.process.books)) {
    const progress = store.getProgress(bookId)
    if (progress.currentStage !== book.currentStage) {
      const stage = book.currentStage ?? PROCESS_STAGES[0]
      const correction: WorkshopEvent = {
        opId: `migrate-${bookId}-stage-reconcile`,
        bookId,
        at: migratedAt,
        bookVersion: nextVersion(bookId),
        payload: { type: 'process.advance', to: stage },
      }
      store.replay(correction)
      events.push(correction)
      mismatches.push({
        kind: 'process.stage',
        targetId: bookId,
        legacyValue: book.currentStage,
        migratedValue: progress.currentStage,
      })
    }
  }

  return { store, events, mismatches, migratedAt }
}

/** 断言迁移结果与迁移前三模块快照完全一致（离线校验调用） */
export function assertMigrationParity(
  legacy: LegacyState,
  report: MigrationReport,
): void {
  const { store } = report
  for (const bookId of Object.keys(legacy.process.books)) {
    const legacyBook = legacy.process.books[bookId]
    const progress = store.getProgress(bookId)
    if (progress.currentStage !== legacyBook.currentStage) {
      throw new Error(`migrate parity: stage mismatch for ${bookId}`)
    }
    const legacyRecords: RepairRecordView[] = (legacy.records.records[bookId] ?? [])
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((record) => ({ bookId, ...record }))
    const migratedRecords = store.getRecords(bookId)
    if (migratedRecords.length !== legacyRecords.length) {
      throw new Error(`migrate parity: record count mismatch for ${bookId}`)
    }
    legacyRecords.forEach((record, index) => {
      const migrated = migratedRecords[index]
      if (
        migrated.id !== record.id ||
        migrated.content !== record.content ||
        migrated.stage !== record.stage
      ) {
        throw new Error(`migrate parity: record mismatch for ${bookId}`)
      }
    })
  }
  for (const materialId of Object.keys(legacy.material.materials)) {
    const legacyMaterial = legacy.material.materials[materialId]
    const migrated = store.getMaterial(materialId)
    if (migrated.remaining !== legacyMaterial.remaining) {
      throw new Error(`migrate parity: material balance mismatch for ${materialId}`)
    }
  }
}
