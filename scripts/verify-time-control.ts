import * as THREE from 'three'
import type { SharedState, Particle } from '../src/types'
import { eventBus } from '../src/utils/eventBus'
import { ParticleModule } from '../src/particleSystem/particleModule'
import { HistoryBuffer } from '../src/time/historyBuffer'

const DT = 1 / 30
let failures = 0

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures++
    console.log(`FAIL  ${name} ${detail}`)
  }
}

function makeState(count: number): SharedState {
  return {
    particleCount: count,
    gravity: 9.8,
    attractStrength: 50,
    particleSizeMin: 0.2,
    particleSizeMax: 0.6,
    renderMode: 'spheres',
    collisionCount: 0,
    particles: [],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 }
  }
}

function cloneParticles(particles: Particle[]): Particle[] {
  return particles.map(p => ({
    ...p,
    position: p.position.clone(),
    velocity: p.velocity.clone(),
    color: p.color.clone(),
    targetColor: p.targetColor.clone()
  }))
}

function cloneState(src: SharedState): SharedState {
  return { ...src, bounds: { ...src.bounds }, particles: cloneParticles(src.particles) }
}

function positionsEqual(a: Particle[], b: Particle[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].position.x !== b[i].position.x ||
        a[i].position.y !== b[i].position.y ||
        a[i].position.z !== b[i].position.z) return false
  }
  return true
}

function velocitiesEqual(a: Particle[], b: Particle[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].velocity.x !== b[i].velocity.x ||
        a[i].velocity.y !== b[i].velocity.y ||
        a[i].velocity.z !== b[i].velocity.z) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Test 1: N single-steps === N continuous frames of dt === one-shot N*dt
// ---------------------------------------------------------------------------
{
  const base = new ParticleModule(makeState(200))
  base.init()

  const stateA = cloneState(base['state' as never] as SharedState)
  const stateB = cloneState(stateA)
  const stateC = cloneState(stateA)

  const modA = new ParticleModule(stateA) // continuous, frame by frame
  const modB = new ParticleModule(stateB) // single-stepped
  const modC = new ParticleModule(stateC) // one-shot bulk advance

  const N = 90
  for (let i = 0; i < N; i++) modA.update(DT)
  modB.setPaused(true)
  for (let i = 0; i < N; i++) modB.stepOnce()
  modC.update(N * DT)

  check('T1 collisions occurred during run', stateA.collisionCount > 0,
    `count=${stateA.collisionCount}`)
  check('T1 step-sequence == continuous positions', positionsEqual(stateA.particles, stateB.particles))
  check('T1 step-sequence == continuous velocities', velocitiesEqual(stateA.particles, stateB.particles))
  check('T1 collision count accumulates identically',
    stateA.collisionCount === stateB.collisionCount,
    `${stateA.collisionCount} vs ${stateB.collisionCount}`)
  check('T1 one-shot bulk == continuous positions', positionsEqual(stateA.particles, stateC.particles))
  check('T1 one-shot bulk collision count equal',
    stateA.collisionCount === stateC.collisionCount,
    `${stateA.collisionCount} vs ${stateC.collisionCount}`)
}

// ---------------------------------------------------------------------------
// Test 2: pause freezes everything; param changes do not touch frozen frame
// ---------------------------------------------------------------------------
{
  const state = makeState(100)
  const mod = new ParticleModule(state)
  mod.init()
  for (let i = 0; i < 30; i++) mod.update(DT)
  mod.setPaused(true)

  const frozen = cloneParticles(state.particles)
  const frozenCollisions = state.collisionCount

  eventBus.emit('param-change', { key: 'gravity', value: 42 })
  eventBus.emit('param-change', { key: 'particleCount', value: 150 })
  eventBus.emit('param-change', { key: 'particleSizeMin', value: 0.5 })
  mod.update(DT) // must be a no-op while paused

  const same =
    positionsEqual(frozen, state.particles) &&
    velocitiesEqual(frozen, state.particles) &&
    frozen.every((p, i) =>
      p.color.equals(state.particles[i].color) &&
      p.flashTime === state.particles[i].flashTime &&
      p.glowIntensity === state.particles[i].glowIntensity &&
      p.radius === state.particles[i].radius)

  check('T2 frozen frame untouched by update+params', same)
  check('T2 particle count change deferred while paused', state.particles.length === 100,
    `len=${state.particles.length}`)
  check('T2 collision count frozen', state.collisionCount === frozenCollisions)

  // deferred changes apply only when physics advances again
  mod.stepOnce()
  check('T2 deferred count applied on next step', state.particles.length === 150,
    `len=${state.particles.length}`)
  eventBus.emit('param-change', { key: 'gravity', value: 9.8 })
}

