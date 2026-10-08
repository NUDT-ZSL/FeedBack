/**
 * 离线批量验证入口：npm run verify
 *
 * 覆盖三类一致性风险场景并断言各模块读取结果一致：
 * 1. 工序来回切换 —— 进度、切换轨迹、版本号在工序/材料/记录模块间一致；
 * 2. 材料重复领用退回 —— 余量可还原，幂等重试不重复扣减，越界操作被拒绝；
 * 3. 冲突操作保留 —— 并发/连续冲突不静默覆盖，冲突可追溯，有效状态可判定；
 * 4. 历史数据迁移 —— 迁移到统一状态来源后，各模块读取结果与迁移前一致。
 *
 * 该脚本不依赖服务进程与浏览器，直接对领域核心批量执行操作并断言。
 */

import {
  BOOKS,
  MATERIALS,
  STAGES,
  WorkshopStore,
  migrateLegacyState,
  type LegacyWorkshopState,
  type Operation,
  type WorkshopSnapshot,
} from '../src/domain/workshop/index';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

function makeStore(): WorkshopStore {
  return new WorkshopStore({ stages: STAGES, books: BOOKS, materials: MATERIALS });
}

type DistributiveOmit<T, K extends keyof never | string> = T extends unknown ? Omit<T, K> : never;
type OpDraft = DistributiveOmit<Operation, 'opId'> & { opId?: string };

let opSeq = 0;
function op(partial: OpDraft): Operation {
  opSeq += 1;
  return { opId: `verify-op-${opSeq}`, ...partial } as Operation;
}

/** 跨模块一致性：直接从日志独立重算，与各模块视图逐一比对 */
function assertCrossModuleConsistency(store: WorkshopStore, label: string): void {
  const snapshot: WorkshopSnapshot = store.getSnapshot();
  const journal = snapshot.journal.filter((e) => e.status === 'applied');

  // 工序模块：每册书版本号 = 该册生效操作数；当前工序 = 最后一次推进目标
  for (const progress of snapshot.progress) {
    const bookOps = journal.filter((e) => e.op.bookId === progress.bookId);
    check(`${label}：${progress.bookId} 版本号与生效操作数一致`, progress.version === bookOps.length,
      `version=${progress.version} applied=${bookOps.length}`);
    const advances = bookOps.filter((e) => e.op.kind === 'advance_stage');
    const expectedStage = advances.length ? (advances[advances.length - 1].op as { toStageId: string }).toStageId : null;
    check(`${label}：${progress.bookId} 当前工序与日志最后推进一致`, progress.currentStageId === expectedStage,
      `view=${progress.currentStageId} journal=${expectedStage}`);
    check(`${label}：${progress.bookId} 切换轨迹条数与推进操作数一致`, progress.transitions.length === advances.length);
  }

  // 材料模块：余量 = 初始库存 - 生效领用 + 生效退回（独立重算）
  for (const material of snapshot.materials) {
    let expected = material.initialStock;
    for (const entry of journal) {
      if (entry.op.kind === 'requisition_material' && entry.op.materialId === material.materialId) expected -= entry.op.quantity;
      if (entry.op.kind === 'return_material' && entry.op.materialId === material.materialId) expected += entry.op.quantity;
    }
    check(`${label}：材料「${material.name}」余量与日志重算一致`, material.balance === expected,
      `view=${material.balance} replay=${expected}`);
  }

  // 记录模块：记录条数 = 生效的 add_record 操作数
  const recordOps = journal.filter((e) => e.op.kind === 'add_record');
  check(`${label}：修复记录条数与生效记录操作一致`, snapshot.records.length === recordOps.length,
    `view=${snapshot.records.length} journal=${recordOps.length}`);

  // 物化状态与日志重放一致
  check(`${label}：物化状态与日志重放一致`, store.checkMaterializedMatchesJournal());
}

/* ---------- 场景 1：工序来回切换 ---------- */
function scenarioStageSwitching(): void {
  console.log('\n[场景 1] 工序来回切换');
  const store = makeStore();
  const bookId = BOOKS[0].id;
  const path = ['inspect', 'mend', 'complete', 'mend', 'inspect', 'mend'];

  for (const toStageId of path) {
    const version = store.getProgress(bookId).version;
    const result = store.submit(op({ kind: 'advance_stage', bookId, expectedVersion: version, actor: '拓印师甲', toStageId }));
    check(`推进到 ${toStageId} 生效`, result.status === 'applied', JSON.stringify(result));
  }

  const progress = store.getProgress(bookId);
  check('来回切换后当前工序正确', progress.currentStageId === 'mend');
  check('切换轨迹完整保留（含回退）', progress.transitions.length === path.length);
  check('轨迹记录回退来源', progress.transitions[3].fromStageId === 'complete' && progress.transitions[3].toStageId === 'mend');

  // 工序切换不影响材料余量与记录
  check('工序切换后材料余量保持初始值', store.getMaterials().every((m) => m.balance === m.initialStock));
  check('工序切换不产生修复记录', store.getRecords(bookId).length === 0);

  assertCrossModuleConsistency(store, '场景1');
}

