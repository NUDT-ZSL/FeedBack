import {
  createCupSimulation,
  resetCupSimulation,
  stepCupSimulation,
  CUP_INITIAL_SPACING,
  COLLISION_DISTANCE,
  CupSimulationState,
  CupSimParams,
  StepEvents
} from './cupSimulation'

const TOTAL_LENGTH = 12
const FRAME_DELTA = 1 / 60

let failures = 0

const assert = (condition: boolean, message: string) => {
  if (condition) {
    console.log(`  ✓ ${message}`)
  } else {
    failures += 1
    console.error(`  ✗ ${message}`)
  }
}

const runFrames = (
  sim: CupSimulationState,
  params: (frame: number) => CupSimParams,
  frames: number,
  onEvents?: (events: StepEvents, frame: number) => void
): StepEvents[] => {
  const all: StepEvents[] = []
  for (let frame = 0; frame < frames; frame++) {
    const events = stepCupSimulation(sim, params(frame), FRAME_DELTA)
    all.push(events)
    if (onEvents) onEvents(events, frame)
  }
  return all
}

const baseParams = (gateOpening: number): CupSimParams => ({
  gateOpening,
  slope: 15,
  curvature: 45,
  totalLength: TOTAL_LENGTH
})

console.log('\n[1] 同帧多杯碰撞：每对接触只计一次')
{
  const sim = createCupSimulation(3)
  sim.cups[0].distance = 1.0
  sim.cups[1].distance = 1.03
  sim.cups[2].distance = 1.06

  let frameOneCollisions = 0
  let laterCollisions = 0
  runFrames(sim, () => baseParams(50), 120, (events, frame) => {
    if (frame === 0) frameOneCollisions += events.collisions.length
    else laterCollisions += events.collisions.length
  })

  assert(frameOneCollisions === 3, `首帧 3 对杯同时进入接触，恰好计 3 次（实际 ${frameOneCollisions}）`)
  assert(laterCollisions === 0, `接触保持期间没有重复计数（后续帧新增 ${laterCollisions}）`)
  assert(sim.collisionCount === 3, `仿真内部计数与事件总数一致（${sim.collisionCount}）`)
}

console.log('\n[2] 碰撞后两杯分离，不再反复贴合')
{
  const sim = createCupSimulation(2)
  sim.cups[0].distance = 2.0
  sim.cups[1].distance = 2.0 + COLLISION_DISTANCE / 2

  runFrames(sim, () => baseParams(50), 300)
  const gap = Math.abs(sim.cups[1].distance - sim.cups[0].distance)
  assert(sim.collisionCount === 1, `一对杯只计 1 次碰撞（实际 ${sim.collisionCount}）`)
  assert(gap >= COLLISION_DISTANCE, `碰撞冲量把两杯推开到接触距离之外（间距 ${gap.toFixed(3)}）`)
}

console.log('\n[3] 阈值附近开度抖动：滞回区间内卡住状态不抖动')
{
  const sim = createCupSimulation()
  let transitions = 0
  let prevStuck = sim.cups[0].stuck
  const track = () => {
    const stuck = sim.cups[0].stuck
    if (stuck !== prevStuck) transitions += 1
    prevStuck = stuck
  }

  // 低于停转阈值：卡住
  runFrames(sim, () => baseParams(0), 30, track)
  assert(sim.cups[0].stuck, '开度 0（水深 0.10 < 0.12）杯体卡住')
  assert(transitions === 1, `进入卡住只发生 1 次（实际 ${transitions}）`)

  // 在滞回区间 (0.12, 0.15) 内来回抖动：保持卡住
  runFrames(sim, frame => baseParams(frame % 2 === 0 ? 8 : 15), 300, track)
  assert(sim.cups[0].stuck, '开度在 8~15 间抖动（水深 0.124~0.145）仍保持卡住')
  assert(transitions === 1, `滞回区间内抖动不引起状态翻转（累计转换 ${transitions}）`)

  // 高于恢复阈值：重新启动
  runFrames(sim, () => baseParams(40), 30, track)
  assert(!sim.cups[0].stuck, '开度 40（水深 0.22 > 0.15）杯体恢复推进')
  assert(transitions === 2, `恢复只发生 1 次（累计转换 ${transitions}）`)

  // 再次在滞回区间内抖动：保持前进
  runFrames(sim, frame => baseParams(frame % 2 === 0 ? 8 : 15), 300, track)
  assert(!sim.cups[0].stuck, '恢复后在滞回区间内抖动不会重新卡住')
  assert(transitions === 2, `状态依旧稳定（累计转换 ${transitions}）`)

  // 反复穿越停转阈值但不到恢复阈值：只卡住一次
  const distanceBefore = sim.cups[0].distance
  runFrames(sim, frame => baseParams(frame % 2 === 0 ? 0 : 10), 300, track)
  assert(sim.cups[0].stuck, '反复穿越 0.12 后最终卡住')
  assert(transitions === 3, `穿越停转阈值不重复触发卡住（累计转换 ${transitions}）`)
  assert(sim.cups[0].distance === distanceBefore, '卡住期间杯体位置不变')
}

