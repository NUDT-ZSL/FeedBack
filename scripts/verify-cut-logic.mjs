/**
 * 离线批量校验：刻划命中 / 重复累计 / 撤销回退 / 快速拖动 / 完成态进出
 * 运行：npm run verify
 * 无需浏览器，直接用 Node 执行；通过 typescript 将 cutLogic.ts 转译后加载。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const source = fs.readFileSync(path.join(rootDir, 'src/utils/cutLogic.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 }
})
const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cut-logic-')), 'cutLogic.mjs')
fs.writeFileSync(tmpFile, outputText)
const { CutLogic, PAPER_SIZE } = await import(pathToFileURL(tmpFile).href)

const THRESHOLD = 0.75
let failures = 0

function report(name, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

function createMask(regionFn) {
  const data = new Uint8ClampedArray(PAPER_SIZE * PAPER_SIZE * 4)
  for (let y = 0; y < PAPER_SIZE; y++) {
    for (let x = 0; x < PAPER_SIZE; x++) {
      if (regionFn(x, y)) {
        const idx = (y * PAPER_SIZE + x) * 4
        data[idx] = 136
        data[idx + 1] = 136
        data[idx + 2] = 136
        data[idx + 3] = 255
      }
    }
  }
  return { data, width: PAPER_SIZE, height: PAPER_SIZE }
}

function createLogic(mask) {
  const logic = new CutLogic()
  logic.setTemplate({ id: 'test', name: '测试模板', svgPath: '', area: 0, thumbnail: '' })
  logic.setTemplateMask(mask)
  const events = []
  logic.setCompletionCallback((progress, completed) => events.push({ progress, completed }))
  return { logic, events }
}

function stroke(logic, points) {
  logic.startDrawing(points[0])
  for (let i = 1; i < points.length; i++) {
    logic.continueDrawing(points[i])
  }
  return logic.endDrawing()
}

const lastProgress = (events) => events[events.length - 1].progress
const fmt = (v) => (v * 100).toFixed(2) + '%'

// 模板有效区域：中央 200x200 方块 [100,300) x [100,300)
const squareMask = createMask((x, y) => x >= 100 && x < 300 && y >= 100 && y < 300)

// 场景 1：落在模板轮廓之外的刻划不计入完成度
{
  const { logic, events } = createLogic(squareMask)
  stroke(logic, [{ x: 10, y: 10 }, { x: 80, y: 80 }])
  stroke(logic, [{ x: 10, y: 200 }, { x: 10, y: 320 }])
  const outside = lastProgress(events)
  report('界外刻划不计入进度', outside === 0 && !logic.getCompleted(),
    `两段界外轨迹后进度=${fmt(outside)}`)

  const before = lastProgress(events)
  stroke(logic, [{ x: 50, y: 150 }, { x: 150, y: 150 }]) // 一半在界外、一半在界内
  const mixed = lastProgress(events)
  stroke(logic, [{ x: 150, y: 250 }, { x: 250, y: 250 }]) // 等长、全部在界内
  const inside = lastProgress(events)
  report('仅模板内的轨迹段计入进度',
    mixed > before && inside > mixed && mixed - before < inside - mixed,
    `跨界轨迹新增=${fmt(mixed - before)}，等长界内轨迹新增=${fmt(inside - mixed)}`)
}

// 场景 2：重复经过同一区域不重复累计
{
  const { logic, events } = createLogic(squareMask)
  const line = [{ x: 120, y: 120 }, { x: 280, y: 120 }]
  stroke(logic, line)
  const first = lastProgress(events)
  stroke(logic, line)
  stroke(logic, [...line].reverse())
  const repeated = lastProgress(events)
  report('重复经过同一区域不重复累计', first > 0 && repeated === first,
    `首次=${fmt(first)}，重复两次后=${fmt(repeated)}`)
}

// 场景 3：撤销后进度与刻痕精确回退
{
  const { logic, events } = createLogic(squareMask)
  stroke(logic, [{ x: 120, y: 150 }, { x: 280, y: 150 }])
  const afterA = lastProgress(events)
  stroke(logic, [{ x: 120, y: 250 }, { x: 280, y: 250 }])
  const afterB = lastProgress(events)
  logic.undo()
  const afterUndo1 = lastProgress(events)
  const pathsAfterUndo1 = logic.getCutPaths().length
  logic.undo()
  const afterUndo2 = lastProgress(events)
  report('撤销回退幅度与累计一致',
    afterB > afterA && afterUndo1 === afterA && afterUndo2 === 0 &&
    pathsAfterUndo1 === 1 && logic.getCutPaths().length === 0 && !logic.canUndo(),
    `A后=${fmt(afterA)}，B后=${fmt(afterB)}，撤销1次=${fmt(afterUndo1)}，撤销2次=${fmt(afterUndo2)}`)
}

// 场景 4：快速拖动的大间距采样被补齐，可见刻痕与进度口径一致
{
  const { logic, events } = createLogic(squareMask)
  logic.startDrawing({ x: 110, y: 200 })
  logic.continueDrawing({ x: 290, y: 200 }) // 单次移动 180px，模拟快速拖动
  logic.endDrawing()
  const path = logic.getCutPaths()[0]
  let maxGap = 0
  for (let i = 1; i < path.points.length; i++) {
    maxGap = Math.max(maxGap, Math.hypot(
      path.points[i].x - path.points[i - 1].x,
      path.points[i].y - path.points[i - 1].y))
  }
  let maskGap = 0
  for (let x = 110; x <= 290; x++) {
    if (!logic.isCutAt(x, 200)) maskGap++
  }
  const progress = lastProgress(events)
  report('快速拖动中间轨迹被补齐',
    maxGap <= 2 + 1e-6 && maskGap === 0 && progress > 0,
    `相邻采样最大间距=${maxGap.toFixed(2)}px，刻痕断点=${maskGap}处，进度=${fmt(progress)}`)
}

// 场景 5：完成态随统一口径进出，回退到阈值以下可继续刻划
{
  const smallMask = createMask((x, y) => x >= 180 && x < 220 && y >= 180 && y < 220)
  const { logic, events } = createLogic(smallMask)
  let completedStroke = -1
  for (let row = 0; row < 10 && !logic.getCompleted(); row++) {
    stroke(logic, [{ x: 178, y: 182 + row * 4 }, { x: 222, y: 182 + row * 4 }])
    if (logic.getCompleted()) completedStroke = row
  }
  const reached = logic.getCompleted()
  const progressAtComplete = lastProgress(events)

  let undos = 0
  while (logic.getCompleted() && undos <= 10) {
    logic.undo()
    undos++
  }
  const exited = !logic.getCompleted()
  const progressAfterUndo = lastProgress(events)
  const exitNotified = events[events.length - 1].completed === false

  const pathsBefore = logic.getCutPaths().length
  stroke(logic, [{ x: 180, y: 200 }, { x: 220, y: 200 }])
  const resumed = logic.getCutPaths().length === pathsBefore + 1

  report('完成态按阈值进出且可恢复刻划',
    reached && progressAtComplete >= THRESHOLD && exited &&
    progressAfterUndo < THRESHOLD && exitNotified && resumed,
    `第${completedStroke + 1}笔完成(${fmt(progressAtComplete)})，撤销${undos}次后=${fmt(progressAfterUndo)}，退出完成态通知=${exitNotified}，可继续刻划=${resumed}`)
}

console.log(failures === 0 ? '\n全部场景校验通过' : `\n${failures} 个场景校验失败`)
process.exit(failures === 0 ? 0 : 1)
