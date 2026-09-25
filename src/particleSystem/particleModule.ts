import * as THREE from 'three'
import type { Particle, SharedState, MouseForceEvent } from '../types'
import { eventBus } from '../utils/eventBus'
import { getRandomNeonColor } from '../types'
import { CollisionManager } from './collisionManager'

const DAMPING = 0.999
const MAX_SPEED = 15

export class ParticleModule {
  private state: SharedState
  private collisionManager: CollisionManager
  private particleIdCounter: number = 0
  private mouseForce: MouseForceEvent | null = null
  private physicsAccumulator: number = 0
  private physicsTimestep: number = 1 / 30

  constructor(state: SharedState) {
    this.state = state
    this.collisionManager = new CollisionManager(state)
    
    eventBus.on('mouse-force', (data) => {
      this.mouseForce = data
    })

    eventBus.on('param-change', (data) => {
      if (data.key === 'particleCount' && typeof data.value === 'number') {
        this.updateParticleCount(data.value)
      } else if (data.key === 'particleSizeMin' || data.key === 'particleSizeMax') {
        this.updateParticleSizes()
      }
    })
  }

  private createParticle(): Particle {
    const { bounds, particleSizeMin, particleSizeMax } = this.state
    const radius = particleSizeMin + Math.random() * (particleSizeMax - particleSizeMin)
    const mass = radius * radius * radius
    
    const x = bounds.minX + radius + Math.random() * (bounds.maxX - bounds.minX - radius * 2)
    const y = bounds.minY + radius + Math.random() * (bounds.maxY - bounds.minY - radius * 2)
    const z = bounds.minZ + radius + Math.random() * (bounds.maxZ - bounds.minZ - radius * 2)
    
    const speed = 2 + Math.random() * 3
    const theta = Math.random() * Math.PI * 2
    const phi = Math.random() * Math.PI
    const vx = Math.sin(phi) * Math.cos(theta) * speed
    const vy = Math.sin(phi) * Math.sin(theta) * speed
    const vz = Math.cos(phi) * speed

    const color = getRandomNeonColor()

    return {
      id: this.particleIdCounter++,
      position: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3(vx, vy, vz),
      radius,
      color,
      targetColor: color.clone(),
      mass,
      glowIntensity: 0,
      flashTime: 0
    }
  }

  private updateParticleCount(newCount: number): void {
    const { particles } = this.state
    const diff = newCount - particles.length

    if (diff > 0) {
      for (let i = 0; i < diff; i++) {
        particles.push(this.createParticle())
      }
    } else if (diff < 0) {
      particles.splice(0, -diff)
    }

    this.state.particleCount = newCount
    eventBus.emit('particle-count-change', { count: newCount })
  }

  private updateParticleSizes(): void {
    const { particles, particleSizeMin, particleSizeMax } = this.state
    
    for (const p of particles) {
      p.radius = particleSizeMin + Math.random() * (particleSizeMax - particleSizeMin)
      p.mass = p.radius * p.radius * p.radius
    }
  }

  init(): void {
    const { particles, particleCount } = this.state
    particles.length = 0

    for (let i = 0; i < particleCount; i++) {
      particles.push(this.createParticle())
    }
  }

  private applyPhysics(delta: number): void {
    const { particles, gravity, bounds } = this.state

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]

      p.velocity.y -= gravity * delta

      if (this.mouseForce) {
        const diff = new THREE.Vector3().subVectors(p.position, this.mouseForce.position)
        const dist = diff.length()
        
        if (dist < this.mouseForce.radius && dist > 0.1) {
          const force = this.mouseForce.strength * (1 - dist / this.mouseForce.radius)
          const dir = diff.normalize()
          const acceleration = dir.multiplyScalar(this.mouseForce.isAttract ? -force : force)
          p.velocity.addScaledVector(acceleration, delta)
        }
      }

      if (p.velocity.length() > MAX_SPEED) {
        p.velocity.normalize().multiplyScalar(MAX_SPEED)
      }

      p.position.addScaledVector(p.velocity, delta)
      p.velocity.multiplyScalar(DAMPING)

      if (p.position.x < bounds.minX - 2) p.position.x = bounds.maxX - 0.1
      if (p.position.x > bounds.maxX + 2) p.position.x = bounds.minX + 0.1
      if (p.position.y < bounds.minY - 2) p.position.y = bounds.maxY - 0.1
      if (p.position.y > bounds.maxY + 2) p.position.y = bounds.minY + 0.1
      if (p.position.z < bounds.minZ - 2) p.position.z = bounds.maxZ - 0.1
      if (p.position.z > bounds.maxZ + 2) p.position.z = bounds.minZ + 0.1
    }
  }

  update(renderDelta: number): void {
    this.physicsAccumulator += renderDelta

    while (this.physicsAccumulator >= this.physicsTimestep) {
      this.applyPhysics(this.physicsTimestep)
      this.collisionManager.update(this.physicsTimestep)
      this.physicsAccumulator -= this.physicsTimestep
    }

    this.mouseForce = null
  }

  getParticles(): Particle[] {
    return this.state.particles
  }
}
