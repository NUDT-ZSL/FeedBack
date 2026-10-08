/**
 * 古籍修复工坊 API：工序推进、材料领用、修复记录。
 * 三个模块共享同一个 WorkshopStore（统一操作日志），
 * 任一写操作提交后，所有读取入口立即看到同一份结果。
 */
import { Router, type Request, type Response } from 'express'
import { getWorkshopStore } from '../../src/workshop/store.js'
import type { OperationRequest } from '../../src/workshop/types.js'

const router = Router()

router.get('/books', (_req: Request, res: Response): void => {
  const store = getWorkshopStore()
  res.json({ success: true, data: store.listBooks() })
})

router.get('/books/:bookId/snapshot', (req: Request, res: Response): void => {
  const store = getWorkshopStore()
  try {
    res.json({ success: true, data: store.getBookSnapshot(req.params.bookId) })
  } catch {
    res.status(404).json({ success: false, error: 'book not found' })
  }
})

router.get('/books/:bookId/records', (req: Request, res: Response): void => {
  const store = getWorkshopStore()
  try {
    res.json({ success: true, data: store.getRecords(req.params.bookId) })
  } catch {
    res.status(404).json({ success: false, error: 'book not found' })
  }
})

router.get('/books/:bookId/conflicts', (req: Request, res: Response): void => {
  const store = getWorkshopStore()
  try {
    res.json({ success: true, data: store.getConflicts(req.params.bookId) })
  } catch {
    res.status(404).json({ success: false, error: 'book not found' })
  }
})

router.get('/materials', (_req: Request, res: Response): void => {
  const store = getWorkshopStore()
  res.json({ success: true, data: store.getMaterials() })
})

router.get('/materials/movements', (req: Request, res: Response): void => {
  const store = getWorkshopStore()
  const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : undefined
  res.json({ success: true, data: store.getMovements(bookId) })
})

/**
 * 提交操作（工序推进 / 材料领用退回 / 修复记录）。
 * 请求体即 OperationRequest；返回 CommitResult，
 * 冲突时 HTTP 409 并附带当前有效版本，便于调用方判断与重提。
 */
router.post('/operations', (req: Request, res: Response): void => {
  const store = getWorkshopStore()
  const operation = req.body as OperationRequest
  if (!operation?.opId || !operation?.bookId || !operation?.payload?.type) {
    res.status(400).json({ success: false, error: 'invalid operation' })
    return
  }
  const result = store.commit(operation)
  const status = result.status === 'conflict' ? 409 : result.status === 'rejected' ? 422 : 200
  res.status(status).json({ success: result.status !== 'rejected', data: result })
})

export default router
