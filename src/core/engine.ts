import * as THREE from 'three'

export interface EmitterConfig {
  id: string
  position: [number, number, number]
  direction: [number, number, number]
  spread: number
  emissionRate: number
  initialVelocity: [number, number, number]
  diffusionSpeed: number
  lifetimeMin: number
  lifetimeMax: number
  startColor: string
  endColor: string
}

export interface EmitterStats {
  id: string
  quota: number
  alive: number
  emitted: number
  dropped: number
  emissionRate: number
}

export interface Particle {
  alive: boolean
  spawnId: number
  emitterId: string
  age: number
  lifetime: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  color: THREE.Color
  startColor: THREE.Color
  endColor: THREE.Color
  size: number
  trail: THREE.Vector3[]
}

interface InternalEmitter {
  config: EmitterConfig
  position: THREE.Vector3
  direction: THREE.Vector3
  initialVelocity: THREE.Vector3
  startColor: THREE.Color
  endColor: THREE.Color
  accumulator: number
  emitted: number
  dropped: number
}

export interface EngineOptions {
  maxParticles?: number
  gravity?: number
  turbulence?: number
  initialSize?: number
  trailLength?: number
  rng?: () => number
}

const DEFAULT_TRAIL_LENGTH = 5

export class ParticleEngine {
  public maxParticles: number
  public gravity: number
  public turbulence: number
  public initialSize: number
  public readonly trailLength: number

  private readonly rng: () => number
  private readonly emitters = new Map<string, InternalEmitter>()
  private readonly particles: Particle[] = []
  private emitterIdCounter = 0
  private spawnIdCounter = 0

  constructor(options: EngineOptions = {}) {
    this.maxParticles = options.maxParticles ?? 800
    this.gravity = options.gravity ?? 0.5
    this.turbulence = options.turbulence ?? 1
    this.initialSize = options.initialSize ?? 0.3
    this.trailLength = options.trailLength ?? DEFAULT_TRAIL_LENGTH
    this.rng = options.rng ?? Math.random
  }

  public addEmitter(partial: Omit<EmitterConfig, 'id'> & { id?: string }): string {
    const id = partial.id ?? `emitter-${this.emitterIdCounter++}`
    if (this.emitters.has(id)) {
      throw new Error(`Emitter with id "${id}" already exists`)
    }
    const config = normalizeConfig({ ...(partial as EmitterConfig), id })
    this.emitters.set(id, {
      config,
      position: new THREE.Vector3(...config.position),
      direction: new THREE.Vector3(...config.direction).normalize(),
      initialVelocity: new THREE.Vector3(...config.initialVelocity),
      startColor: new THREE.Color(config.startColor),
      endColor: new THREE.Color(config.endColor),
      accumulator: 0,
      emitted: 0,
      dropped: 0
    })
    return id
  }

  public updateEmitter(id: string, changes: Partial<Omit<EmitterConfig, 'id'>>): boolean {
    const emitter = this.emitters.get(id)
    if (!emitter) return false
    const merged = normalizeConfig({ ...emitter.config, ...changes, id })
    emitter.config = merged
    emitter.position.set(...merged.position)
    emitter.direction.set(...merged.direction).normalize()
    emitter.initialVelocity.set(...merged.initialVelocity)
    emitter.startColor.set(merged.startColor)
    emitter.endColor.set(merged.endColor)
    return true
  }

  public removeEmitter(id: string): boolean {
    return this.emitters.delete(id)
  }

  public getEmitter(id: string): Readonly<EmitterConfig> | undefined {
    return this.emitters.get(id)?.config
  }

  public listEmitters(): Readonly<EmitterConfig>[] {
    return Array.from(this.emitters.values(), e => e.config)
  }

  public getParticles(): readonly Particle[] {
    return this.particles
  }

  public getAliveCount(): number {
    let count = 0
    for (const p of this.particles) if (p.alive) count++
    return count
  }

  public getEmitterStats(): EmitterStats[] {
    const totalRate = Array.from(this.emitters.values()).reduce(
      (sum, e) => sum + Math.max(0, e.config.emissionRate),
      0
    )
    const aliveById = new Map<string, number>()
    for (const p of this.particles) {
      if (p.alive) aliveById.set(p.emitterId, (aliveById.get(p.emitterId) ?? 0) + 1)
    }
    const stats: EmitterStats[] = []
    for (const emitter of this.emitters.values()) {
      const rate = Math.max(0, emitter.config.emissionRate)
      const quota = totalRate > 0 ? (this.maxParticles * rate) / totalRate : 0
      stats.push({
        id: emitter.config.id,
        quota,
        alive: aliveById.get(emitter.config.id) ?? 0,
        emitted: emitter.emitted,
        dropped: emitter.dropped,
        emissionRate: rate
      })
    }
    return stats
  }

  public update(deltaTime: number): void {
    if (deltaTime <= 0) return
    this.stepLifetimes(deltaTime)
    this.stepEmission(deltaTime)
  }

