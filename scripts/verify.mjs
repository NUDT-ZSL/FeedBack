import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = path.join(os.tmpdir(), `pixel-board-verify-${process.pid}.mjs`)

esbuild.buildSync({
  entryPoints: [path.join(rootDir, 'src/pixelBoard.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
})

const {
  CANVAS_SIZE,
  FILL_DURATION_MS,
  PixelBoard,
  brushCells,
  renderGrid,
  renderHoverPreview,
} = await import(outfile)

class RecordingContext {
  constructor() {
    this.ops = []
    this.fillStyle = '#000'
    this.strokeStyle = '#000'
    this.lineWidth = 1
  }
  clearRect(x, y, w, h) { this.ops.push(`clearRect ${x} ${y} ${w} ${h}`) }
  fillRect(x, y, w, h) { this.ops.push(`fillRect ${x} ${y} ${w} ${h} ${this.fillStyle}`) }
  save() { this.ops.push('save') }
  restore() { this.ops.push('restore') }
  beginPath() {}
  rect(x, y, w, h) { this.ops.push(`rect ${x} ${y} ${w} ${h}`) }
  clip() { this.ops.push('clip') }
  arc(x, y, r) { this.ops.push(`arc ${x} ${y} ${r}`) }
  fill() { this.ops.push(`fill ${this.fillStyle}`) }
  moveTo(x, y) { this.ops.push(`moveTo ${x} ${y}`) }
  lineTo(x, y) { this.ops.push(`lineTo ${x} ${y}`) }
  stroke() { this.ops.push('stroke') }
  fillOps() { return this.ops.filter((op) => op.startsWith('fillRect') || op.startsWith('fill ')) }
}

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function assertNoPixelsDrawn(ctx, context) {
  assert(
    ctx.fillOps().length === 0,
    `${context}: 期望无任何像素绘制，实际出现 ${ctx.fillOps().length} 次填充: ${ctx.fillOps()[0] ?? ''}`
  )
}
function exportOps(board) {
  const ctx = new RecordingContext()
  board.renderSettledTo(ctx)
  return ctx.ops.join('\n')
}

// 场景 1：连续快速绘制后立即清空，画布应为空且不再出现回填
test('连续快速绘制后立即清空：无旧动画回填', () => {
  const board = new PixelBoard(16)
  for (let i = 0; i < 60; i++) {
    board.paint(brushCells(i % 16, (i * 7) % 16, 3), `rgba(${i}, 0, 0, 1)`, i)
  }
  assert(board.pixelCount > 0, '绘制后应有已落定像素')
  assert(board.animationCount > 0, '绘制后应有进行中的动画')

  board.clear()
  assert(board.pixelCount === 0, '清空后像素状态应为空')
  assert(board.animationCount === 0, '清空后动画队列应为空')

  for (const t of [61, 80, 120, 200, 1000]) {
    const ctx = new RecordingContext()
    board.renderTo(ctx, t)
    assertNoPixelsDrawn(ctx, `清空后 t=${t}ms 渲染`)
  }
  assert(exportOps(board).trim() === `clearRect 0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`, '清空后导出应为空白')
})

// 场景 2：动画进行中切换 16/32/64 网格，画布不应残留上一尺寸的像素
test('动画进行中切换网格尺寸：无上一尺寸残留', () => {
  for (const target of [32, 64]) {
    const board = new PixelBoard(16)
    board.paint(brushCells(3, 3, 5), 'rgba(255, 0, 0, 1)', 0)
    board.paint(brushCells(10, 11, 3), 'rgba(0, 0, 255, 1)', 20)
    assert(board.hasActiveAnimations(30), '切换前应存在进行中的动画')

    board.setGridSize(target)
    assert(board.pixelCount === 0, `切换到 ${target} 后像素状态应为空`)
    assert(board.animationCount === 0, `切换到 ${target} 后动画队列应为空`)

    for (const t of [40, 100, FILL_DURATION_MS + 50, 1000]) {
      const ctx = new RecordingContext()
      board.renderTo(ctx, t)
      assertNoPixelsDrawn(ctx, `切换到 ${target} 后 t=${t}ms 渲染`)
    }

    board.paint(brushCells(5, 6, 1), 'rgba(0, 255, 0, 1)', 200)
    const ctx = new RecordingContext()
    board.renderTo(ctx, 200 + FILL_DURATION_MS + 100)
    const cellSize = CANVAS_SIZE / target
    const expected = `fillRect ${5 * cellSize} ${6 * cellSize} ${cellSize} ${cellSize} rgba(0, 255, 0, 1)`
    assert(
      ctx.fillOps().length === 1 && ctx.fillOps()[0] === expected,
      `切换到 ${target} 后新绘制应按新网格落位，实际: ${ctx.fillOps().join(' | ')}`
    )
  }

  // 连续切换 16 -> 32 -> 64 -> 16，每次都应丢弃上一尺寸的像素与动画
  const chained = new PixelBoard(16)
  chained.paint(brushCells(2, 2, 4), 'rgba(255, 0, 0, 1)', 0)
  chained.setGridSize(32)
  chained.paint(brushCells(30, 30, 2), 'rgba(0, 255, 0, 1)', 100)
  chained.setGridSize(64)
  chained.paint(brushCells(60, 60, 1), 'rgba(0, 0, 255, 1)', 200)
  chained.setGridSize(16)
  assert(chained.pixelCount === 0, '连续切换回 16 后像素状态应为空')
  assert(chained.animationCount === 0, '连续切换回 16 后动画队列应为空')
  for (const t of [250, 400, 1000]) {
    const ctx = new RecordingContext()
    chained.renderTo(ctx, t)
    assertNoPixelsDrawn(ctx, `连续切换回 16 后 t=${t}ms 渲染`)
  }
})

// 场景 3：导出数据在预览显示时与预览隐藏时应完全一致
test('导出结果不受悬停预览/高亮影响', () => {
  const board = new PixelBoard(32)
  board.paint(brushCells(4, 5, 3), 'rgba(231, 76, 60, 1)', 0)
  board.paint(brushCells(20, 21, 2), 'rgba(52, 152, 219, 0.5)', 10)
  board.renderTo(new RecordingContext(), 1000)

  const exportWithoutPreview = exportOps(board)

  const overlay = new RecordingContext()
  renderHoverPreview(overlay, {
    gridSize: 32,
    brushSize: 3,
    color: '#e74c3c',
    opacity: 1,
    hoverX: 6,
    hoverY: 7,
  })
  assert(overlay.fillOps().length > 0, '预览应在 overlay 上产生绘制')

  const exportWithPreview = exportOps(board)
  assert(
    exportWithPreview === exportWithoutPreview,
    '预览显示时与隐藏时的导出结果不一致'
  )
  assert(
    !exportWithPreview.includes('arc') && !exportWithPreview.includes('stroke'),
    '导出结果不应包含动画圆弧或网格/高亮描边'
  )

  const inFlight = new PixelBoard(16)
  inFlight.paint(brushCells(2, 3, 1), 'rgba(1, 2, 3, 1)', 0)
  const overlay2 = new RecordingContext()
  renderHoverPreview(overlay2, {
    gridSize: 16,
    brushSize: 5,
    color: '#000000',
    opacity: 0.8,
    hoverX: 2,
    hoverY: 3,
  })
  const midAnimationExport = exportOps(inFlight)
  const cellSize = CANVAS_SIZE / 16
  assert(
    midAnimationExport.includes(`fillRect ${2 * cellSize} ${3 * cellSize} ${cellSize} ${cellSize} rgba(1, 2, 3, 1)`),
    '动画进行中的已提交格子应以落定颜色完整导出'
  )
  assert(!midAnimationExport.includes('arc'), '导出不应包含动画中间帧')
})

// 附加：网格线只画在 overlay，不进入像素层导出
test('网格线渲染独立于像素状态', () => {
  const board = new PixelBoard(16)
  board.paint(brushCells(1, 1, 1), 'rgba(9, 9, 9, 1)', 0)
  const gridCtx = new RecordingContext()
  renderGrid(gridCtx, 16)
  assert(gridCtx.ops.some((op) => op === 'stroke'), 'overlay 应绘制网格线')
  const exported = exportOps(board)
  assert(!exported.includes('stroke') && !exported.includes('moveTo'), '导出不应包含网格线')
})

let failed = 0
for (const result of results) {
  if (result.ok) {
    console.log(`  ✔ ${result.name}`)
  } else {
    failed++
    console.error(`  ✘ ${result.name}`)
    console.error(`    ${result.error.message}`)
  }
}

fs.rmSync(outfile, { force: true })

console.log('')
if (failed > 0) {
  console.error(`验证失败：${failed}/${results.length} 项未通过`)
  process.exit(1)
} else {
  console.log(`全部通过：${results.length}/${results.length} 项`)
}
