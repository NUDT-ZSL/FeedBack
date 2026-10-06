import { CutLogic, PAPER_SIZE } from '../src/utils/cutLogic.ts'
import type { Point } from '../src/utils/cutLogic.ts'

interface Result {
  name: string
  pass: boolean
  detail: string
}

const results: Result[] = []

function check(name: string, condition: boolean, detail: string): void {
  results.push({ name, pass: condition, detail })
}

function makeMask(paint: (x: number, y: number) => boolean): ImageData {
  const data = new Uint8ClampedArray(PAPER_SIZE * PAPER_SIZE * 4)
  for (let y = 0; y < PAPER_SIZE; y++) {
    for (let x = 0; x < PAPER_SIZE; x++) {
      if (paint(x, y)) {
        data[(y * PAPER_SIZE + x) * 4 + 3] = 255
      }
    }
  }
  return { width: PAPER_SIZE, height: PAPER_SIZE, data, colorSpace: 'srgb' } as unknown as ImageData
}

const horizontalLine = makeMask((x, y) => y === 200 && x >= 50 && x <= 350)
const stripTemplate = makeMask((x, y) => y === 100 && x >= 100 && x <= 199)

function stroke(logic: CutLogic, points: Point[]): boolean {
  logic.startDrawing(points[0])
  for (let i = 1; i < points.length; i++) {
    logic.continueDrawing(points[i])
  }
  return logic.endDrawing() !== null
}

function linePoints(x0: number, x1: number, y: number, step = 1): Point[] {
  const pts: Point[] = [{ x: x0, y }]
  const direction = x1 >= x0 ? 1 : -1
  for (let x = x0 + direction * step; direction > 0 ? x < x1 : x > x1; x += direction * step) {
    pts.push({ x, y })
  }
  pts.push({ x: x1, y })
  return pts
}

function trackCompletion(): { events: Array<[number, boolean]>; logic: CutLogic } {
  const logic = new CutLogic()
  const events: Array<[number, boolean]> = []
  logic.setCompletionCallback((p, c) => events.push([Math.round(p * 1000) / 1000, c]))
  return { events, logic }
}

// 场景 1：命中判定 —— 轮廓之外的刻划不计入
{
  const logic = new CutLogic()
  logic.setTemplateMask(horizontalLine)
  stroke(logic, linePoints(10, 390, 10))
  let p = logic.calculateCompletion()
  check('轮廓之外横划不计入', p === 0, `进度=${p.toFixed(4)}，期望 0`)

  for (let y = 20; y < 380; y += 7) stroke(logic, linePoints(0, 399, y))
  p = logic.calculateCompletion()
  check('轮廓外大面积涂划仍为 0', p === 0, `进度=${p.toFixed(4)}，期望 0`)

  check('距轮廓 3px 的擦边不计入', logic.isCut(100, 200) === false, '该区域不应被外侧刻划命中')

  logic.reset()
  logic.setTemplateMask(horizontalLine)
  stroke(logic, linePoints(100, 300, 197))
  p = logic.calculateCompletion()
  check('距轮廓 2px 平行刻划不计入', p === 0, `进度=${p.toFixed(4)}，期望 0`)

  stroke(logic, linePoints(50, 350, 200))
  p = logic.calculateCompletion()
  check('沿轮廓刻划计入', p >= 0.99, `进度=${p.toFixed(4)}，期望 >= 0.99`)
}

// 场景 2：重复经过同一区域不重复累计
{
  const logic = new CutLogic()
  logic.setTemplateMask(horizontalLine)
  stroke(logic, linePoints(50, 350, 200))
  const first = logic.calculateCompletion()
  stroke(logic, linePoints(50, 350, 200))
  const second = logic.calculateCompletion()
  stroke(logic, linePoints(50, 350, 200))
  const third = logic.calculateCompletion()
  check('同一轨迹重复 3 次进度不叠加', first === second && second === third,
    `第一次=${first.toFixed(4)} 第二次=${second.toFixed(4)} 第三次=${third.toFixed(4)}`)

  stroke(logic, linePoints(50, 350, 200))
  stroke(logic, linePoints(350, 50, 200))
  const fourth = logic.calculateCompletion()
  check('往返重复不叠加', fourth === first, `往返后=${fourth.toFixed(4)}，第一次=${first.toFixed(4)}`)
  check('重复刻划仍只记一条路径历史之外不产生增量', fourth <= 1, `进度=${fourth.toFixed(4)}`)
}

