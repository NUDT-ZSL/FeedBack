import * as THREE from 'three'
import { ParticleEngine, EmitterConfig, EmitterStats } from './core/engine'

interface Stats {
  fps: number
  avgParticles: number
  renderTime: number
}

const BUFFER_CAPACITY = 2000

export class ParticleSystem {
  public lowPerformanceMode = false

  public readonly engine: ParticleEngine
  public points: THREE.Points
  public trailPoints: THREE.Points | null = null

  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private trailPositions: Float32Array
  private trailColors: Float32Array

  private emitterMeshes = new Map<string, THREE.Mesh>()
  private scene: THREE.Scene

  private frameCount = 0
  private lastStatsTime = performance.now()
  private frameTimes: number[] = []
  private particleCounts: number[] = []
  private stats: Stats = { fps: 0, avgParticles: 0, renderTime: 0 }
  private onStatsUpdate: ((stats: Stats) => void) | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.engine = new ParticleEngine()

    this.positions = new Float32Array(BUFFER_CAPACITY * 3)
    this.colors = new Float32Array(BUFFER_CAPACITY * 3)
    this.sizes = new Float32Array(BUFFER_CAPACITY)
    this.trailPositions = new Float32Array(BUFFER_CAPACITY * this.engine.trailLength * 3)
    this.trailColors = new Float32Array(BUFFER_CAPACITY * this.engine.trailLength * 3)

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

  public get maxParticles(): number {
    return this.engine.maxParticles
  }
  public set maxParticles(v: number) {
    this.engine.maxParticles = v
  }
  public get gravity(): number {
    return this.engine.gravity
  }
  public set gravity(v: number) {
    this.engine.gravity = v
  }
  public get turbulence(): number {
    return this.engine.turbulence
  }
  public set turbulence(v: number) {
    this.engine.turbulence = v
  }

  public addEmitter(config: Omit<EmitterConfig, 'id'> & { id?: string }): string {
    const id = this.engine.addEmitter(config)
    this.createEmitterMesh(id)
    return id
  }

  public updateEmitter(id: string, changes: Partial<Omit<EmitterConfig, 'id'>>): boolean {
    const ok = this.engine.updateEmitter(id, changes)
    if (ok) this.syncEmitterMesh(id)
    return ok
  }

  public removeEmitter(id: string): boolean {
    const ok = this.engine.removeEmitter(id)
    const mesh = this.emitterMeshes.get(id)
    if (mesh) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      this.emitterMeshes.delete(id)
    }
    return ok
  }

  private createEmitterMesh(id: string): void {
    const geometry = new THREE.SphereGeometry(0.2, 32, 32)
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.3,
      wireframe: true
    })
    const mesh = new THREE.Mesh(geometry, material)
    this.emitterMeshes.set(id, mesh)
    this.scene.add(mesh)
    this.syncEmitterMesh(id)
  }

  private syncEmitterMesh(id: string): void {
    const mesh = this.emitterMeshes.get(id)
    const config = this.engine.getEmitter(id)
    if (!mesh || !config) return
    mesh.position.set(...config.position)
    ;(mesh.material as THREE.MeshBasicMaterial).color.set(config.startColor)
  }

  public getEmitterMeshes(): THREE.Mesh[] {
    return Array.from(this.emitterMeshes.values())
  }

  public getEmitterStats(): EmitterStats[] {
    return this.engine.getEmitterStats()
  }

  public setStatsCallback(callback: (stats: Stats) => void): void {
    this.onStatsUpdate = callback
  }

  public update(deltaTime: number): void {
    const renderStart = performance.now()
    this.engine.update(deltaTime)
    this.updateBuffers()
    this.updateStats(deltaTime, renderStart)
  }

  private updateBuffers(): void {
    let idx = 0
    let trailIdx = 0
    const particles = this.engine.getParticles()

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      if (!p.alive) continue

      const lifeRatio = p.age / p.lifetime

      let size = this.engine.initialSize
      let alpha = 0.9

      if (!this.lowPerformanceMode) {
        size = this.engine.initialSize * (1 - lifeRatio)
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
        for (let t = 0; t < this.engine.trailLength; t++) {
          const trailRatio = (t + 1) / (this.engine.trailLength + 1)
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
    this.particleCounts.push(this.engine.getAliveCount())

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
    for (const mesh of this.emitterMeshes.values()) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.emitterMeshes.clear()
  }
}
