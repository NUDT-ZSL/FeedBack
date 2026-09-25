import * as THREE from 'three'
import type { MouseForceEvent } from '../types'
import { eventBus } from '../utils/eventBus'

export class InteractionController {
  private container: HTMLElement
  private camera: THREE.PerspectiveCamera
  private raycaster: THREE.Raycaster
  private mouse: THREE.Vector2
  private isDragging: boolean = false
  private isAttract: boolean = true
  private trailPoints: { x: number; y: number; time: number }[] = []
  private maxTrailPoints: number = 20
  private lastEmitTime: number = 0
  private emitInterval: number = 16

  constructor(container: HTMLElement, camera: THREE.PerspectiveCamera) {
    this.container = container
    this.camera = camera
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()

    this.bindEvents()
  }

  private bindEvents(): void {
    const container = this.container

    container.addEventListener('mousedown', this.onMouseDown.bind(this))
    container.addEventListener('mousemove', this.onMouseMove.bind(this))
    container.addEventListener('mouseup', this.onMouseUp.bind(this))
    container.addEventListener('mouseleave', this.onMouseUp.bind(this))
    container.addEventListener('contextmenu', (e) => e.preventDefault())

    container.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false })
    container.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false })
    container.addEventListener('touchend', this.onTouchEnd.bind(this))
  }

  private updateMouse(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect()
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
  }

  private getWorldPosition(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const direction = this.raycaster.ray.direction.clone()
    const distance = 10
    return this.raycaster.ray.origin.clone().add(direction.multiplyScalar(distance))
  }

  private emitMouseForce(): void {
    const now = performance.now()
    if (now - this.lastEmitTime < this.emitInterval) return
    this.lastEmitTime = now

    const event: MouseForceEvent = {
      position: this.getWorldPosition(),
      strength: this.isAttract ? 50 : 50,
      isAttract: this.isAttract,
      radius: 8
    }

    eventBus.emit('mouse-force', event)
  }

  private updateTrail(clientX: number, clientY: number): void {
    this.trailPoints.push({ x: clientX, y: clientY, time: performance.now() })
    if (this.trailPoints.length > this.maxTrailPoints) {
      this.trailPoints.shift()
    }
    this.updateTrailLine()
  }

  private updateTrailLine(): void {
    const path = document.getElementById('trail-path') as unknown as SVGPathElement
    if (!path || this.trailPoints.length < 2) {
      if (path) path.setAttribute('d', '')
      return
    }

    const now = performance.now()
    const validPoints = this.trailPoints.filter(p => now - p.time < 300)

    if (validPoints.length < 2) {
      path.setAttribute('d', '')
      return
    }

    let d = `M ${validPoints[0].x} ${validPoints[0].y}`
    for (let i = 1; i < validPoints.length; i++) {
      d += ` L ${validPoints[i].x} ${validPoints[i].y}`
    }
    path.setAttribute('d', d)

    const opacity = Math.max(0.1, validPoints.length / this.maxTrailPoints * 0.5)
    path.setAttribute('stroke', `rgba(0, 240, 255, ${opacity})`)
  }

  private clearTrail(): void {
    this.trailPoints = []
    const path = document.getElementById('trail-path') as unknown as SVGPathElement
    if (path) {
      path.setAttribute('d', '')
    }
  }

  private onMouseDown(e: MouseEvent): void {
    e.preventDefault()
    this.isDragging = true
    this.isAttract = e.button !== 2
    this.updateMouse(e.clientX, e.clientY)
    this.updateTrail(e.clientX, e.clientY)
    this.emitMouseForce()
  }

  private onMouseMove(e: MouseEvent): void {
    this.updateMouse(e.clientX, e.clientY)
    this.updateTrail(e.clientX, e.clientY)

    if (this.isDragging) {
      this.emitMouseForce()
    }
  }

  private onMouseUp(): void {
    this.isDragging = false
    this.clearTrail()
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 0) return
    e.preventDefault()
    const touch = e.touches[0]
    this.isDragging = true
    this.isAttract = true
    this.updateMouse(touch.clientX, touch.clientY)
    this.updateTrail(touch.clientX, touch.clientY)
    this.emitMouseForce()
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 0) return
    e.preventDefault()
    const touch = e.touches[0]
    this.updateMouse(touch.clientX, touch.clientY)
    this.updateTrail(touch.clientX, touch.clientY)

    if (this.isDragging) {
      this.emitMouseForce()
    }
  }

  private onTouchEnd(): void {
    this.isDragging = false
    this.clearTrail()
  }

  update(): void {
    if (this.isDragging) {
      this.emitMouseForce()
    }

    const now = performance.now()
    this.trailPoints = this.trailPoints.filter(p => now - p.time < 300)
    this.updateTrailLine()
  }

  dispose(): void {
    const container = this.container
    container.removeEventListener('mousedown', this.onMouseDown.bind(this))
    container.removeEventListener('mousemove', this.onMouseMove.bind(this))
    container.removeEventListener('mouseup', this.onMouseUp.bind(this))
    container.removeEventListener('mouseleave', this.onMouseUp.bind(this))
    container.removeEventListener('touchstart', this.onTouchStart.bind(this))
    container.removeEventListener('touchmove', this.onTouchMove.bind(this))
    container.removeEventListener('touchend', this.onTouchEnd.bind(this))
  }
}