// ---------------------------------------------------------------------------
// Test 3: mouse force during pause does not disturb particles; applies on resume
// ---------------------------------------------------------------------------
{
  // controlled collision-free scenario: 3 distant particles, zero gravity
  const mkControlled = (): SharedState => {
    const s = makeState(3)
    s.gravity = 0
    const mk = (id: number, x: number, y: number, z: number,
                vx: number, vy: number, vz: number): Particle => ({
      id,
      position: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3(vx, vy, vz),
      radius: 0.3,
      color: new THREE.Color(1, 0, 0),
      targetColor: new THREE.Color(1, 0, 0),
      mass: 0.027,
      glowIntensity: 0,
      flashTime: 0
    })
    s.particles = [
      mk(0, 0, 0, 0, 1, 0, 0),
      mk(1, 8, 8, 8, 0, 1, 0),
      mk(2, -8, -8, -8, 0, 0, 1)
    ]
    return s
  }

  const stateRef = mkControlled()
  const stateAct = mkControlled()
  const modRef = new ParticleModule(stateRef)
  const modAct = new ParticleModule(stateAct)
  modRef.setPaused(true)
  modAct.setPaused(true)

  // queue a repulsive force while paused, 2 units from particle 0
  eventBus.emit('mouse-force', {
    position: new THREE.Vector3(2, 0, 0),
    strength: 50,
    isAttract: false,
    radius: 8
  })

  // paused single-step: force must not apply, motion continues undisturbed
  modRef.stepOnce()
  modAct.stepOnce()
  check('T3 paused step ignores queued force',
    positionsEqual(stateRef.particles, stateAct.particles) &&
    velocitiesEqual(stateRef.particles, stateAct.particles))
  check('T3 paused step keeps pure damped motion',
    Math.abs(stateAct.particles[0].velocity.x - 0.999) < 1e-9,
    `vx=${stateAct.particles[0].velocity.x}`)

  // resume: queued force takes effect exactly once, no teleport/reset
  const beforePos = cloneParticles(stateAct.particles)
  modRef.setPaused(false)
  modAct.setPaused(false)
  modRef.update(DT)
  modAct.update(DT)

  let maxJump = 0
  for (let i = 0; i < 3; i++) {
    maxJump = Math.max(maxJump,
      stateAct.particles[i].position.distanceTo(beforePos[i].position))
  }
  check('T3 no teleport on resume (max jump < 0.05)', maxJump < 0.05, `jump=${maxJump}`)

  // particle 0 drifted to x = 1.0*DT during the paused step (position
  // integrates the pre-damping velocity), so force distance is (2 - DT)
  const dist = 2 - DT
  const forceMag = 50 * (1 - dist / 8)
  const expectedVx = (0.999 - forceMag * DT) * 0.999
  check('T3 force applied with exact magnitude on resume',
    Math.abs(stateAct.particles[0].velocity.x - expectedVx) < 1e-9,
    `vx=${stateAct.particles[0].velocity.x} expected=${expectedVx}`)
  check('T3 distant particles unaffected by force',
    Math.abs(stateAct.particles[1].velocity.y - 0.999 * 0.999) < 1e-9 &&
    Math.abs(stateAct.particles[2].velocity.z - 0.999 * 0.999) < 1e-9)
  check('T3 both resumed modules evolve identically',
    positionsEqual(stateRef.particles, stateAct.particles) &&
    velocitiesEqual(stateRef.particles, stateAct.particles))

  // force consumed: next frame is pure damping again
  modAct.update(DT)
  check('T3 queued force not re-applied',
    Math.abs(stateAct.particles[0].velocity.x - expectedVx * 0.999) < 1e-9,
    `vx=${stateAct.particles[0].velocity.x}`)
}

