import * as THREE from 'three'
import type { SharedState } from './types'
import { eventBus } from './utils/eventBus'
import { ParticleModule } from './particleSystem/particleModule'
import { InteractionController } from './interaction/interactionController'
import { RenderModule } from './renderer/renderModule'
import { ControlPanel } from './ui/controlPanel'

const BOUNDS = {
  minX: -10,
  maxX: 10,
  minY: -10,
  maxY: 10,
  minZ: -10,
  maxZ: 10
}

class App {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private container: HTMLElement

  private state: SharedState
  private particleModule: ParticleModule
  private interactionController: InteractionController
  private renderModule: RenderModule
  private controlPanel: ControlPanel

  private clock: THREE.Clock
  private frameCount: number = 0
  private fpsUpdateTime: number = 0
  private currentFps: number = 60
  private animationId: number | null = null
  private isRunning: boolean = false

  constructor() {
    this.container = document.getElementById('canvas-container') as HTMLElement
    if (!this.container) {
      throw new Error('Canvas container not found')
    }

    this.clock = new THREE.Clock()

    this.state = this.createInitialState()

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    this.camera.position.set(0, 0, 20)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    this.container.appendChild(this.renderer.domElement)

    this.particleModule = new ParticleModule(this.state)
    this.interactionController = new InteractionController(this.container, this.camera)
    this.renderModule = new RenderModule(this.scene, this.camera, this.renderer, this.state)
    this.controlPanel = new ControlPanel(this.state)

    this.setupZoom()
    this.setupResize()
  }

  private createInitialState(): SharedState {
    return {
      particleCount: 500,
      gravity: 9.8,
      attractStrength: 50,
      particleSizeMin: 0.2,
      particleSizeMax: 0.6,
      renderMode: 'spheres',
      collisionCount: 0,
      particles: [],
      bounds: { ...BOUNDS }
    }
  }

  private setupZoom(): void {
    let zoomLevel = 20
    const minZoom = 10
    const maxZoom = 40

    this.container.addEventListener('wheel', (e) => {
      e.preventDefault()
      zoomLevel += e.deltaY * 0.02
      zoomLevel = Math.max(minZoom, Math.min(maxZoom, zoomLevel))
      this.camera.position.z = zoomLevel
    }, { passive: false })
  }

  private setupResize(): void {
    window.addEventListener('resize', () => {
      const width = window.innerWidth
      const height = window.innerHeight
      this.renderModule.resize(width, height)
    })
  }

  private updateFPS(delta: number): void {
    this.frameCount++
    this.fpsUpdateTime += delta

    if (this.fpsUpdateTime >= 0.5) {
      this.currentFps = this.frameCount / this.fpsUpdateTime
      this.frameCount = 0
      this.fpsUpdateTime = 0
      eventBus.emit('frame-update', { delta, fps: this.currentFps })
    }
  }

  private animate = (): void => {
    if (!this.isRunning) return

    this.animationId = requestAnimationFrame(this.animate)

    const delta = Math.min(this.clock.getDelta(), 0.1)

    this.updateFPS(delta)
    this.particleModule.update(delta)
    this.interactionController.update()
    this.renderModule.update(delta, this.currentFps)
    this.renderModule.render()
  }

  init(): void {
    this.particleModule.init()
    this.isRunning = true
    this.animate()
  }

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true
      this.clock.start()
      this.animate()
    }
  }

  stop(): void {
    this.isRunning = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  dispose(): void {
    this.stop()
    this.renderModule.dispose()
    this.interactionController.dispose()
    this.controlPanel.dispose()
    this.renderer.dispose()
    eventBus.clear()

    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}

const app = new App()
app.init()

window.addEventListener('beforeunload', () => {
  app.dispose()
})

export default app
