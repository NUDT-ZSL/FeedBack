import * as THREE from 'three'
import type { Particle, SharedState, CollisionEvent, RenderMode } from '../types'
import { eventBus } from '../utils/eventBus'

const GLOW_POOL_SIZE = 30
const FLASH_POOL_SIZE = 20

interface GlowEffect {
  mesh: THREE.Mesh
  active: boolean
  life: number
  maxLife: number
  position: THREE.Vector3
  color: THREE.Color
}

export class RenderModule {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private state: SharedState

  private points: THREE.Points | null = null
  private pointsGeometry: THREE.BufferGeometry | null = null
  private pointsMaterial: THREE.PointsMaterial | null = null

  private instancedMesh: THREE.InstancedMesh | null = null
  private sphereGeometry: THREE.SphereGeometry | null = null
  private sphereMaterial: THREE.MeshStandardMaterial | null = null

  private dummy: THREE.Object3D
  private glowPool: GlowEffect[] = []
  private flashPool: GlowEffect[] = []
  private collisionGlows: GlowEffect[] = []

  private positions: Float32Array | null = null
  private colors: Float32Array | null = null
  private sizes: Float32Array | null = null

  private modeTransition: number = 1
  private targetMode: RenderMode = 'spheres'
  private currentMode: RenderMode = 'spheres'

