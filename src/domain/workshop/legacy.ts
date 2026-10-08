/**
 * 历史数据迁移：把原先分散在三个模块里各自维护的状态
 * （工序进度快照、材料余量快照、修复记录列表）收敛进统一状态存储。
 *
 * 迁移原则：
 * - 迁移后各模块读到的进度、材料余量、记录条数与迁移前逐一相等；
 * - 迁移过程本身也落成操作日志（actor = 'migration'），可追溯；
 * - migrateLegacyState 返回校验报告，调用方可断言迁移前后一致。
 */

import { WorkshopStore } from './store';
import type { BookDef, MaterialDef, StageDef } from './types';

/** 旧工序模块各自维护的进度快照 */
export interface LegacyProgressState {
  [bookId: string]: { currentStageId: string | null };
}

/** 旧材料模块各自维护的余量快照（只存剩余量，无领用/退回明细） */
export interface LegacyMaterialState {
  [materialId: string]: { balance: number };
}

/** 旧记录模块各自维护的修复记录 */
export interface LegacyRecordState {
  [bookId: string]: Array<{ stageId: string; content: string; actor?: string }>;
}

export interface LegacyWorkshopState {
  progress: LegacyProgressState;
  materials: LegacyMaterialState;
  records: LegacyRecordState;
}

export interface MigrationReport {
  ok: boolean;
  mismatches: string[];
}

let migrationSeq = 0;

function nextOpId(): string {
  migrationSeq += 1;
  return `migration-${migrationSeq}`;
}

/**
 * 把分散的旧状态重放为统一日志：
 * 1. 按书重放工序推进，使当前工序与旧进度快照一致；
 * 2. 按材料重放领用，使派生余量与旧余量快照一致；
 * 3. 按书重放修复记录，保持原有顺序与内容。
 */
export function migrateLegacyState(
  defs: { stages: StageDef[]; books: BookDef[]; materials: MaterialDef[] },
  legacy: LegacyWorkshopState,
): { store: WorkshopStore; report: MigrationReport } {
  const store = new WorkshopStore(defs);

  for (const book of defs.books) {
    const legacyProgress = legacy.progress[book.id];
    if (legacyProgress?.currentStageId) {
      store.submit({
        kind: 'advance_stage',
        opId: nextOpId(),
        bookId: book.id,
        expectedVersion: store.getProgress(book.id).version,
        actor: 'migration',
        toStageId: legacyProgress.currentStageId,
      });
    }
  }

  for (const material of defs.materials) {
    const legacyBalance = legacy.materials[material.id]?.balance;
    if (legacyBalance === undefined) continue;
    const consumed = material.initialStock - legacyBalance;
    if (consumed > 0) {
      // 旧快照只有净消耗，挂到第一册在修古籍名下以还原余量
      const bookId = defs.books[0]?.id;
      if (bookId) {
        store.submit({
          kind: 'requisition_material',
          opId: nextOpId(),
          bookId,
          expectedVersion: store.getProgress(bookId).version,
          actor: 'migration',
          materialId: material.id,
          quantity: consumed,
        });
      }
    }
  }

  for (const book of defs.books) {
    for (const record of legacy.records[book.id] ?? []) {
      store.submit({
        kind: 'add_record',
        opId: nextOpId(),
        bookId: book.id,
        expectedVersion: store.getProgress(book.id).version,
        actor: record.actor ?? 'migration',
        stageId: record.stageId,
        content: record.content,
      });
    }
  }

  return { store, report: verifyMigration(store, legacy) };
}

/** 校验迁移结果：三个模块的读取结果必须与旧快照逐一相等 */
export function verifyMigration(store: WorkshopStore, legacy: LegacyWorkshopState): MigrationReport {
  const mismatches: string[] = [];

  for (const [bookId, progress] of Object.entries(legacy.progress)) {
    const actual = store.getProgress(bookId).currentStageId;
    if (actual !== progress.currentStageId) {
      mismatches.push(`工序进度不一致 ${bookId}: 迁移前=${progress.currentStageId} 迁移后=${actual}`);
    }
  }

  for (const [materialId, material] of Object.entries(legacy.materials)) {
    const actual = store.getMaterials().find((m) => m.materialId === materialId)?.balance;
    if (actual !== material.balance) {
      mismatches.push(`材料余量不一致 ${materialId}: 迁移前=${material.balance} 迁移后=${actual}`);
    }
  }

  for (const [bookId, records] of Object.entries(legacy.records)) {
    const actual = store.getRecords(bookId);
    if (actual.length !== records.length) {
      mismatches.push(`修复记录条数不一致 ${bookId}: 迁移前=${records.length} 迁移后=${actual.length}`);
      continue;
    }
    records.forEach((record, index) => {
      const migrated = actual[index];
      if (migrated.stageId !== record.stageId || migrated.content !== record.content) {
        mismatches.push(`修复记录内容不一致 ${bookId}#${index}`);
      }
    });
  }

  if (!store.checkMaterializedMatchesJournal()) {
    mismatches.push('物化状态与操作日志重放结果不一致');
  }

  return { ok: mismatches.length === 0, mismatches };
}