/* ---------- 场景 2：材料重复领用与退回 ---------- */
function scenarioMaterialLedger(): void {
  console.log('\n[场景 2] 材料重复领用退回');
  const store = makeStore();
  const bookId = BOOKS[1].id;
  const paper = MATERIALS[0]; // 宣纸 100 张

  const submitMaterial = (kind: 'requisition_material' | 'return_material', quantity: number, opId?: string) =>
    store.submit(op({ kind, bookId, expectedVersion: store.getProgress(bookId).version, actor: '拓印师乙', materialId: paper.id, quantity, ...(opId ? { opId } : {}) }));

  check('领用 10 生效', submitMaterial('requisition_material', 10).status === 'applied');
  check('再领用 5 生效', submitMaterial('requisition_material', 5).status === 'applied');
  check('退回 4 生效', submitMaterial('return_material', 4).status === 'applied');

  let balance = store.getMaterials().find((m) => m.materialId === paper.id)!;
  check('多次领用退回后余量正确 (100-10-5+4=89)', balance.balance === 89, `balance=${balance.balance}`);

  // 同一 opId 重复提交（网络重试/双击）：幂等，不重复扣减
  const first = submitMaterial('requisition_material', 7, 'verify-retry-1');
  const versionBefore = store.getProgress(bookId).version;
  const retry = store.submit(op({ kind: 'requisition_material', bookId, expectedVersion: first.status === 'applied' ? first.entry.op.expectedVersion : 0, actor: '拓印师乙', materialId: paper.id, quantity: 7, opId: 'verify-retry-1' }));
  check('重复提交返回 duplicate', retry.status === 'duplicate');
  check('重复提交不重复扣减', store.getMaterials().find((m) => m.materialId === paper.id)!.balance === 82);
  check('重复提交不推进版本', store.getProgress(bookId).version === versionBefore);

  // 越界操作被拒绝且不改状态
  const overReturn = submitMaterial('return_material', 999);
  check('超出未归还量的退回被拒绝', overReturn.status === 'rejected');
  const overDraw = submitMaterial('requisition_material', 1000);
  check('超出库存的领用被拒绝', overDraw.status === 'rejected');
  check('拒绝后余量不变', store.getMaterials().find((m) => m.materialId === paper.id)!.balance === 82);

  // 跨工序领用：切换工序后余量不丢失、不重复扣减
  const v = store.getProgress(bookId).version;
  store.submit(op({ kind: 'advance_stage', bookId, expectedVersion: v, actor: '拓印师乙', toStageId: 'mend' }));
  store.submit(op({ kind: 'advance_stage', bookId, expectedVersion: store.getProgress(bookId).version, actor: '拓印师乙', toStageId: 'complete' }));
  balance = store.getMaterials().find((m) => m.materialId === paper.id)!;
  check('工序切换后材料余量保持 82', balance.balance === 82, `balance=${balance.balance}`);
  check('切换后仍可基于未归还量退回', submitMaterial('return_material', 6).status === 'applied');
  check('退回后余量还原为 88', store.getMaterials().find((m) => m.materialId === paper.id)!.balance === 88);

  assertCrossModuleConsistency(store, '场景2');
}

