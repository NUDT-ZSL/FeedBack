// 离线批量验证：像素状态单一事实来源重构
// 运行：npm run verify
import { PixelBoard } from '../src/pixelBoard.ts'

const CANVAS_SIZE = 400

function createMockContext(log) {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    rect() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc(...args) {
      log.push({ op: 'arc', args, fillStyle: this.fillStyle })
    },
    fill() {
      log.push({ op: 'fill', fillStyle: this.fillStyle })
    },
    clearRect(...args) {
      log.push({ op: 'clearRect', args })
    },
    fillRect(...args) {
      log.push({ op: 'fillRect', args, fillStyle: this.fillStyle })
    },
  }
}

function createMockCanvas() {
  const log = []
  const ctx = createMockContext(log)
  return {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    log,
    getContext: () => ctx,
    toDataURL: () => `data:mock;base64,${JSON.stringify(log)}`,
  }
}

function createHarness(gridSize) {
  const canvas = createMockCanvas()
  let now = 0
  const frameQueue = []
  const board = new PixelBoard({
    canvasSize: CANVAS_SIZE,
    gridSize,
    canvas,
    createExportCanvas: () => {
      const exportCanvas = createMockCanvas()
      exportCanvas.width = CANVAS_SIZE
      exportCanvas.height = CANVAS_SIZE
      return exportCanvas
    },
    requestFrame: (cb) => frameQueue.push(cb),
    now: () => now,
  })
  return {
    board,
    canvas,
    paintOpsAfter(mark) {
      return canvas.log.slice(mark).filter((e) => e.op === 'fillRect' || e.op === 'fill')
    },
    mark() {
      return canvas.log.length
    },
    pump(ms) {
      now += ms
      const callbacks = frameQueue.splice(0)
      for (const cb of callbacks) cb(now)
    },
    pumpUntilSettled(maxMs = 2000) {
      let elapsed = 0
      while (frameQueue.length > 0 && elapsed < maxMs) {
        this.pump(16)
        elapsed += 16
      }
    },
  }
}

const results = []
function check(name, condition, detail = '') {
  results.push({ name, ok: condition, detail })
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 场景 1：连续快速绘制后立即清空，画布应为空且不再出现回填
{
  const h = createHarness(16)
  for (let i = 0; i < 8; i++) {
    h.board.paintCell(i, i, 'rgba(231, 76, 60, 1)')
    h.board.paintCell(i + 1, i, 'rgba(231, 76, 60, 1)')
  }
  h.board.clear()
  const mark = h.mark()
  h.pumpUntilSettled()
  check(
    '快速绘制后立即清空：无旧动画回填',
    h.paintOpsAfter(mark).length === 0,
    `清空后绘制操作数=${h.paintOpsAfter(mark).length}`,
  )
  check('快速绘制后立即清空：像素状态为空', h.board.snapshotCells().size === 0)
  const blank = createHarness(16).board.exportDataURL()
  check('快速绘制后立即清空：导出为空白画布', h.board.exportDataURL() === blank)
}

// 场景 2：动画进行中切换 16/32/64 网格，不残留上一尺寸像素
{
  const h = createHarness(16)
  h.board.paintCell(3, 3, 'rgba(46, 204, 113, 1)')
  h.board.paintCell(10, 12, 'rgba(46, 204, 113, 1)')
  h.pump(50) // 动画进行中（总时长 150ms）
  h.board.setGridSize(32)
  const mark32 = h.mark()
  h.pumpUntilSettled()
  check(
    '动画中切换 16→32：无旧尺寸像素写回',
    h.paintOpsAfter(mark32).length === 0,
    `切换后绘制操作数=${h.paintOpsAfter(mark32).length}`,
  )
  check('动画中切换 16→32：像素状态为空', h.board.snapshotCells().size === 0)

  h.board.paintCell(5, 5, 'rgba(52, 152, 219, 1)')
  h.pump(50)
  h.board.setGridSize(64)
  const mark64 = h.mark()
  h.pumpUntilSettled()
  check(
    '动画中切换 32→64：无旧尺寸像素写回',
    h.paintOpsAfter(mark64).length === 0,
    `切换后绘制操作数=${h.paintOpsAfter(mark64).length}`,
  )
  check('动画中切换 32→64：像素状态为空', h.board.snapshotCells().size === 0)
  const blank = createHarness(64).board.exportDataURL()
  check('切换网格后导出为空白画布', h.board.exportDataURL() === blank)
}

// 场景 3：导出只包含已落定像素，预览/高亮是否显示不影响导出结果
{
  const h = createHarness(16)
  h.board.paintCell(2, 2, 'rgba(231, 76, 60, 1)')
  h.board.paintCell(7, 9, 'rgba(52, 152, 219, 0.5)')
  h.pumpUntilSettled()
  const exportHidden = h.board.exportDataURL()

  // 模拟悬停预览/高亮正显示：向主画布上下文画入预览色块（旧实现会被 toDataURL 一并导出）
  const ctx = h.canvas.getContext('2d')
  ctx.fillStyle = 'rgba(231, 76, 60, 0.5)'
  ctx.fillRect(50, 50, 30, 30)
  const exportShown = h.board.exportDataURL()

  check('预览显示与隐藏时导出数据完全一致', exportShown === exportHidden)
  check('导出结果可重复（两次导出一致）', h.board.exportDataURL() === exportHidden)

  const cells = h.board.snapshotCells()
  check(
    '导出内容等于已落定像素集合',
    cells.size === 2 &&
      cells.get('2,2') === 'rgba(231, 76, 60, 1)' &&
      cells.get('7,9') === 'rgba(52, 152, 219, 0.5)',
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
if (failed.length > 0) {
  console.error('验证失败')
  process.exit(1)
}
console.log('全部验证通过')
