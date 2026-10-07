/**
 * 排产与工时推演 HTTP 入口。
 * 与界面、CLI 共用同一个离线推演引擎，保证三入口裁决一致。
 *
 * POST /api/schedule/run        body: ScheduleInput
 * POST /api/schedule/reschedule body: { previous: ScheduleResult, input: ScheduleInput }
 */
import { Router, type Request, type Response } from 'express'
import { reschedule, schedule } from '../../src/lib/scheduling/index.js'
import type { ScheduleInput, ScheduleResult } from '../../src/lib/scheduling/index.js'

const router = Router()

function isScheduleInput(value: unknown): value is ScheduleInput {
  if (!value || typeof value !== 'object') return false
  const v = value as ScheduleInput
  return (
    typeof v.originDate === 'string' &&
    Array.isArray(v.looms) &&
    Array.isArray(v.orders)
  )
}

router.post('/run', (req: Request, res: Response): void => {
  if (!isScheduleInput(req.body)) {
    res.status(400).json({ success: false, error: '请求体不是合法的排产输入' })
    return
  }
  try {
    res.status(200).json({ success: true, result: schedule(req.body) })
  } catch (error) {
    res.status(422).json({
      success: false,
      error: error instanceof Error ? error.message : '排产推演失败',
    })
  }
})

router.post('/reschedule', (req: Request, res: Response): void => {
  const body = req.body as { previous?: ScheduleResult; input?: ScheduleInput }
  if (!isScheduleInput(body.input) || !body.previous) {
    res.status(400).json({
      success: false,
      error: '请求体需要 previous（上一轮结果）与 input（修正后输入）',
    })
    return
  }
  try {
    res.status(200).json({ success: true, result: reschedule(body.previous, body.input) })
  } catch (error) {
    res.status(422).json({
      success: false,
      error: error instanceof Error ? error.message : '局部重算失败',
    })
  }
})

export default router