console.log('\n[4] 重置：所有杯体回到同一初始分布')
{
  const sim = createCupSimulation()
  sim.cups[0].distance = 3.0
  sim.cups[1].distance = 3.05
  runFrames(sim, () => baseParams(80), 120)
  assert(sim.collisionCount > 0, `重置前确实发生过碰撞（${sim.collisionCount} 次）`)

  resetCupSimulation(sim)
  const distancesOk = sim.cups.every(
    (cup, i) => cup.distance === i * CUP_INITIAL_SPACING
  )
  assert(distancesOk, '距离回到 i*0.3 的初始分布')
  assert(
    sim.cups.every(cup => !cup.stuck && cup.velocity === 0 && cup.impulse === 0),
    '卡住标记、速度、冲量全部清零'
  )
  assert(sim.collisionCount === 0, '碰撞计数清零')
  assert(Object.keys(sim.contacts).length === 0, '接触对记录清空')

  const events = stepCupSimulation(sim, baseParams(50), FRAME_DELTA)
  assert(events.collisions.length === 0, '重置后首帧不会把初始分布误判为碰撞')
}

console.log('\n[5] 自动演示节奏驱动：计数一致且结果可复现')
{
  // 与 ControlPanel 的自动演示完全一致：8 秒三角波驱动三个参数
  const autoDemoParams = (elapsedMs: number): CupSimParams => {
    const phase = (elapsedMs % 8000) / 8000
    const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2
    const value = triangle * 100
    return {
      gateOpening: value,
      slope: value * 0.3,
      curvature: value * 0.9,
      totalLength: TOTAL_LENGTH
    }
  }

  const runDemo = () => {
    const sim = createCupSimulation()
    let eventCollisions = 0
    let finishes = 0
    // 两个完整演示周期
    runFrames(sim, frame => autoDemoParams(frame * FRAME_DELTA * 1000), 960, events => {
      eventCollisions += events.collisions.length
      finishes += events.finishes.length
    })
    // 停止自动演示：参数冻结在当前值，场景继续推进
    const frozen = autoDemoParams(960 * FRAME_DELTA * 1000)
    runFrames(sim, () => frozen, 120, events => {
      eventCollisions += events.collisions.length
      finishes += events.finishes.length
    })
    return { sim, eventCollisions, finishes }
  }

  const first = runDemo()
  assert(
    first.sim.collisionCount === first.eventCollisions,
    `界面计数与场景事件一致（计数 ${first.sim.collisionCount} / 事件 ${first.eventCollisions}）`
  )

  const second = runDemo()
  const sameDistances = first.sim.cups.every(
    (cup, i) => cup.distance === second.sim.cups[i].distance
  )
  assert(
    sameDistances && first.sim.collisionCount === second.sim.collisionCount,
    `相同演示序列推演两次结果完全一致（碰撞 ${first.sim.collisionCount} 次）`
  )

  resetCupSimulation(first.sim)
  const backToInitial = first.sim.cups.every(
    (cup, i) => cup.distance === i * CUP_INITIAL_SPACING
  )
  assert(backToInitial && first.sim.collisionCount === 0, '停止演示后重置，全部杯体回到初始分布')
}

console.log('')
if (failures > 0) {
  console.error(`${failures} 项验证失败`)
  throw new Error('simulation verification failed')
}
console.log('全部验证通过')
