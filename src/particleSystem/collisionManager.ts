import * as THREE from 'three'
import type { Particle, SharedState, CollisionEvent } from '../types'
import { eventBus } from '../utils/eventBus'
import { getRandomNeonColor } from '../types'

const RESTITUTION = 0.95
const MIN_VELOCITY = 0.01

export class CollisionManager {
  private state: SharedState
  private gridSize: number = 2
  private grid: Map<string, Particle[]> = new Map()
  private collisionEvents: CollisionEvent[] = []

  constructor(state: SharedState) {
    this.state = state
  }

  private getGridKey(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.gridSize)},${Math.floor(y / this.gridSize)},${Math.floor(z / this.gridSize)}`
  }

  private buildGrid(): void {
    this.grid.clear()
    const { particles } = this.state

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const key = this.getGridKey(p.position.x, p.position.y, p.position.z)
      
      if (!this.grid.has(key)) {
        this.grid.set(key, [])
      }
      this.grid.get(key)!.push(p)
    }
  }

  private getNearbyParticles(p: Particle): Particle[] {
    const nearby: Particle[] = []
    const gx = Math.floor(p.position.x / this.gridSize)
    const gy = Math.floor(p.position.y / this.gridSize)
    const gz = Math.floor(p.position.z / this.gridSize)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = this.getGridKey(
            (gx + dx) * this.gridSize,
            (gy + dy) * this.gridSize,
            (gz + dz) * this.gridSize
          )
          const cell = this.grid.get(key)
          if (cell) {
            nearby.push(...cell)
          }
        }
      }
    }

    return nearby
  }

  private resolveCollision(p1: Particle, p2: Particle): void {
    const diff = new THREE.Vector3().subVectors(p1.position, p2.position)
    const dist = diff.length()
    const minDist = p1.radius + p2.radius

    if (dist >= minDist || dist === 0) return

    const overlap = minDist - dist
    const normal = diff.clone().normalize()

    const totalMass = p1.mass + p2.mass
    p1.position.addScaledVector(normal, overlap * (p2.mass / totalMass))
    p2.position.addScaledVector(normal, -overlap * (p1.mass / totalMass))

    const relVel = new THREE.Vector3().subVectors(p1.velocity, p2.velocity)
    const velAlongNormal = relVel.dot(normal)

    if (velAlongNormal > 0) return

    const impulse = -(1 + RESTITUTION) * velAlongNormal / (1 / p1.mass + 1 / p2.mass)
    const impulseVec = normal.clone().multiplyScalar(impulse)

    p1.velocity.addScaledVector(impulseVec, 1 / p1.mass)
    p2.velocity.addScaledVector(impulseVec, -1 / p2.mass)

    if (p1.velocity.length() < MIN_VELOCITY) {
      p1.velocity.normalize().multiplyScalar(MIN_VELOCITY)
    }
    if (p2.velocity.length() < MIN_VELOCITY) {
      p2.velocity.normalize().multiplyScalar(MIN_VELOCITY)
    }

    p1.targetColor = getRandomNeonColor()
    p2.targetColor = getRandomNeonColor()
    p1.flashTime = 1.0
    p2.flashTime = 1.0
    p1.glowIntensity = 1.5
    p2.glowIntensity = 1.5

    const collisionPos = new THREE.Vector3()
      .addScaledVector(p1.position, p2.mass / totalMass)
      .addScaledVector(p2.position, p1.mass / totalMass)

    const event: CollisionEvent = {
      particles: [p1, p2],
      position: collisionPos,
      time: performance.now()
    }

    this.collisionEvents.push(event)
    this.state.collisionCount++
  }

  private handleWallCollision(p: Particle): void {
    const { bounds } = this.state
    const epsilon = 0.001

    if (p.position.x - p.radius < bounds.minX) {
      p.position.x = bounds.minX + p.radius + epsilon
      p.velocity.x = Math.abs(p.velocity.x) * RESTITUTION
      p.targetColor = getRandomNeonColor()
      p.flashTime = 0.5
    } else if (p.position.x + p.radius > bounds.maxX) {
      p.position.x = bounds.maxX - p.radius - epsilon
      p.velocity.x = -Math.abs(p.velocity.x) * RESTITUTION
      p.targetColor = getRandomNeonColor()
      p.flashTime = 0.5
    }

    if (p.position.y - p.radius < bounds.minY) {
      p.position.y = bounds.minY + p.radius + epsilon
      p.velocity.y = Math.abs(p.velocity.y) * RESTITUTION
      p.targetColor = getRandomNeonColor()
      p.flashTime = 0.5
    } else if (p.position.y + p.radius > bounds.maxY) {
      p.position.y = bounds.maxY - p.radius - epsilon
      p.velocity.y = -Math.abs(p.velocity.y) * RESTITUTION
      p.targetColor = getRandomNeonColor()
      p.flashTime = 0.5
    }

    if (p.position.z - p.radius < bounds.minZ) {
      p.position.z = bounds.minZ + p.radius + epsilon
      p.velocity.z = Math.abs(p.velocity.z) * RESTITUTION
      p.targetColor = getRandomNeonColor()
      p.flashTime = 0.5
    } else if (p.position.z + p.radius > bounds.maxZ) {
      p.position.z = bounds.maxZ - p.radius - epsilon
      p.velocity.z = -Math.abs(p.velocity.z) * RESTITUTION
      p.targetColor = getRandomNeonColor()
      p.flashTime = 0.5
    }
  }

  update(delta: number): void {
    const { particles } = this.state
    this.collisionEvents = []

    this.buildGrid()

    const checked = new Set<number>()

    for (let i = 0; i < particles.length; i++) {
      const p1 = particles[i]
      checked.add(p1.id)

      const nearby = this.getNearbyParticles(p1)
      
      for (let j = 0; j < nearby.length; j++) {
        const p2 = nearby[j]
        if (checked.has(p2.id) || p1.id === p2.id) continue
        this.resolveCollision(p1, p2)
      }

      this.handleWallCollision(p1)
    }

    for (const event of this.collisionEvents) {
      eventBus.emit('collision', event)
    }

    const colorSpeed = 8 * delta
    const flashDecay = 2 * delta
    const glowDecay = 3 * delta

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.color.lerp(p.targetColor, colorSpeed)
      if (p.flashTime > 0) {
        p.flashTime = Math.max(0, p.flashTime - flashDecay)
      }
      if (p.glowIntensity > 0) {
        p.glowIntensity = Math.max(0, p.glowIntensity - glowDecay)
      }
    }
  }
}
