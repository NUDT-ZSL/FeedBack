/**
 * 排产与工时推演的 HTTP 入口。
 * 与界面入口共用同一条调用收敛层（src/scheduling/pipeline），
 * 保证同一批输入从任何入口进入都得到一致结果。
 */
import { Router, type Request, type Response } from 'express'
import {
  applyRevision,
  recomputeViaService,
  runScheduleViaService,
  sampleInput,
} from '../../src/scheduling/index.js'
import type { ScheduleInput, ScheduleRevision, ScheduleResult } from '../../src/scheduling/index.js'

const router = Router()

/** 获取验收用样例输入。 */
router.get('/sample', (_req: Request, res: Response): void => {
  res.status(200).json({ success: true, data: sampleInput })
})

/** 整体推演：POST { input } */
router.post('/run', (req: Request, res: Response): void => {
  try {
    const input = req.body?.input as ScheduleInput
    if (!input || !Array.isArray(input.looms) || !Array.isArray(input.operations)) {
      res.status(400).json({ success: false, error: '缺少合法的 input（looms/orders/operations）' })
      return
    }
    const result = runScheduleViaService(input)
    res.status(200).json({ success: true, data: result })
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message })
  }
})

/** 局部重算：POST { input, revision, previous } */
router.post('/recompute', (req: Request, res: Response): void => {
  try {
    const input = req.body?.input as ScheduleInput
    const revision = req.body?.revision as ScheduleRevision
    const previous = req.body?.previous as ScheduleResult
    if (!input || !revision || !previous) {
      res.status(400).json({ success: false, error: '缺少 input / revision / previous' })
      return
    }
    const incremental = recomputeViaService(input, revision, previous)
    // 同时返回整体重算摘要，便于调用方直接比对一致性。
    const full = runScheduleViaService(applyRevision(input, revision))
    res.status(200).json({
      success: true,
      data: {
        ...incremental,
        fullDigest: full.meta.resultDigest,
        consistent: full.meta.resultDigest === incremental.result.meta.resultDigest,
      },
    })
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message })
  }
})

export default router