/* ---------- 场景 3：冲突操作保留 ---------- */
function scenarioConflicts(): void {
  console.log('\n[场景 3] 冲突操作保留');
  const store = makeStore();
  const bookId = BOOKS[2].id;

  // 两个操作者同时读到版本 0，基于同一版本提交冲突的推进操作
  const staleVersion = store.getProgress(bookId).version;
  const first = store.submit(op({ kind: 'advance_stage', bookId, expectedVersion: staleVersion, actor: '拓印师甲', toStageId: 'inspect' }));
  const second = store.submit(op({ kind: 'advance_stage', bookId, expectedVersion: staleVersion, actor: '拓印师乙', toStageId: 'bind' }));

  check('先提交者生效', first.status === 'applied');
  check('后提交者被判冲突而非静默覆盖', second.status === 'conflict');
  check('当前有效状态为先提交者结果', store.getProgress(bookId).currentStageId === 'inspect');

  const conflicts = store.getConflicts(bookId);
  check('冲突痕迹已保留', conflicts.length === 1);
  check('冲突痕迹包含被拦操作与操作者', conflicts[0]?.op.actor === '拓印师乙' && conflicts[0]?.op.kind === 'advance_stage');
  check('冲突痕迹可判定当时有效版本', conflicts[0]?.actualVersion === 1);

  // 冲突方读取最新版本后重试，可正常生效
  const retry = store.submit(op({ kind: 'advance_stage', bookId, expectedVersion: store.getProgress(bookId).version, actor: '拓印师乙', toStageId: 'mend' }));
  check('基于最新版本重试后生效', retry.status === 'applied');
  check('重试后当前工序更新', store.getProgress(bookId).currentStageId === 'mend');

  // 材料领用的并发冲突同样保留痕迹且不影响余量
  const v2 = store.getProgress(bookId).version;
  const matId = MATERIALS[1].id;
  const reqA = store.submit(op({ kind: 'requisition_material', bookId, expectedVersion: v2, actor: '拓印师甲', materialId: matId, quantity: 3 }));
  const reqB = store.submit(op({ kind: 'requisition_material', bookId, expectedVersion: v2, actor: '拓印师乙', materialId: matId, quantity: 5 }));
  check('材料并发领用先生效', reqA.status === 'applied');
  check('材料并发领用后者冲突', reqB.status === 'conflict');
  const mat = store.getMaterials().find((m) => m.materialId === matId)!;
  check('冲突领用未扣减余量', mat.balance === mat.initialStock - 3, `balance=${mat.balance}`);
  check('冲突总数可追溯', store.getConflicts(bookId).length === 2);

  assertCrossModuleConsistency(store, '场景3');
}

/* ---------- 场景 4：历史数据迁移一致性 ---------- */
function scenarioMigration(): void {
  console.log('\n[场景 4] 历史数据迁移');
  const legacy: LegacyWorkshopState = {
    progress: {
      [BOOKS[0].id]: { currentStageId: 'bind' },
      [BOOKS[1].id]: { currentStageId: 'mend' },
      [BOOKS[2].id]: { currentStageId: null },
      [BOOKS[3].id]: { currentStageId: 'inspect' },
    },
    materials: {
      [MATERIALS[0].id]: { balance: 73 },
      [MATERIALS[1].id]: { balance: 40 },
      [MATERIALS[2].id]: { balance: 55 },
      [MATERIALS[3].id]: { balance: 25 },
    },
    records: {
      [BOOKS[0].id]: [
        { stageId: 'inspect', content: '清检完毕，虫蛀三级', actor: '拓印师甲' },
        { stageId: 'mend', content: '补首页虫洞三处', actor: '拓印师甲' },
      ],
      [BOOKS[1].id]: [{ stageId: 'mend', content: '书脊加固', actor: '拓印师乙' }],
      [BOOKS[2].id]: [],
      [BOOKS[3].id]: [],
    },
  };

  const { store, report } = migrateLegacyState({ stages: STAGES, books: BOOKS, materials: MATERIALS }, legacy);
  check('迁移校验报告通过', report.ok, report.mismatches.join('；'));

  for (const book of BOOKS) {
    check(`${book.title} 进度与迁移前一致`, store.getProgress(book.id).currentStageId === legacy.progress[book.id].currentStageId);
    check(`${book.title} 记录条数与迁移前一致`, store.getRecords(book.id).length === legacy.records[book.id].length);
  }
  for (const material of MATERIALS) {
    const balance = store.getMaterials().find((m) => m.materialId === material.id)!.balance;
    check(`材料「${material.name}」余量与迁移前一致`, balance === legacy.materials[material.id].balance,
      `迁移前=${legacy.materials[material.id].balance} 迁移后=${balance}`);
  }

  // 迁移后的新操作在统一状态来源上继续生效
  const bookId = BOOKS[0].id;
  const result = store.submit(op({ kind: 'add_record', bookId, expectedVersion: store.getProgress(bookId).version, actor: '拓印师丙', stageId: 'bind', content: '装订线换红色' }));
  check('迁移后新操作正常生效', result.status === 'applied');
  check('迁移后记录条数累加正确', store.getRecords(bookId).length === 3);

  assertCrossModuleConsistency(store, '场景4');
}

console.log('古籍修复工坊 —— 状态一致性离线验证');
scenarioStageSwitching();
scenarioMaterialLedger();
scenarioConflicts();
scenarioMigration();

console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
if (failed > 0) {
  process.exit(1);
}
