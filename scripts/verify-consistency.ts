/**
 * 离线一致性验证入口（无需启动服务）：
 *   npx tsx scripts/verify-consistency.ts
 *   或 npm run verify:consistency
 *
 * 覆盖场景：
 *   1. 工序来回切换 —— 进度/材料/记录三模块读取一致，切换不丢账
 *   2. 材料重复领用与退回 —— 幂等重试不重复扣减，余量可还原
 *   3. 并发/连续冲突操作 —— 不静默择一，冲突留痕且有效状态可判定
 *   4. 历史数据迁移 —— 迁移后各模块读取结果与迁移前一致
 */
import assert from 'node:assert/strict'
import { WorkshopStore } from '../src/workshop/store.js'
import {
  assertMigrationParity,
  migrateLegacyState,
  type LegacyState,
} from '../src/workshop/migrate.js'
import type { BookSnapshot, OperationRequest } from '../src/workshop/types.js'

let passed = 0

function scenario(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`  ✔ ${name}`)
  } catch (error) {
    console.error(`  ✘ ${name}`)
    throw error
  }
}

/** 三模块读取结果必须与统一快照完全一致 */
function assertCrossModuleConsistency(store: WorkshopStore, bookId: string): BookSnapshot {
  const snapshot = store.getBookSnapshot(bookId)
  assert.deepEqual(store.getProgress(bookId), snapshot.progress, 'progress view diverged')
  assert.deepEqual(store.getMaterials(), snapshot.materials, 'material view diverged')
  assert.equal(store.getRecordCount(bookId), snapshot.recordCount, 'record count diverged')
  assert.deepEqual(store.getRecords(bookId).length, snapshot.recordCount)
  assert.deepEqual(store.getConflicts(bookId), snapshot.conflicts, 'conflict view diverged')
  return snapshot
}

function op(
  opId: string,
  bookId: string,
  payload: OperationRequest['payload'],
  baseVersion?: number,
  at?: number,
): OperationRequest {
  return { opId, bookId, payload, baseVersion, at }
}

const BOOK = 'book-A'
const PAPER = 'mat-paper'

function makeStore(): WorkshopStore {
  const store = new WorkshopStore()
  store.seed({
    books: [{ id: BOOK, title: '山海经' }],
    materials: [{ id: PAPER, name: '宣纸', unit: '张', total: 10 }],
  })
  return store
}

console.log('古籍修复工坊 · 状态一致性离线验证')

scenario('场景1：工序来回切换，三模块读取一致且材料账目不受影响', () => {
  const store = makeStore()
  assert.equal(store.commit(op('op-1', BOOK, { type: 'process.advance', to: '清点' }, undefined, 1000)).status, 'applied')
  assert.equal(store.commit(op('op-2', BOOK, { type: 'material.checkout', materialId: PAPER, stage: '清点', quantity: 3 }, 1, 1001)).status, 'applied')
  assert.equal(store.commit(op('op-3', BOOK, { type: 'record.append', stage: '清点', content: '清点完毕，虫蛀三级', recordId: 'rec-1' }, 2, 1002)).status, 'applied')

  // 来回切换：除尘 → 修补 → 退回除尘 → 再进修补
  for (const [id, stage, version, at] of [
    ['op-4', '除尘', 3, 1003],
    ['op-5', '修补', 4, 1004],
    ['op-6', '除尘', 5, 1005],
    ['op-7', '修补', 6, 1006],
  ] as const) {
    assert.equal(store.commit(op(id, BOOK, { type: 'process.advance', to: stage }, version, at)).status, 'applied')
  }

  const snapshot = assertCrossModuleConsistency(store, BOOK)
  assert.equal(snapshot.progress.currentStage, '修补')
  assert.equal(snapshot.progress.history.length, 5)
  assert.deepEqual(
    snapshot.progress.history.map((h) => [h.from, h.to]),
    [
      [null, '清点'],
      ['清点', '除尘'],
      ['除尘', '修补'],
      ['修补', '除尘'],
      ['除尘', '修补'],
    ],
  )
  // 工序切换不触发任何材料扣减/记录变更
  assert.equal(snapshot.materials.find((m) => m.id === PAPER)?.remaining, 7)
  assert.equal(snapshot.recordCount, 1)
  assert.equal(snapshot.version, 7)
})

