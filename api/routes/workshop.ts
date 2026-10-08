/**
 * 工坊状态 API：工序推进、材料领用、修复记录三个模块
 * 共享同一个 WorkshopStore 实例（单例）。
 *
 * GET  /api/workshop/state        读取统一快照（三个模块同读此结果）
 * GET  /api/workshop/conflicts    读取冲突痕迹
 * POST /api/workshop/operations   提交操作（幂等 + 乐观版本）
 * POST /api/workshop/migrate      校验旧数据迁移结果（不改动当前数据）
 */
import { Router, type Request, type Response } from 'express';
import { BOOKS, MATERIALS, STAGES, WorkshopStore, migrateLegacyState, type LegacyWorkshopState, type Operation } from '../../src/domain/workshop/index.js';

const router = Router();

/** 全工坊唯一的统一状态实例：重启后按初始数据重建（内存存储） */
export const workshopStore = new WorkshopStore({ stages: STAGES, books: BOOKS, materials: MATERIALS });

router.get('/state', (_req: Request, res: Response): void => {
  res.status(200).json({ success: true, data: workshopStore.getSnapshot() });
});

router.get('/conflicts', (req: Request, res: Response): void => {
  const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : undefined;
  res.status(200).json({ success: true, data: workshopStore.getConflicts(bookId) });
});

router.post('/operations', (req: Request, res: Response): void => {
  const op = req.body as Operation;
  if (!op || !op.opId || !op.bookId || !op.kind) {
    res.status(400).json({ success: false, error: '操作缺少 opId / bookId / kind 字段' });
    return;
  }
  const result = workshopStore.submit(op);
  const statusCode = result.status === 'rejected' ? 422 : result.status === 'conflict' ? 409 : 200;
  res.status(statusCode).json({ success: result.status === 'applied' || result.status === 'duplicate', data: result });
});

router.post('/migrate', (req: Request, res: Response): void => {
  const legacy = req.body as LegacyWorkshopState;
  if (!legacy || !legacy.progress || !legacy.materials || !legacy.records) {
    res.status(400).json({ success: false, error: '旧数据需包含 progress / materials / records 三个模块' });
    return;
  }
  const { store, report } = migrateLegacyState({ stages: STAGES, books: BOOKS, materials: MATERIALS }, legacy);
  res.status(200).json({ success: report.ok, data: { report, snapshot: store.getSnapshot() } });
});

export default router;
