import { getWaterDepth, getFlowSpeed, getSlopeSpeedMultiplier } from '../store/waterStore'

export const CUP_COUNT = 6
export const CUP_INITIAL_SPACING = 0.3
export const COLLISION_DISTANCE = 0.08
export const CONTACT_RELEASE_DISTANCE = COLLISION_DISTANCE + 0.02
export const STUCK_ENTER_DEPTH = 0.12
export const STUCK_EXIT_DEPTH = 0.15
export const COLLISION_IMPULSE = 0.5
export const PUSH_IMPULSE = 0.25
export const IMPULSE_DECAY_PER_SECOND = 4

export interface CupState {
  distance: number
  velocity: number
  impulse: number
  stuck: boolean
}

export interface CupSimulationState {
  cups: CupState[]
  collisionCount: number
  contacts: Record<string, boolean>
}

export interface CupSimParams {
  gateOpening: number
  slope: number
  curvature: number
  totalLength: number
}

export interface CollisionEvent {
  behind: number
  ahead: number
  at: number
}

export interface StepEvents {
  collisions: CollisionEvent[]
  finishes: number[]
}

export const createCupSimulation = (cupCount: number = CUP_COUNT): CupSimulationState => {
  const cups: CupState[] = []
  for (let i = 0; i < cupCount; i++) {
    cups.push({
      distance: i * CUP_INITIAL_SPACING,
      velocity: 0,
      impulse: 0,
      stuck: false
    })
  }
  return { cups, collisionCount: 0, contacts: {} }
}

export const resetCupSimulation = (sim: CupSimulationState): CupSimulationState => {
  sim.cups.forEach((cup, i) => {
    cup.distance = i * CUP_INITIAL_SPACING
    cup.velocity = 0
    cup.impulse = 0
    cup.stuck = false
  })
  sim.collisionCount = 0
  sim.contacts = {}
  return sim
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

const computeBaseVelocity = (cup: CupState, params: CupSimParams): number => {
  if (cup.stuck) return 0
  const { gateOpening, slope, curvature, totalLength } = params
  const baseSpeed = getFlowSpeed(gateOpening, slope) * getSlopeSpeedMultiplier(slope)
  const t = Math.max(0, Math.min(1, cup.distance / totalLength))
  const bendFactor = Math.sin(t * Math.PI)
  const curveSlowdown = 1 - bendFactor * (curvature / 90) * 0.3
  return baseSpeed * curveSlowdown
}

export const stepCupSimulation = (
  sim: CupSimulationState,
  params: CupSimParams,
  delta: number
): StepEvents => {
  const events: StepEvents = { collisions: [], finishes: [] }
  if (delta <= 0) return events

  const waterDepth = getWaterDepth(params.gateOpening)

  // Hysteresis: enter stuck below STUCK_ENTER_DEPTH, release above STUCK_EXIT_DEPTH.
  // Depths inside the [enter, exit] band never change the stuck flag.
  for (const cup of sim.cups) {
    if (!cup.stuck && waterDepth < STUCK_ENTER_DEPTH) {
      cup.stuck = true
      cup.impulse = 0
    } else if (cup.stuck && waterDepth > STUCK_EXIT_DEPTH) {
      cup.stuck = false
    }
  }

  const finishedThisFrame = new Set<number>()

  for (let i = 0; i < sim.cups.length; i++) {
    const cup = sim.cups[i]
    cup.velocity = computeBaseVelocity(cup, params)
    cup.distance += (cup.velocity + cup.impulse) * delta
    cup.impulse *= Math.exp(-IMPULSE_DECAY_PER_SECOND * delta)
    if (Math.abs(cup.impulse) < 1e-6) cup.impulse = 0

    if (cup.distance < 0) cup.distance = 0

    if (cup.distance >= params.totalLength) {
      cup.distance = 0
      cup.impulse = 0
      cup.velocity = computeBaseVelocity(cup, params)
      finishedThisFrame.add(i)
    }
  }

  // A cup that wrapped to the start drops every contact it was part of.
  for (const id of finishedThisFrame) {
    for (let j = 0; j < sim.cups.length; j++) {
      if (j !== id) delete sim.contacts[pairKey(id, j)]
    }
    events.finishes.push(id)
  }

  for (let i = 0; i < sim.cups.length; i++) {
    for (let j = i + 1; j < sim.cups.length; j++) {
      const key = pairKey(i, j)
      const behindCup = sim.cups[i].distance <= sim.cups[j].distance ? i : j
      const aheadCup = behindCup === i ? j : i
      const diff = Math.abs(sim.cups[i].distance - sim.cups[j].distance)
      const inContact = sim.contacts[key] === true

      if (!inContact && diff < COLLISION_DISTANCE && diff > 0) {
        sim.contacts[key] = true
        sim.collisionCount += 1
        events.collisions.push({
          behind: behindCup,
          ahead: aheadCup,
          at: sim.cups[behindCup].distance
        })

        const behind = sim.cups[behindCup]
        const ahead = sim.cups[aheadCup]
        const impactSpeed = Math.max(
          Math.abs(behind.velocity),
          Math.abs(ahead.velocity),
          getFlowSpeed(params.gateOpening, params.slope) *
            getSlopeSpeedMultiplier(params.slope)
        )
        behind.impulse += -impactSpeed * COLLISION_IMPULSE
        ahead.impulse += impactSpeed * PUSH_IMPULSE
      } else if (inContact && diff >= CONTACT_RELEASE_DISTANCE) {
        delete sim.contacts[key]
      }
    }
  }

  return events
}