  private stepLifetimes(deltaTime: number): void {
    for (const p of this.particles) {
      if (!p.alive) continue
      p.age += deltaTime
      if (p.age >= p.lifetime) {
        p.alive = false
        continue
      }
      for (let t = this.trailLength - 1; t > 0; t--) {
        p.trail[t].copy(p.trail[t - 1])
      }
      p.trail[0].copy(p.position)
      p.velocity.y -= this.gravity * deltaTime
      p.velocity.x += (this.rng() - 0.5) * this.turbulence * deltaTime
      p.velocity.y += (this.rng() - 0.5) * this.turbulence * deltaTime
      p.velocity.z += (this.rng() - 0.5) * this.turbulence * deltaTime
      p.position.addScaledVector(p.velocity, deltaTime)
      p.color.copy(p.startColor).lerp(p.endColor, p.age / p.lifetime)
    }
  }

  private stepEmission(deltaTime: number): void {
    const active = Array.from(this.emitters.values()).filter(
      e => e.config.emissionRate > 0
    )
    if (active.length === 0) return

    let totalRate = 0
    for (const e of active) totalRate += e.config.emissionRate

    const aliveById = new Map<string, number>()
    let totalAlive = 0
    for (const p of this.particles) {
      if (p.alive) {
        totalAlive++
        aliveById.set(p.emitterId, (aliveById.get(p.emitterId) ?? 0) + 1)
      }
    }

    for (const emitter of active) {
      const quota = (this.maxParticles * emitter.config.emissionRate) / totalRate
      let aliveForEmitter = aliveById.get(emitter.config.id) ?? 0
      emitter.accumulator += emitter.config.emissionRate * deltaTime
      while (emitter.accumulator >= 1) {
        if (totalAlive < this.maxParticles && aliveForEmitter < quota) {
          if (this.spawnParticle(emitter)) {
            aliveForEmitter++
            totalAlive++
            emitter.emitted++
          } else {
            emitter.dropped++
          }
        } else {
          emitter.dropped++
        }
        emitter.accumulator -= 1
      }
      if (emitter.accumulator > emitter.config.emissionRate) {
        emitter.accumulator = emitter.config.emissionRate
      }
    }
  }

  private spawnParticle(emitter: InternalEmitter): boolean {
    const config = emitter.config
    let particle = this.particles.find(p => !p.alive)
    if (!particle) {
      if (this.particles.length >= this.maxParticles) return false
      particle = {
        alive: false,
        spawnId: 0,
        emitterId: '',
        age: 0,
        lifetime: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        startColor: new THREE.Color(),
        endColor: new THREE.Color(),
        size: this.initialSize,
        trail: []
      }
      this.particles.push(particle)
    }

    const lifetime =
      config.lifetimeMin +
      this.rng() * (config.lifetimeMax - config.lifetimeMin)
    const startT = this.rng()
    const endT = this.rng()

    particle.alive = true
    particle.spawnId = this.spawnIdCounter++
    particle.emitterId = config.id
    particle.age = 0
    particle.lifetime = lifetime
    particle.position.copy(emitter.position)
    particle.velocity
      .copy(emitter.initialVelocity)
      .addScaledVector(
        this.randomConeDirection(emitter.direction, config.spread),
        config.diffusionSpeed
      )
    particle.startColor
      .copy(emitter.startColor)
      .lerp(emitter.endColor, startT)
    particle.endColor
      .copy(emitter.startColor)
      .lerp(emitter.endColor, endT)
    particle.color.copy(particle.startColor)
    particle.size = this.initialSize
    if (particle.trail.length === 0) {
      for (let i = 0; i < this.trailLength; i++) {
        particle.trail.push(new THREE.Vector3())
      }
    }
    for (const trailPoint of particle.trail) trailPoint.copy(particle.position)
    return true
  }

  private randomConeDirection(direction: THREE.Vector3, spread: number): THREE.Vector3 {
    const phi = this.rng() * Math.PI * 2
    const cosMax = Math.cos(Math.min(Math.PI, Math.max(0, spread)))
    const cosTheta = 1 - this.rng() * (1 - cosMax)
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))

    const reference =
      Math.abs(direction.y) < 0.99
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0)
    const tangent = new THREE.Vector3().crossVectors(direction, reference).normalize()
    const bitangent = new THREE.Vector3().crossVectors(direction, tangent)
    return direction
      .clone()
      .multiplyScalar(cosTheta)
      .addScaledVector(tangent, Math.cos(phi) * sinTheta)
      .addScaledVector(bitangent, Math.sin(phi) * sinTheta)
      .normalize()
  }
}

function normalizeConfig(config: EmitterConfig): EmitterConfig {
  const lifetimeMin = Math.max(0.01, config.lifetimeMin)
  const lifetimeMax = Math.max(lifetimeMin, config.lifetimeMax)
  const dir = new THREE.Vector3(...config.direction)
  if (dir.lengthSq() === 0) dir.set(0, 1, 0)
  dir.normalize()
  return {
    id: config.id,
    position: [...config.position],
    direction: [dir.x, dir.y, dir.z],
    spread: Math.min(Math.PI, Math.max(0, config.spread)),
    emissionRate: Math.max(0, config.emissionRate),
    initialVelocity: [...config.initialVelocity],
    diffusionSpeed: Math.max(0, config.diffusionSpeed),
    lifetimeMin,
    lifetimeMax,
    startColor: config.startColor,
    endColor: config.endColor
  }
}