scenario('场景2：材料重复领用退回 + 幂等重试，余量精确还原', () => {
  const store = makeStore()
  store.commit(op('op-1', BOOK, { type: 'process.advance', to: '修补' }, undefined, 1000))

  const checkout = (id: string, qty: number, version: number, at: number) =>
    store.commit(op(id, BOOK, { type: 'material.checkout', materialId: PAPER, stage: '修补', quantity: qty }, version, at))
  const giveBack = (id: string, qty: number, version: number, at: number) =>
    store.commit(op(id, BOOK, { type: 'material.return', materialId: PAPER, stage: '修补', quantity: qty }, version, at))

  assert.equal(checkout('op-2', 3, 1, 1001).status, 'applied')
  assert.equal(checkout('op-3', 2, 2, 1002).status, 'applied')
  assert.equal(giveBack('op-4', 1, 3, 1003).status, 'applied')

  // 网络重试/工序切换导致的重复提交：同一 opId 不得重复扣减
  const retry = checkout('op-2', 3, 1, 1004)
  assert.equal(retry.status, 'duplicate')
  assert.equal(store.getMaterial(PAPER).remaining, 6)

  // 工序切换后继续领用，账目连续
  store.commit(op('op-5', BOOK, { type: 'process.advance', to: '装订' }, 4, 1005))
  assert.equal(checkout('op-6', 4, 5, 1006).status, 'applied')

  // 余量不足被拒绝且不产生半落账
  const overdraw = checkout('op-7', 100, 6, 1007)
  assert.equal(overdraw.status, 'rejected')
  assert.equal(store.getMaterial(PAPER).remaining, 2)

  // 退回不得超过已领用量
  const overReturn = giveBack('op-8', 99, 6, 1008)
  assert.equal(overReturn.status, 'rejected')

  // 全部退回后余量还原
  assert.equal(giveBack('op-9', 8, 6, 1009).status, 'applied')
  const snapshot = assertCrossModuleConsistency(store, BOOK)
  assert.equal(snapshot.materials.find((m) => m.id === PAPER)?.remaining, 10)
  // 收支流水完整可追溯：3 次领用 + 2 次退回
  const movements = store.getMovements(BOOK)
  assert.equal(movements.filter((m) => m.kind === 'checkout').length, 3)
  assert.equal(movements.filter((m) => m.kind === 'return').length, 2)
  assert.equal(movements.reduce((sum, m) => sum + m.delta, 0), 0)
})

scenario('场景3：并发冲突操作不静默覆盖，冲突留痕且有效状态可判定', () => {
  const store = makeStore()
  store.commit(op('op-1', BOOK, { type: 'process.advance', to: '清点' }, undefined, 1000))

  // 两个入口同时基于 version=1 提交推进：先到先生效，后到记为冲突
  const first = store.commit(op('op-2', BOOK, { type: 'process.advance', to: '除尘' }, 1, 1001))
  const second = store.commit(op('op-3', BOOK, { type: 'process.advance', to: '装订' }, 1, 1002))
  assert.equal(first.status, 'applied')
  assert.equal(second.status, 'conflict')

  // 材料领用同样受版本保护
  const staleCheckout = store.commit(
    op('op-4', BOOK, { type: 'material.checkout', materialId: PAPER, stage: '除尘', quantity: 5 }, 1, 1003),
  )
  assert.equal(staleCheckout.status, 'conflict')

  const snapshot = assertCrossModuleConsistency(store, BOOK)
  // 当前有效状态确定：只有 first 生效
  assert.equal(snapshot.progress.currentStage, '除尘')
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.materials.find((m) => m.id === PAPER)?.remaining, 10)
  // 冲突痕迹完整保留，可回溯
  assert.equal(snapshot.conflicts.length, 2)
  assert.equal(snapshot.conflicts[0].opId, 'op-3')
  assert.equal(snapshot.conflicts[0].expectedVersion, 1)
  assert.equal(snapshot.conflicts[0].actualVersion, 2)
  assert.equal(snapshot.conflicts[1].opId, 'op-4')
  // 冲突方基于最新版本重提后可生效
  const retried = store.commit(op('op-5', BOOK, { type: 'process.advance', to: '装订' }, 2, 1004))
  assert.equal(retried.status, 'applied')
  assert.equal(store.getBookSnapshot(BOOK).progress.currentStage, '装订')
})

