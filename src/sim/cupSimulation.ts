import { getWaterDepth, getFlowSpeed, getSlopeSpeedMultiplier } from '../store/waterStore'

export const CUP_COUNT = 6
export const INITIAL_SPACING = 0.3
export const COLLISION_DISTANCE = 0.08
export const SEPARATION_DISTANCE = 0.12
export const STUCK_DEPTH = 0.12
export const RELEASE_DEPTH = 0.15

export interface CupSimState {
  distance: number
  velocity: number
  stuck: boolean
  justCollided: boolean
}

export interface SimState {
  cups: CupSimState[]
  contacts: string[]
  totalCollisions: number
}

export interface SimEnv {
  gateOpening: number
  slope: number
  curvature: number
  totalLength: number
}

export interface SimStepResult {
  state: SimState
  collisions: number
  collidedCupIds: number[]
  finishedCupIds: number[]
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

export function createInitialSimState(): SimState {
  return {
    cups: Array.from({ length: CUP_COUNT }, (_, i) => ({
      distance: i * INITIAL_SPACING,
      velocity: 0,
      stuck: false,
      justCollided: false
    })),
    contacts: [],
    totalCollisions: 0
  }
}

function resolveCollision(behind: CupSimState, ahead: CupSimState, flowSpeed: number) {
  if (behind.stuck && ahead.stuck) return
  if (behind.stuck || ahead.stuck) {
    const moving = behind.stuck ? ahead : behind
    moving.velocity = -0.5 * flowSpeed
    return
  }
  const behindVelocity = behind.velocity
  behind.velocity = ahead.velocity
  ahead.velocity = behindVelocity
}

export function stepSimulation(prev: SimState, env: SimEnv, delta: number): SimStepResult {
  const waterDepth = getWaterDepth(env.gateOpening)
  const flowSpeed =
    getFlowSpeed(env.gateOpening, env.slope) * getSlopeSpeedMultiplier(env.slope)

  const cups: CupSimState[] = prev.cups.map(cup => {
    const next: CupSimState = { ...cup, justCollided: false }

    if (next.stuck) {
      if (waterDepth > RELEASE_DEPTH) {
        next.stuck = false
        next.velocity = flowSpeed * 0.5
      } else {
        next.velocity = 0
      }
    } else if (waterDepth < STUCK_DEPTH) {
      next.stuck = true
      next.velocity = 0
    }

    if (!next.stuck) {
      const t = Math.max(0, Math.min(1, next.distance / env.totalLength))
      const bendFactor = Math.sin(t * Math.PI)
      const curveSlowdown = 1 - bendFactor * (env.curvature / 90) * 0.3
      const target = flowSpeed * curveSlowdown
      const relax = Math.min(1, delta * 4)
      next.velocity += (target - next.velocity) * relax
    }

    return next
  })

  const finishedCupIds: number[] = []
  const finished = new Set<number>()

  cups.forEach((cup, i) => {
    if (cup.stuck) return
    cup.distance = Math.max(0, cup.distance + cup.velocity * delta)
    if (cup.distance >= env.totalLength) {
      cup.distance = 0
      cup.velocity = 0
      finished.add(i)
      finishedCupIds.push(i)
    }
  })

  let contacts = prev.contacts.filter(key => {
    const [a, b] = key.split(':').map(Number)
    return !finished.has(a) && !finished.has(b)
  })

  let collisions = 0
  const collidedCupIds: number[] = []

  for (let i = 0; i < cups.length; i++) {
    for (let j = i + 1; j < cups.length; j++) {
      const key = pairKey(i, j)
      const diff = Math.abs(cups[i].distance - cups[j].distance)
      const inContact = contacts.includes(key)

      if (diff < COLLISION_DISTANCE) {
        if (!inContact) {
          contacts.push(key)
          collisions += 1
          collidedCupIds.push(i, j)
          cups[i].justCollided = true
          cups[j].justCollided = true
          const [behind, ahead] =
            cups[i].distance <= cups[j].distance ? [cups[i], cups[j]] : [cups[j], cups[i]]
          resolveCollision(behind, ahead, flowSpeed)
        }
      } else if (inContact && diff > SEPARATION_DISTANCE) {
        contacts = contacts.filter(k => k !== key)
      }
    }
  }

  return {
    state: {
      cups,
      contacts,
      totalCollisions: prev.totalCollisions + collisions
    },
    collisions,
    collidedCupIds,
    finishedCupIds
  }
}