// ---------------------------------------------------------------------------
// Test 4: reset returns to a fresh initial state
// ---------------------------------------------------------------------------
{
  const state = makeState(120)
  const mod = new ParticleModule(state)
  mod.init()
  for (let i = 0; i < 60; i++) mod.update(DT)
  check('T4 collisions accumulated before reset', state.collisionCount > 0,
    `count=${state.collisionCount}`)

  state.particleCount = 150
  mod.reset()

  check('T4 collision count cleared', state.collisionCount === 0)
  check('T4 particles rebuilt to current count', state.particles.length === 150,
    `len=${state.particles.length}`)
  check('T4 glow/flash reset', state.particles.every(p => p.glowIntensity === 0 && p.flashTime === 0))
  check('T4 colors are initial neon colors', state.particles.every(p => p.color.equals(p.targetColor)))
  const speeds = state.particles.map(p => p.velocity.length())
  check('T4 initial speed distribution restored',
    speeds.every(s => s >= 1.99 && s <= 5.01))

  // subsequent stepping starts from the fresh state, not the old one
  const afterReset = cloneParticles(state.particles)
  mod.setPaused(true)
  mod.stepOnce()
  let maxJump = 0
  for (let i = 0; i < state.particles.length; i++) {
    maxJump = Math.max(maxJump, state.particles[i].position.distanceTo(afterReset[i].position))
  }
  check('T4 stepping continues from reset state (max jump < 0.6)', maxJump < 0.6,
    `jump=${maxJump}`)
}

// ---------------------------------------------------------------------------
// Test 5: history frames match actual per-step states and cumulative counts
// ---------------------------------------------------------------------------
{
  const base = new ParticleModule(makeState(200))
  base.init()
  const baseState = base['state' as never] as SharedState
  for (let i = 0; i < 40; i++) base.update(DT)

  const stateA = cloneState(baseState)
  const stateB = cloneState(baseState)
  const modA = new ParticleModule(stateA)
  const modB = new ParticleModule(stateB)

  const N = 60
  const refFrames: Particle[][] = [cloneParticles(stateB.particles)]
  const refCounts: number[] = [stateB.collisionCount]

  // reference run first: no recorder attached yet, so its physics-step
  // emissions are not captured
  for (let i = 0; i < N; i++) {
    modB.update(DT)
    refFrames.push(cloneParticles(stateB.particles))
    refCounts.push(stateB.collisionCount)
  }

  const history = new HistoryBuffer(600)
  const off = eventBus.on('physics-step', () => {
    history.record(stateA.particles, stateA.collisionCount)
  })
  history.record(stateA.particles, stateA.collisionCount) // frame 0 baseline

  for (let i = 0; i < N; i++) {
    modA.update(DT) // records into history via physics-step
  }
  off()

  check('T5 history length = steps + baseline', history.length === N + 1,
    `len=${history.length}`)

  let framesOk = true
  let countsOk = true
  for (let k = 0; k <= N; k++) {
    const frame = history.getFrame(k)!
    const ref = refFrames[k]
    if (frame.positions.length !== ref.length * 3) { framesOk = false; break }
    for (let i = 0; i < ref.length; i++) {
      // history stores Float32 (GPU precision); allow float32 rounding
      const close = (a: number, b: number) =>
        Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b))
      if (!close(frame.positions[i * 3], ref[i].position.x) ||
          !close(frame.positions[i * 3 + 1], ref[i].position.y) ||
          !close(frame.positions[i * 3 + 2], ref[i].position.z)) {
        framesOk = false
        break
      }
    }
    if (frame.collisionCount !== refCounts[k]) countsOk = false
    if (!framesOk) break
  }
  check('T5 every history frame matches actual state at that step', framesOk)
  check('T5 cumulative collision counts per frame match', countsOk)

  // scrubbing is read-only: live state untouched by reading frames
  const beforeScrub = cloneParticles(stateA.particles)
  const beforeCount = stateA.collisionCount
  for (let k = 0; k < history.length; k++) {
    const f = history.getFrame(k)!
    void f.positions[0]
    void f.collisionCount
  }
  check('T5 scrubbing does not mutate live state',
    positionsEqual(beforeScrub, stateA.particles) && stateA.collisionCount === beforeCount)
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
if (failures > 0) process.exit(1)