scenario('场景4：历史数据迁移到统一状态来源，结果与迁移前一致', () => {
  const legacy: LegacyState = {
    process: {
      books: {
        'book-L1': {
          title: '水经注',
          currentStage: '修补',
          history: [
            { from: null, to: '清点', at: 100 },
            { from: '清点', to: '除尘', at: 200 },
            { from: '除尘', to: '修补', at: 300 },
          ],
        },
        'book-L2': {
          title: '论语',
          currentStage: '除尘',
          history: [
            { from: null, to: '清点', at: 150 },
            { from: '清点', to: '除尘', at: 250 },
          ],
        },
      },
    },
    material: {
      materials: {
        'mat-paper': {
          name: '宣纸',
          unit: '张',
          total: 50,
          // 流水推导余量为 41，旧材料模块记录为 38（旧架构对不上账的典型数据）
          remaining: 38,
          transactions: [
            { id: 'tx-1', bookId: 'book-L1', stage: '修补', quantity: -5, at: 210 },
            { id: 'tx-2', bookId: 'book-L2', stage: '除尘', quantity: -3, at: 260 },
            { id: 'tx-3', bookId: 'book-L1', stage: '修补', quantity: 2, at: 280 },
            { id: 'tx-4', bookId: 'book-L1', stage: '修补', quantity: -3, at: 290 },
          ],
        },
      },
    },
    records: {
      records: {
        'book-L1': [
          { id: 'rec-1', stage: '清点', content: '册页残缺三处', at: 120 },
          { id: 'rec-2', stage: '修补', content: '补纸两张', at: 310 },
        ],
        'book-L2': [{ id: 'rec-3', stage: '除尘', content: '除尘完成', at: 270 }],
      },
    },
  }

  const report = migrateLegacyState(legacy, 9999)
  assertMigrationParity(legacy, report)

  // 旧模块材料余量与流水不符处被校正且留痕
  assert.equal(report.mismatches.length, 1)
  assert.equal(report.mismatches[0].kind, 'material.balance')
  assert.equal(report.mismatches[0].targetId, 'mat-paper')
  assert.equal(report.store.getMaterial('mat-paper').remaining, 38)
  const corrections = report.store.getMovements().filter((m) => m.kind === 'migration')
  assert.equal(corrections.length, 1)

  // 迁移后的统一来源上，三模块读取一致且可继续正常操作
  const snapshot = assertCrossModuleConsistency(report.store, 'book-L1')
  assert.equal(snapshot.progress.currentStage, '修补')
  assert.equal(snapshot.recordCount, 2)
  const continued = report.store.commit(
    op('op-new-1', 'book-L1', { type: 'record.append', stage: '修补', content: '迁移后首条记录' }, snapshot.version, 10000),
  )
  assert.equal(continued.status, 'applied')
  assert.equal(report.store.getRecordCount('book-L1'), 3)
})

console.log(`\n全部 ${passed} 个场景验证通过：三模块读取一致、冲突可追溯、材料账目可还原。`)
