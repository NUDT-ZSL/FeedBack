import * as THREE from 'three'
import { BubbleSystem } from './bubbleSystem'

export class InteractionManager {
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private bubbleSystem: BubbleSystem
  private raycaster: THREE.Raycaster
  private mouse: THREE.Vector2
  private isDragging: boolean = false
  private dragStart: THREE.Vector2 = new THREE.Vector2()
  private autoRotate: boolean = true
  private autoRotateSpeed: number = 0.003
  private lastMouseMove: number = 0
  private currentHovered: THREE.Mesh | null = null

  private sphericalRadius: number = 140
  private sphericalTheta: number = Math.PI * 0.3
  private sphericalPhi: number = Math.PI * 0.4

  private readonly ROTATION_SPEED = 0.005
  private readonly MIN_RADIUS = 40
  private readonly MAX_RADIUS = 250
  private readonly AUTO_ROTATE_DELAY = 3000

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    bubbleSystem: BubbleSystem
  ) {
    this.camera = camera
    this.renderer = renderer
    this.bubbleSystem = bubbleSystem
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()

    this.updateCameraPosition()
    this.setupEventListeners()
  }

  private updateCameraPosition(): void {
    const x = this.sphericalRadius * Math.sin(this.sphericalPhi) * Math.cos(this.sphericalTheta)
    const y = this.sphericalRadius * Math.cos(this.sphericalPhi)
    const z = this.sphericalRadius * Math.sin(this.sphericalPhi) * Math.sin(this.sphericalTheta)
    this.camera.position.set(x, y, z)
    this.camera.lookAt(0, 0, 0)
  }

  private setupEventListeners(): void {
    const dom = this.renderer.domElement

    dom.addEventListener('mousedown', (e: MouseEvent) => {
      this.isDragging = true
      this.autoRotate = false
      this.dragStart.set(e.clientX, e.clientY)
      dom.style.cursor = 'grabbing'
    })

    window.addEventListener('mouseup', () => {
      this.isDragging = false
      dom.style.cursor = 'default'
      this.scheduleAutoRotate()
    })

    dom.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = dom.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.lastMouseMove = performance.now()

      if (this.isDragging) {
        const dx = e.clientX - this.dragStart.x
        const dy = e.clientY - this.dragStart.y

        this.sphericalTheta -= dx * this.ROTATION_SPEED
        this.sphericalPhi -= dy * this.ROTATION_SPEED
        this.sphericalPhi = Math.max(0.05, Math.min(Math.PI - 0.05, this.sphericalPhi))

        this.updateCameraPosition()
        this.dragStart.set(e.clientX, e.clientY)
      } else {
        this.checkHover()
      }
    })

    dom.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault()
      this.autoRotate = false
      const factor = Math.exp(e.deltaY * 0.001)
      this.sphericalRadius = Math.max(this.MIN_RADIUS, Math.min(this.MAX_RADIUS, this.sphericalRadius * factor))
      this.updateCameraPosition()
      this.scheduleAutoRotate()
    }, { passive: false })

    dom.addEventListener('click', (e: MouseEvent) => {
      const rect = dom.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      this.raycaster.setFromCamera(this.mouse, this.camera)
      const intersects = this.raycaster.intersectObjects(this.bubbleSystem.getBubbleMeshes(), false)

      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh
        const data = this.bubbleSystem.getBubbleByMesh(mesh)
        if (data) {
          this.bubbleSystem.lockBubble(data)
        }
      } else {
        this.bubbleSystem.lockBubble(null)
      }
    })

    dom.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      this.resetView()
    })
  }

  private scheduleAutoRotate(): void {
    setTimeout(() => {
      if (performance.now() - this.lastMouseMove > this.AUTO_ROTATE_DELAY) {
        this.autoRotate = true
      }
    }, this.AUTO_ROTATE_DELAY)
  }

  private checkHover(): void {
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const intersects = this.raycaster.intersectObjects(this.bubbleSystem.getBubbleMeshes(), false)

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh
      if (this.currentHovered !== mesh) {
        this.currentHovered = mesh
        const data = this.bubbleSystem.getBubbleByMesh(mesh)
        this.bubbleSystem.hoverBubble(data || null)
      }
      this.renderer.domElement.style.cursor = 'pointer'
    } else {
      if (this.currentHovered !== null) {
        this.currentHovered = null
        this.bubbleSystem.hoverBubble(null)
      }
      this.renderer.domElement.style.cursor = 'default'
    }
  }

  public resetView(): void {
    this.sphericalRadius = 140
    this.sphericalTheta = Math.PI * 0.3
    this.sphericalPhi = Math.PI * 0.4
    this.autoRotate = true
    this.bubbleSystem.lockBubble(null)
    this.updateCameraPosition()
  }

  public update(delta: number): void {
    if (this.autoRotate && !this.isDragging) {
      this.sphericalTheta += this.autoRotateSpeed
      this.updateCameraPosition()
    }
  }

  public setAutoRotateSpeed(speed: number): void {
    this.autoRotateSpeed = speed
  }
}