// 场景 3：撤销回退与该步刻划增量一致
{
  const logic = new CutLogic()
  logic.setTemplateMask(horizontalLine)

  check('空栈撤销返回 false', logic.undo() === false, '初始状态无可撤销步骤')
  logic.startDrawing({ x: 100, y: 100 })
  check('未拖动的点击不产生撤销记录', logic.endDrawing() === null && logic.canUndo() === false,
    '单击不成线，撤销栈不应增长')

  stroke(logic, linePoints(50, 199, 200))
  const afterA = logic.calculateCompletion()
  stroke(logic, linePoints(200, 350, 200))
  const afterB = logic.calculateCompletion()
  const increment = afterB - afterA

  const rolled = logic.undo()
  const afterUndo = logic.calculateCompletion()
  check('撤销返回 true', rolled === true, '撤销应成功')
  check('撤销后进度回到该步之前', afterUndo === afterA,
    `撤销后=${afterUndo.toFixed(4)}，第二步之前=${afterA.toFixed(4)}`)
  check('回退幅度等于实际增量', afterB - afterUndo === increment,
    `回退=${(afterB - afterUndo).toFixed(4)}，增量=${increment.toFixed(4)}`)
  check('撤销后该步刻痕消失', logic.isCut(300, 200) === false, '(300,200) 应由第二步刻出，撤销后应为 false')
  check('撤销后前一步刻痕保留', logic.isCut(100, 200) === true, '(100,200) 属于第一步，撤销后应保留')

  logic.undo()
  check('继续撤销回到 0', logic.calculateCompletion() === 0, `进度=${logic.calculateCompletion().toFixed(4)}`)
  check('撤销栈清空', logic.canUndo() === false, 'canUndo 应为 false')
  check('全部撤销后刻痕清空', logic.isCut(100, 200) === false, '(100,200) 应为 false')
}

// 场景 4：快速拖动 —— 稀疏采样点之间的轨迹被补齐
{
  const logic = new CutLogic()
  logic.setTemplateMask(horizontalLine)
  stroke(logic, [
    { x: 50, y: 200 },
    { x: 150, y: 200 },
    { x: 250, y: 200 },
    { x: 350, y: 200 }
  ])

  let gap: number | null = null
  for (let x = 50; x <= 350; x++) {
    if (!logic.isCut(x, 200)) { gap = x; break }
  }
  check('100px 采样间距中间无断点', gap === null, gap === null ? 'x=50..350 全部已刻' : `首个缺口 x=${gap}`)
  check('缺口中点被补齐计入', logic.isCut(100, 200) && logic.isCut(200, 200) && logic.isCut(300, 200),
    '(100/200/300,200) 均应已刻')
  const p = logic.calculateCompletion()
  check('补齐后进度按连续轨迹计满', p >= 0.99, `进度=${p.toFixed(4)}，期望 >= 0.99`)

  logic.undo()
  check('撤销补齐轨迹后整体回退', logic.calculateCompletion() === 0, '回退后进度应为 0')
}

// 场景 5：完成态基于统一口径，可退出并继续刻划
{
  const { logic, events } = trackCompletion()
  logic.setTemplateMask(stripTemplate)

  stroke(logic, linePoints(100, 149, 100))
  let p = logic.calculateCompletion()
  check('低于阈值不进入完成态', logic.getCompleted() === false && Math.abs(p - 0.5) < 1e-9,
    `进度=${p.toFixed(4)}，completed=${logic.getCompleted()}`)

  stroke(logic, linePoints(100, 179, 100))
  p = logic.calculateCompletion()
  check('达到阈值进入完成态', logic.getCompleted() === true && p === 0.8,
    `进度=${p.toFixed(4)}，completed=${logic.getCompleted()}`)
  check('完成态回调发出 true', events.some(([, c]) => c === true), `回调序列=${JSON.stringify(events)}`)
  check('完成态阻止继续刻划', stroke(logic, linePoints(100, 199, 100)) === false,
    '完成态下拖动不应产生新路径')

  logic.undo()
  p = logic.calculateCompletion()
  check('撤销到阈值以下退出完成态', logic.getCompleted() === false && Math.abs(p - 0.5) < 1e-9,
    `进度=${p.toFixed(4)}，completed=${logic.getCompleted()}`)
  check('退出时回调发出 false', events[events.length - 1][1] === false,
    `末次回调=${JSON.stringify(events[events.length - 1])}`)
  check('退出后允许继续刻划', stroke(logic, linePoints(100, 199, 100)) === true,
    '退出完成态后应能产生新路径')
  check('继续刻划可重新进入完成态', logic.calculateCompletion() === 1 && logic.getCompleted() === true,
    `进度=${logic.calculateCompletion().toFixed(4)}，completed=${logic.getCompleted()}`)
}

let failed = 0
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${r.name} —— ${r.detail}`)
  if (!r.pass) failed++
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
