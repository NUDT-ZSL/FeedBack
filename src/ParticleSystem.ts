import * as THREE from 'three'

interface ParticleData {
  alive: boolean
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

interface Stats {
  fps: number
  avgParticles: number
  renderTime: number
}

export class ParticleSystem {
  public maxParticles = 800
  public emissionRate = 20
  public lifetime = 5
  public gravity = 0.5
  public turbulence = 1
  public initialVelocity = new THREE.Vector3(0, 1, 0)
  public startColor = new THREE.Color(0x00ffff)
  public endColor = new THREE.Color(0x00008b)
  public initialSize = 0.3
  public lowPerformanceMode = false

  public points: THREE.Points
  public trailPoints: THREE.Points | null = null
  public emitterMesh: THREE.Mesh

  private particles: ParticleData[] = []
  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private trailPositions: Float32Array
  private trailColors: Float32Array

  private emissionAccumulator = 0
  private readonly TRAIL_LENGTH = 5

  private frameCount = 0
  private lastStatsTime = performance.now()
  private frameTimes: number[] = []
  private particleCounts: number[] = []
  private stats: Stats = { fps: 0, avgParticles: 0, renderTime: 0 }
  private onStatsUpdate: ((stats: Stats) => void) | null = null

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(2000 * 3)
    this.colors = new Float32Array(2000 * 3)
    this.sizes = new Float32Array(2000)
    this.trailPositions = new Float32Array(2000 * this.TRAIL_LENGTH * 3)
    this.trailColors = new Float32Array(2000 * this.TRAIL_LENGTH * 3)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
    geometry.setDrawRange(0, 0)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
      },
      vertexShader: `
        attribute float size;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 200.0 * uPixelRatio / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    this.points = new THREE.Points(geometry, material)
    scene.add(this.points)

    this.createTrailSystem(scene)
    this.createEmitter(scene)
  }

  private createTrailSystem(scene: THREE.Scene): void {
    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3))
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3))
    trailGeometry.setDrawRange(0, 0)

    const trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
      },
      vertexShader: `
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 4.0 * uPixelRatio / -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(vColor, alpha * 0.6);
        }
      `,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    this.trailPoints = new THREE.Points(trailGeometry, trailMaterial)
    scene.add(this.trailPoints)
  }

  private createEmitter(scene: THREE.Scene): void {
    const sphereGeometry = new THREE.SphereGeometry(0.2, 32, 32)
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bcd4,
      transparent: true,
      opacity: 0.3,
      wireframe: true
    })
    this.emitterMesh = new THREE.Mesh(sphereGeometry, sphereMaterial)
    scene.add(this.emitterMesh)
  }

  public setStatsCallback(callback: (stats: Stats) => void): void {
    this.onStatsUpdate = callback
  }

  private randomSphereDirection(): THREE.Vector3 {
    const u = Math.random()
    const v = Math.random()
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    return new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    )
  }

  private emitParticle(): void {
    if (this.particles.filter(p => p.alive).length >= this.maxParticles) return

    let particle = this.particles.find(p => !p.alive)
    if (!particle) {
      if (this.particles.length >= this.maxParticles) return
      particle = {
        alive: false,
        age: 0,
        lifetime: this.lifetime,
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

    const direction = this.randomSphereDirection()
    particle.alive = true
    particle.age = 0
    particle.lifetime = this.lifetime
    particle.position.set(0, 0, 0)
    particle.velocity.copy(direction).add(this.initialVelocity)
    particle.startColor.copy(this.startColor)
    particle.endColor.copy(this.endColor)
    particle.color.copy(this.startColor)
    particle.size = this.initialSize
    particle.trail = []
    for (let i = 0; i < this.TRAIL_LENGTH; i++) {
      particle.trail.push(new THREE.Vector3(0, 0, 0))
    }
  }

  public update(deltaTime: number): void {
    const renderStart = performance.now()

    this.emissionAccumulator += this.emissionRate * deltaTime
    while (this.emissionAccumulator >= 1) {
      this.emitParticle()
      this.emissionAccumulator -= 1
    }

    let aliveCount = 0
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (!p.alive) continue

      p.age += deltaTime
      if (p.age >= p.lifetime) {
        p.alive = false
        continue
      }

      for (let t = this.TRAIL_LENGTH - 1; t > 0; t--) {
        p.trail[t].copy(p.trail[t - 1])
      }
      p.trail[0].copy(p.position)

      p.velocity.y -= this.gravity * deltaTime
      p.velocity.x += (Math.random() - 0.5) * this.turbulence * deltaTime
      p.velocity.y += (Math.random() - 0.5) * this.turbulence * deltaTime
      p.velocity.z += (Math.random() - 0.5) * this.turbulence * deltaTime

      p.position.x += p.velocity.x * deltaTime
      p.position.y += p.velocity.y * deltaTime
      p.position.z += p.velocity.z * deltaTime

      aliveCount++
    }

    this.updateBuffers()
    this.updateStats(deltaTime, renderStart)
  }

  private updateBuffers(): void {
    let idx = 0
    let trailIdx = 0

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (!p.alive) continue

      const lifeRatio = p.age / p.lifetime
      p.color.copy(p.startColor).lerp(p.endColor, lifeRatio)

      let size = this.initialSize
      let alpha = 0.9

      if (!this.lowPerformanceMode) {
        size = this.initialSize * (1 - lifeRatio)
        alpha = 0.9 * (1 - lifeRatio)
      } else {
        size = 0.2
        alpha = 0.7
      }

      this.positions[idx * 3] = p.position.x
      this.positions[idx * 3 + 1] = p.position.y
      this.positions[idx * 3 + 2] = p.position.z
      this.colors[idx * 3] = p.color.r * alpha
      this.colors[idx * 3 + 1] = p.color.g * alpha
      this.colors[idx * 3 + 2] = p.color.b * alpha
      this.sizes[idx] = size
      idx++

      if (!this.lowPerformanceMode && this.trailPoints) {
        for (let t = 0; t < this.TRAIL_LENGTH; t++) {
          const trailRatio = (t + 1) / (this.TRAIL_LENGTH + 1)
          const trailAlpha = alpha * (1 - trailRatio) * 0.5
          this.trailPositions[trailIdx * 3] = p.trail[t].x
          this.trailPositions[trailIdx * 3 + 1] = p.trail[t].y
          this.trailPositions[trailIdx * 3 + 2] = p.trail[t].z
          this.trailColors[trailIdx * 3] = p.color.r * trailAlpha
          this.trailColors[trailIdx * 3 + 1] = p.color.g * trailAlpha
          this.trailColors[trailIdx * 3 + 2] = p.color.b * trailAlpha
          trailIdx++
        }
      }
    }

    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute
    const sizeAttr = this.points.geometry.getAttribute('size') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    this.points.geometry.setDrawRange(0, idx)

    if (this.trailPoints) {
      this.trailPoints.visible = !this.lowPerformanceMode
      if (!this.lowPerformanceMode) {
        const tPosAttr = this.trailPoints.geometry.getAttribute('position') as THREE.BufferAttribute
        const tColAttr = this.trailPoints.geometry.getAttribute('color') as THREE.BufferAttribute
        tPosAttr.needsUpdate = true
        tColAttr.needsUpdate = true
        this.trailPoints.geometry.setDrawRange(0, trailIdx)
      }
    }
  }

  private updateStats(deltaTime: number, renderStart: number): void {
    this.frameCount++
    const renderEnd = performance.now()
    this.frameTimes.push(renderEnd - renderStart)
    const aliveCount = this.particles.filter(p => p.alive).length
    this.particleCounts.push(aliveCount)

    const now = performance.now()
    if (now - this.lastStatsTime >= 1000) {
      this.stats.fps = Math.round(this.frameCount * 1000 / (now - this.lastStatsTime))
      this.stats.avgParticles = Math.round(
        this.particleCounts.reduce((a, b) => a + b, 0) / this.particleCounts.length
      )
      this.stats.renderTime = parseFloat(
        (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length).toFixed(2)
      )

      this.frameCount = 0
      this.frameTimes = []
      this.particleCounts = []
      this.lastStatsTime = now

      if (this.onStatsUpdate) {
        this.onStatsUpdate(this.stats)
      }
    }
  }

  public resize(): void {
    const pixelRatio = Math.min(window.devicePixelRatio, 2)
    ;(this.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = pixelRatio
    if (this.trailPoints) {
      ;(this.trailPoints.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = pixelRatio
    }
  }

  public dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    if (this.trailPoints) {
      this.trailPoints.geometry.dispose()
      ;(this.trailPoints.material as THREE.Material).dispose()
    }
    this.emitterMesh.geometry.dispose()
    ;(this.emitterMesh.material as THREE.Material).dispose()
  }
}