  private fpsValueEl: HTMLElement | null = null
  private collisionValueEl: HTMLElement | null = null
  private particleValueEl: HTMLElement | null = null
  private modeValueEl: HTMLElement | null = null

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    state: SharedState
  ) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.state = state
    this.dummy = new THREE.Object3D()

    this.initHUD()
    this.initLighting()
    this.initPoints()
    this.initInstancedMesh()
    this.initEffectPools()
    this.initBoundary()

    eventBus.on('collision', this.onCollision.bind(this))
    eventBus.on('render-mode-change', this.onModeChange.bind(this))
    eventBus.on('particle-count-change', this.onParticleCountChange.bind(this))
  }

  private initHUD(): void {
    this.fpsValueEl = document.getElementById('fps-value')
    this.collisionValueEl = document.getElementById('collision-value')
    this.particleValueEl = document.getElementById('particle-value')
    this.modeValueEl = document.getElementById('mode-value')
  }

  private initLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3)
    this.scene.add(ambientLight)

    const light1 = new THREE.PointLight(0x00f0ff, 2, 50)
    light1.position.set(15, 15, 15)
    this.scene.add(light1)

    const light2 = new THREE.PointLight(0xff00ff, 2, 50)
    light2.position.set(-15, -15, -15)
    this.scene.add(light2)

    const light3 = new THREE.PointLight(0xffffff, 0.5, 50)
    light3.position.set(0, 20, 0)
    this.scene.add(light3)
  }

  private initBoundary(): void {
    const { bounds } = this.state
    const edges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
        bounds.maxZ - bounds.minZ
      )
    )
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.15
      })
    )
    line.position.set(
      (bounds.maxX + bounds.minX) / 2,
      (bounds.maxY + bounds.minY) / 2,
      (bounds.maxZ + bounds.minZ) / 2
    )
    this.scene.add(line)
  }

  private initPoints(): void {
    const { particleCount } = this.state

    this.positions = new Float32Array(particleCount * 3)
    this.colors = new Float32Array(particleCount * 3)
    this.sizes = new Float32Array(particleCount)

    this.pointsGeometry = new THREE.BufferGeometry()
    this.pointsGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.pointsGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.pointsGeometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))

    this.pointsMaterial = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    })

    this.points = new THREE.Points(this.pointsGeometry, this.pointsMaterial)
    this.scene.add(this.points)
  }

  private initInstancedMesh(): void {
    const { particleCount } = this.state

    this.sphereGeometry = new THREE.SphereGeometry(1, 16, 12)
    this.sphereMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.3,
      roughness: 0.4,
      emissive: 0x000000,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 1
    })

    this.instancedMesh = new THREE.InstancedMesh(
      this.sphereGeometry,
      this.sphereMaterial,
      particleCount
    )
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(particleCount * 3),
      3
    )
    this.scene.add(this.instancedMesh)
  }

  private initEffectPools(): void {
    const glowGeometry = new THREE.SphereGeometry(1, 16, 16)
    const glowMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    for (let i = 0; i < GLOW_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(glowGeometry.clone(), glowMaterial.clone())
      mesh.visible = false
      this.scene.add(mesh)
      this.glowPool.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 1,
        position: new THREE.Vector3(),
        color: new THREE.Color()
      })
    }

    const flashGeometry = new THREE.SphereGeometry(1, 8, 8)
    const flashMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    for (let i = 0; i < FLASH_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(flashGeometry.clone(), flashMaterial.clone())
      mesh.visible = false
      this.scene.add(mesh)
      this.flashPool.push({
        mesh,
        active: false,
        life: 0,
        maxLife: 0.3,
        position: new THREE.Vector3(),
        color: new THREE.Color()
      })
    }
  }

  private spawnFlash(position: THREE.Vector3, color: THREE.Color): void {
    const flash = this.flashPool.find(f => !f.active)
    if (!flash) return

    flash.active = true
    flash.life = flash.maxLife
    flash.position.copy(position)
    flash.color.copy(color)
    flash.mesh.visible = true
    flash.mesh.position.copy(position)
    ;(flash.mesh.material as THREE.MeshBasicMaterial).color.copy(color)

    this.collisionGlows.push(flash)
  }

  private onCollision(event: CollisionEvent): void {
    const { particles, position } = event
    const avgColor = new THREE.Color()
      .add(particles[0].color)
      .add(particles[1].color)
      .multiplyScalar(0.5)

    this.spawnFlash(position, avgColor)
  }

  private onModeChange(data: { mode: RenderMode }): void {
    this.targetMode = data.mode
    if (this.modeValueEl) {
      this.modeValueEl.textContent = data.mode === 'spheres' ? '球体' : '点云'
    }
  }

  private onParticleCountChange(data: { count: number }): void {
    if (this.particleValueEl) {
      this.particleValueEl.textContent = String(data.count)
    }

    if (this.positions && this.colors && this.sizes) {
      const oldCount = this.positions.length / 3
      const newCount = data.count

      if (newCount > oldCount) {
        const newPositions = new Float32Array(newCount * 3)
        const newColors = new Float32Array(newCount * 3)
        const newSizes = new Float32Array(newCount)

        newPositions.set(this.positions)
        newColors.set(this.colors)
        newSizes.set(this.sizes)

        this.positions = newPositions
        this.colors = newColors
        this.sizes = newSizes
      }

      if (this.pointsGeometry) {
        this.pointsGeometry.dispose()
        this.pointsGeometry = new THREE.BufferGeometry()
        this.pointsGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
        this.pointsGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
        this.pointsGeometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
      }

      if (this.instancedMesh) {
        this.instancedMesh.dispose()
        if (this.sphereGeometry && this.sphereMaterial) {
          this.instancedMesh = new THREE.InstancedMesh(
            this.sphereGeometry,
            this.sphereMaterial,
            newCount
          )
          this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(newCount * 3),
            3
          )
          this.scene.add(this.instancedMesh)
        }
      }

      if (this.points && this.pointsGeometry) {
        this.points.geometry = this.pointsGeometry
      }
    }
  }

  private updatePoints(particles: Particle[]): void {
    if (!this.positions || !this.colors || !this.sizes || !this.pointsGeometry) return

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const i3 = i * 3

      this.positions[i3] = p.position.x
      this.positions[i3 + 1] = p.position.y
      this.positions[i3 + 2] = p.position.z

      const brightness = 1 + p.glowIntensity
      this.colors[i3] = Math.min(1, p.color.r * brightness)
      this.colors[i3 + 1] = Math.min(1, p.color.g * brightness)
      this.colors[i3 + 2] = Math.min(1, p.color.b * brightness)

      this.sizes[i] = p.radius * 1.5
    }

    this.pointsGeometry.attributes.position.needsUpdate = true
    this.pointsGeometry.attributes.color.needsUpdate = true
    this.pointsGeometry.attributes.size.needsUpdate = true
  }

  private updateInstancedMesh(particles: Particle[]): void {
    if (!this.instancedMesh || !this.instancedMesh.instanceColor) return

    const colors = this.instancedMesh.instanceColor.array as Float32Array

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const i3 = i * 3

      this.dummy.position.copy(p.position)
      this.dummy.scale.setScalar(p.radius)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()

      this.instancedMesh.setMatrixAt(i, this.dummy.matrix)

      const brightness = 1 + p.glowIntensity
      const flashBoost = p.flashTime * 0.5
      colors[i3] = Math.min(1, p.color.r * brightness + flashBoost)
      colors[i3 + 1] = Math.min(1, p.color.g * brightness + flashBoost)
      colors[i3 + 2] = Math.min(1, p.color.b * brightness + flashBoost)
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true
    this.instancedMesh.instanceColor.needsUpdate = true
    this.instancedMesh.count = particles.length
  }

  private updateEffects(delta: number): void {
    for (let i = this.collisionGlows.length - 1; i >= 0; i--) {
      const glow = this.collisionGlows[i]
      glow.life -= delta

      if (glow.life <= 0) {
        glow.active = false
        glow.mesh.visible = false
        this.collisionGlows.splice(i, 1)
        continue
      }

      const t = 1 - glow.life / glow.maxLife
      const scale = 0.5 + t * 3
      const opacity = Math.sin(t * Math.PI) * 0.8

      glow.mesh.scale.setScalar(scale)
      ;(glow.mesh.material as THREE.MeshBasicMaterial).opacity = opacity
    }

    const { particles } = this.state
    for (let i = 0; i < this.glowPool.length && i < particles.length; i++) {
      const glow = this.glowPool[i]
      const p = particles[i]

      if (p.glowIntensity > 0.01) {
        glow.mesh.visible = true
        glow.mesh.position.copy(p.position)
        glow.mesh.scale.setScalar(p.radius * (2 + p.glowIntensity * 2))
        ;(glow.mesh.material as THREE.MeshBasicMaterial).color.copy(p.color)
        ;(glow.mesh.material as THREE.MeshBasicMaterial).opacity = p.glowIntensity * 0.3
      } else {
        glow.mesh.visible = false
      }
    }
  }

  private updateModeTransition(delta: number): void {
    const transitionSpeed = 3

    if (this.targetMode !== this.currentMode) {
      if (this.targetMode === 'spheres') {
        this.modeTransition = Math.min(1, this.modeTransition + delta * transitionSpeed)
        if (this.modeTransition >= 1) {
          this.currentMode = 'spheres'
        }
      } else {
        this.modeTransition = Math.max(0, this.modeTransition - delta * transitionSpeed)
        if (this.modeTransition <= 0) {
          this.currentMode = 'points'
        }
      }
    }

    if (this.sphereMaterial) {
      this.sphereMaterial.opacity = this.modeTransition
    }
    if (this.pointsMaterial) {
      this.pointsMaterial.opacity = 1 - this.modeTransition
    }
  }

  private updateHUD(fps: number): void {
    if (this.fpsValueEl) {
      this.fpsValueEl.textContent = Math.round(fps).toString()
      this.fpsValueEl.className = 'hud-value'
      if (fps >= 50) {
        this.fpsValueEl.classList.add('fps-good')
      } else if (fps >= 35) {
        this.fpsValueEl.classList.add('fps-warning')
      } else {
        this.fpsValueEl.classList.add('fps-danger')
      }
    }

    if (this.collisionValueEl) {
      this.collisionValueEl.textContent = this.state.collisionCount.toLocaleString()
    }
  }

  update(delta: number, fps: number): void {
    const particles = this.state.particles

    this.updatePoints(particles)
    this.updateInstancedMesh(particles)
    this.updateEffects(delta)
    this.updateModeTransition(delta)
    this.updateHUD(fps)

    const time = performance.now() * 0.001
    this.camera.position.x = Math.sin(time * 0.1) * 2
    this.camera.position.y = Math.cos(time * 0.15) * 1
    this.camera.lookAt(0, 0, 0)
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  dispose(): void {
    if (this.pointsGeometry) this.pointsGeometry.dispose()
    if (this.pointsMaterial) this.pointsMaterial.dispose()
    if (this.sphereGeometry) this.sphereGeometry.dispose()
    if (this.sphereMaterial) this.sphereMaterial.dispose()
    if (this.instancedMesh) this.instancedMesh.dispose()

    this.glowPool.forEach(g => {
      g.mesh.geometry.dispose()
      ;(g.mesh.material as THREE.Material).dispose()
    })
    this.flashPool.forEach(f => {
      f.mesh.geometry.dispose()
      ;(f.mesh.material as THREE.Material).dispose()
    })
  }
}
