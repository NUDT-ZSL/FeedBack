/**
 * 离线批量验证入口：npm run verify
 *
 * 覆盖场景：
 *  1. 多发射源并行 + 同位置发射源的粒子归属
 *  2. 发射源参数中途修改不影响已生成粒子
 *  3. 发射源删除后其粒子继续走完生命周期
 *  4. 全局上限下各发射源按配额比例分配（新发射源不被静默饿死）
 *  5. 同帧内参数修改与粒子消亡不发生归属错乱 / 颜色跳变
 */
import * as THREE from 'three'
import { ParticleEngine, EmitterConfig, Particle } from '../src/core/engine'

const DT = 1 / 60
const EPS = 1e-6

let failures = 0
let checks = 0

function check(condition: boolean, message: string): void {
  checks++
  if (!condition) {
    failures++
    console.error(`    ✗ ${message}`)
  }
}

function scenario(title: string, fn: () => void): void {
  console.log(`\n[场景] ${title}`)
  const before = failures
  fn()
  if (failures === before) {
    console.log('    ✓ 全部断言通过')
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function run(engine: ParticleEngine, seconds: number, perFrame?: () => void): void {
  const frames = Math.round(seconds / DT)
  for (let i = 0; i < frames; i++) {
    if (perFrame) perFrame()
    engine.update(DT)
  }
}

function colorOf(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

function channelBetween(v: number, a: number, b: number): boolean {
  const lo = Math.min(a, b) - 1e-4
  const hi = Math.max(a, b) + 1e-4
  return v >= lo && v <= hi
}

function colorOnSegment(c: THREE.Color, from: THREE.Color, to: THREE.Color): boolean {
  return (
    channelBetween(c.r, from.r, to.r) &&
    channelBetween(c.g, from.g, to.g) &&
    channelBetween(c.b, from.b, to.b)
  )
}

function assertParticleMatchesConfig(p: Particle, config: EmitterConfig, label: string): void {
  check(
    p.lifetime >= config.lifetimeMin - EPS && p.lifetime <= config.lifetimeMax + EPS,
    `${label}: 寿命 ${p.lifetime.toFixed(3)} 应在 [${config.lifetimeMin}, ${config.lifetimeMax}] 内`
  )
  const from = colorOf(config.startColor)
  const to = colorOf(config.endColor)
  check(colorOnSegment(p.startColor, from, to), `${label}: 起始色应在发射源颜色区间内`)
  check(colorOnSegment(p.endColor, from, to), `${label}: 结束色应在发射源颜色区间内`)
}

function aliveParticles(engine: ParticleEngine, emitterId?: string): Particle[] {
  return engine
    .getParticles()
    .filter(p => p.alive && (emitterId === undefined || p.emitterId === emitterId))
}

// ---------------------------------------------------------------- 场景 1
scenario('多发射源并行与同位置发射源归属', () => {
  const engine = new ParticleEngine({ maxParticles: 800, rng: mulberry32(1) })
  const configA: Omit<EmitterConfig, 'id'> = {
    position: [0, 0, 0],
    direction: [0, 1, 0],
    spread: 0.5,
    emissionRate: 30,
    initialVelocity: [0, 1, 0],
    diffusionSpeed: 1,
    lifetimeMin: 2,
    lifetimeMax: 3,
    startColor: '#ff0000',
    endColor: '#0000ff'
  }
  const configB: Omit<EmitterConfig, 'id'> = {
    position: [0, 0, 0],
    direction: [1, 0, 0],
    spread: 0.5,
    emissionRate: 10,
    initialVelocity: [1, 0, 0],
    diffusionSpeed: 1,
    lifetimeMin: 4,
    lifetimeMax: 5,
    startColor: '#00ff00',
    endColor: '#ffff00'
  }
  engine.addEmitter({ ...configA, id: 'A' })
  engine.addEmitter({ ...configB, id: 'B' })

  run(engine, 3)

  const all = aliveParticles(engine)
  check(all.length > 0, '应有存活粒子')
  check(
    all.every(p => p.emitterId === 'A' || p.emitterId === 'B'),
    '所有粒子必须归属 A 或 B，不允许出现未知来源'
  )

  for (const p of aliveParticles(engine, 'A')) {
    assertParticleMatchesConfig(p, { ...configA, id: 'A' }, 'A粒子')
  }
  for (const p of aliveParticles(engine, 'B')) {
    assertParticleMatchesConfig(p, { ...configB, id: 'B' }, 'B粒子')
  }

  const countA = aliveParticles(engine, 'A').length
  const countB = aliveParticles(engine, 'B').length
  console.log(`    A 存活 ${countA}，B 存活 ${countB}（同位置，靠 emitterId 区分）`)
  check(countA > 0 && countB > 0, '两个发射源都应有存活粒子')
  check(countA > countB, 'A 的速率更高，稳态存活数应大于 B')

  const stats = engine.getEmitterStats()
  check(stats.length === 2, '配额统计应覆盖全部发射源')
  check(
    stats.every(s => s.quota > 0),
    '每个发射源都应有可观察的正配额'
  )
})

// ---------------------------------------------------------------- 场景 2
scenario('发射源参数中途修改不影响已生成粒子', () => {
  const engine = new ParticleEngine({
    maxParticles: 800,
    gravity: 0,
    turbulence: 0,
    rng: mulberry32(2)
  })
  engine.addEmitter({
    id: 'C',
    position: [0, 0, 0],
    direction: [0, 1, 0],
    spread: 0.3,
    emissionRate: 40,
    initialVelocity: [0, 1, 0],
    diffusionSpeed: 1,
    lifetimeMin: 3,
    lifetimeMax: 4,
    startColor: '#ff0000',
    endColor: '#0000ff'
  })

  run(engine, 1)

  interface Snapshot {
    lifetime: number
    start: string
    end: string
    velocity: THREE.Vector3
  }
  const snapshots = new Map<Particle, Snapshot>()
  for (const p of aliveParticles(engine, 'C')) {
    snapshots.set(p, {
      lifetime: p.lifetime,
      start: p.startColor.getHexString(),
      end: p.endColor.getHexString(),
      velocity: p.velocity.clone()
    })
  }
  check(snapshots.size > 0, '修改前应有已生成粒子')

  engine.updateEmitter('C', {
    startColor: '#00ff00',
    endColor: '#ffffff',
    lifetimeMin: 5,
    lifetimeMax: 6,
    initialVelocity: [3, 0, 0]
  })

  run(engine, 0.5)

  let oldCount = 0
  for (const [p, snap] of snapshots) {
    if (!p.alive) continue
    oldCount++
    check(
      Math.abs(p.lifetime - snap.lifetime) < EPS,
      '已生成粒子的寿命不应被追溯改写'
    )
    check(
      p.startColor.getHexString() === snap.start &&
        p.endColor.getHexString() === snap.end,
      '已生成粒子的颜色区间不应被追溯改写'
    )
    check(
      p.velocity.distanceTo(snap.velocity) < EPS,
      '无外力时已生成粒子的速度不应被参数修改影响'
    )
  }
  check(oldCount > 0, '修改后 0.5 秒内旧粒子应仍有存活（寿命 3-4 秒）')

  const newConfig = engine.getEmitter('C')!
  const newParticles = aliveParticles(engine, 'C').filter(p => !snapshots.has(p))
  check(newParticles.length > 0, '修改后应继续生成新粒子')
  for (const p of newParticles) {
    assertParticleMatchesConfig(p, newConfig, '新粒子')
  }
})

// ---------------------------------------------------------------- 场景 3
scenario('发射源删除后其粒子继续走完生命周期', () => {
  const engine = new ParticleEngine({ maxParticles: 800, rng: mulberry32(3) })
  engine.addEmitter({
    id: 'D',
    position: [1, 0, 0],
    direction: [0, 1, 0],
    spread: 0.4,
    emissionRate: 50,
    initialVelocity: [0, 1, 0],
    diffusionSpeed: 1,
    lifetimeMin: 2,
    lifetimeMax: 3,
    startColor: '#ff00ff',
    endColor: '#000033'
  })

  run(engine, 1)
  const beforeDelete = aliveParticles(engine, 'D').length
  check(beforeDelete > 0, '删除前应有存活粒子')

  check(engine.removeEmitter('D'), '删除应返回成功')
  check(engine.getEmitter('D') === undefined, '删除后配置不可再获取')
  check(engine.listEmitters().length === 0, '删除后发射源列表应为空')

  let previousCount = Number.POSITIVE_INFINITY
  let sawOrphanAlive = false
  const frames = Math.round(3.5 / DT)
  for (let i = 0; i < frames; i++) {
    engine.update(DT)
    const orphans = aliveParticles(engine, 'D')
    if (orphans.length > 0) sawOrphanAlive = true
    check(
      orphans.length <= previousCount,
      '删除后不应再产生该发射源的新粒子（存活数不可回升）'
    )
    previousCount = orphans.length
    for (const p of orphans) {
      check(p.emitterId === 'D', '孤儿粒子归属必须保持为 D')
    }
  }
  check(sawOrphanAlive, '删除后孤儿粒子应继续存活一段时间')
  check(previousCount === 0, '超过寿命上限后孤儿粒子应全部自然消亡')
  check(engine.getAliveCount() === 0, '系统最终应无存活粒子')
})

// ---------------------------------------------------------------- 场景 4
scenario('全局上限下按配额比例分配，新发射源不被静默饿死', () => {
  const engine = new ParticleEngine({ maxParticles: 300, rng: mulberry32(4) })
  const base = {
    position: [0, 0, 0] as [number, number, number],
    direction: [0, 1, 0] as [number, number, number],
    spread: 0.6,
    initialVelocity: [0, 1, 0] as [number, number, number],
    diffusionSpeed: 1,
    lifetimeMin: 4,
    lifetimeMax: 5,
    startColor: '#00ffff',
    endColor: '#00008b'
  }
  engine.addEmitter({ ...base, id: 'E', emissionRate: 100 })
  engine.addEmitter({ ...base, id: 'F', emissionRate: 100 })

  run(engine, 6)

  let stats = engine.getEmitterStats()
  const quotaOf = (id: string) => stats.find(s => s.id === id)!
  const aliveOf = (id: string) => aliveParticles(engine, id).length

  check(engine.getAliveCount() <= 300, '总粒子数不得超过全局上限')
  check(
    Math.abs(quotaOf('E').quota - 150) < EPS &&
      Math.abs(quotaOf('F').quota - 150) < EPS,
    `等速率时配额应均分（实际 ${quotaOf('E').quota.toFixed(1)}/${quotaOf('F').quota.toFixed(1)}）`
  )
  const aliveE = aliveOf('E')
  const aliveF = aliveOf('F')
  console.log(`    稳态：E=${aliveE} F=${aliveF} 总计=${engine.getAliveCount()}`)
  check(
    aliveE / Math.max(1, aliveF) > 0.6 && aliveE / Math.max(1, aliveF) < 1.67,
    'E 与 F 存活数应大致均衡（不允许先到者独占）'
  )
  check(
    quotaOf('E').dropped > 0 || quotaOf('F').dropped > 0,
    '饱和期间应有可观察的丢弃计数'
  )

  engine.addEmitter({ ...base, id: 'G', emissionRate: 100 })
  stats = engine.getEmitterStats()
  check(
    Math.abs(quotaOf('G').quota - 100) < EPS,
    `新发射源加入后应立即获得可观察配额（实际 ${quotaOf('G').quota.toFixed(1)}）`
  )

  run(engine, 4)
  stats = engine.getEmitterStats()
  const gAlive = aliveOf('G')
  console.log(
    `    加入 G 后：E=${aliveOf('E')} F=${aliveOf('F')} G=${gAlive} 总计=${engine.getAliveCount()}`
  )
  check(gAlive > 0, '全局占满时新发射源不应静默失效，应逐步获得粒子')
  check(
    gAlive / Math.max(1, aliveOf('E')) > 0.5,
    '新发射源存活数应追赶至与老发射源同一量级'
  )
  check(engine.getAliveCount() <= 300, '加入新发射源后总数仍不得超过上限')
})

// ---------------------------------------------------------------- 场景 5
scenario('同帧参数修改与粒子消亡：无归属错乱、无颜色跳变', () => {
  const engine = new ParticleEngine({ maxParticles: 200, rng: mulberry32(5) })
  engine.addEmitter({
    id: 'H',
    position: [0, 0, 0],
    direction: [0, 1, 0],
    spread: 0.5,
    emissionRate: 60,
    initialVelocity: [0, 1, 0],
    diffusionSpeed: 1,
    lifetimeMin: 0.1,
    lifetimeMax: 0.15,
    startColor: '#ff0000',
    endColor: '#0000ff'
  })

  const rand = mulberry32(99)
  const seen = new Map<number, { lifetime: number; start: string; end: string }>()
  const palette = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']

  for (let frame = 0; frame < 120; frame++) {
    engine.updateEmitter('H', {
      startColor: palette[Math.floor(rand() * palette.length)],
      endColor: palette[Math.floor(rand() * palette.length)],
      lifetimeMin: 0.1,
      lifetimeMax: 0.1 + rand() * 0.2
    })
    engine.update(DT)

    check(engine.getAliveCount() <= 200, `第 ${frame} 帧总数不得超上限`)
    for (const p of aliveParticles(engine)) {
      check(p.emitterId === 'H', `第 ${frame} 帧粒子归属必须始终为 H`)

      const prior = seen.get(p.spawnId)
      if (prior) {
        check(
          Math.abs(p.lifetime - prior.lifetime) < EPS &&
            p.startColor.getHexString() === prior.start &&
            p.endColor.getHexString() === prior.end,
          `第 ${frame} 帧已生成粒子的快照不得被改写`
        )
      } else {
        seen.set(p.spawnId, {
          lifetime: p.lifetime,
          start: p.startColor.getHexString(),
          end: p.endColor.getHexString()
        })
      }

      const expected = p.startColor
        .clone()
        .lerp(p.endColor, Math.min(1, p.age / p.lifetime))
      const colorDiff =
        Math.abs(p.color.r - expected.r) +
        Math.abs(p.color.g - expected.g) +
        Math.abs(p.color.b - expected.b)
      check(
        colorDiff < 1e-4,
        `第 ${frame} 帧粒子颜色必须等于自身快照的插值（不允许颜色跳变）`
      )
    }
  }
  console.log(`    共追踪 ${seen.size} 个粒子，120 帧内每帧均修改参数`)
})

// ---------------------------------------------------------------- 汇总
console.log(`\n========================================`)
console.log(`断言总数: ${checks}，失败: ${failures}`)
if (failures > 0) {
  console.error('验证失败 ✗')
  process.exit(1)
} else {
  console.log('全部场景验证通过 ✓')
}
