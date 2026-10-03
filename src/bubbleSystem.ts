import * as THREE from 'three'
import { InteractionState } from './interactionState'
import type { DisplayMode } from './interactionState'

export type { DisplayMode } from './interactionState'

interface BubbleData {
  mesh: THREE.Mesh
  innerParticles: THREE.Points
  baseRadius: number
  baseOpacity: number
  baseColor: THREE.Color
  labelSprite: THREE.Sprite
  redShift: number
  id: number
  position: THREE.Vector3
  neighbors: number[]
  currentScale: number
  highlightProgress: number
  bubbleOpacity: number
  particleOpacity: number
}

export class BubbleSystem {
  private scene: THREE.Scene
  private bubbles: BubbleData[] = []
  private threadGroup: THREE.Group
  private bubbleGroup: THREE.Group
  private particleGroup: THREE.Group
  private threadLines: THREE.Line[] = []
  private state: InteractionState = new InteractionState()
  private highlightTargets: Float32Array = new Float32Array(0)
  private threadOpacity: number = 0.15
  private time: number = 0

  private readonly BUBBLE_COUNT = 3000
  private readonly SCENE_RADIUS = 80
  private readonly NEIGHBOR_DISTANCE = 5
  private readonly TRANSITION_DURATION = 0.3
  private readonly HOVER_SCALE = 1.3
  private readonly NEIGHBOR_SCALE_BOOST = 0.1
  private readonly WAVE_DURATION = 0.5
  private readonly HIGHLIGHT_SPEED = 4
  private readonly SCALE_LERP_SPEED = 2
  private readonly LABEL_FADE_SPEED = 5
  private readonly VISIBLE_EPSILON = 0.001

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.threadGroup = new THREE.Group()
    this.bubbleGroup = new THREE.Group()
    this.particleGroup = new THREE.Group()
    this.scene.add(this.bubbleGroup)
    this.scene.add(this.threadGroup)
    this.scene.add(this.particleGroup)

    this.generateBubbles()
    this.generateThreads()
    this.highlightTargets = new Float32Array(this.bubbles.length)
  }

  private createLabelSprite(id: number, redshift: number): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(200, 200, 200, 0.9)'
    ctx.font = '300 42px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`Cluster #${id.toString().padStart(4, '0')}`, 256, 50)
    ctx.font = '300 36px "Segoe UI", sans-serif'
    ctx.fillText(`z = ${redshift.toFixed(3)}`, 256, 100)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthTest: false
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(4, 1, 1)
    sprite.renderOrder = 999
    return sprite
  }

  private lerpColor(t: number): THREE.Color {
    const cold = new THREE.Color(0x1a237e)
    const warm = new THREE.Color(0xb71c1c)
    return cold.clone().lerp(warm, t)
  }

  private generateBubbles(): void {
    const bubbleGeometry = new THREE.SphereGeometry(1, 24, 24)

    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      const phi = Math.acos(2 * Math.random() - 1)
      const theta = 2 * Math.PI * Math.random()
      const r = Math.pow(Math.random(), 0.6) * this.SCENE_RADIUS

      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = r * Math.sin(phi) * Math.sin(theta)
      const z = r * Math.cos(phi)

      const baseRadius = 0.5 + Math.random() * 2.5
      const colorT = Math.pow(Math.random(), 0.7)
      const color = this.lerpColor(colorT)
      const redShift = 0.1 + Math.random() * 2.0

      const bubbleMaterial = new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })

      const bubble = new THREE.Mesh(bubbleGeometry, bubbleMaterial)
      bubble.position.set(x, y, z)
      bubble.scale.setScalar(baseRadius)
      bubble.userData.bubbleIndex = i
      this.bubbleGroup.add(bubble)

      const particleCount = Math.floor(20 + Math.random() * 30)
      const particlePositions = new Float32Array(particleCount * 3)
      const particleVelocities: THREE.Vector3[] = []

      for (let p = 0; p < particleCount; p++) {
        const pPhi = Math.acos(2 * Math.random() - 1)
        const pTheta = 2 * Math.PI * Math.random()
        const pR = Math.random() * baseRadius * 0.85

        particlePositions[p * 3] = pR * Math.sin(pPhi) * Math.cos(pTheta)
        particlePositions[p * 3 + 1] = pR * Math.sin(pPhi) * Math.sin(pTheta)
        particlePositions[p * 3 + 2] = pR * Math.cos(pPhi)

        particleVelocities.push(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02
          )
        )
      }

      const particleGeometry = new THREE.BufferGeometry()
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
      const particleMaterial = new THREE.PointsMaterial({
        color: color.clone(),
        size: 0.08,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
      const points = new THREE.Points(particleGeometry, particleMaterial)
      points.position.copy(bubble.position)
      points.userData.velocities = particleVelocities
      this.particleGroup.add(points)

      const labelSprite = this.createLabelSprite(i + 1, redShift)
      labelSprite.position.set(x, y + baseRadius + 0.8, z)
      this.bubbleGroup.add(labelSprite)

      this.bubbles.push({
        mesh: bubble,
        innerParticles: points,
        baseRadius,
        baseOpacity: 0.25,
        baseColor: color.clone(),
        labelSprite,
        redShift,
        id: i,
        position: new THREE.Vector3(x, y, z),
        neighbors: [],
        currentScale: baseRadius,
        highlightProgress: 0,
        bubbleOpacity: 0.25,
        particleOpacity: 0.8
      })
    }

    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      for (let j = i + 1; j < this.BUBBLE_COUNT; j++) {
        if (this.bubbles[i].position.distanceTo(this.bubbles[j].position) < this.NEIGHBOR_DISTANCE) {
          this.bubbles[i].neighbors.push(j)
          this.bubbles[j].neighbors.push(i)
        }
      }
    }
  }

  private generateThreads(): void {
    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      for (const neighborIdx of this.bubbles[i].neighbors) {
        if (neighborIdx > i) {
          const geometry = new THREE.BufferGeometry().setFromPoints([
            this.bubbles[i].position,
            this.bubbles[neighborIdx].position
          ])
          const material = new THREE.LineBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.15,
            depthWrite: false
          })
          const line = new THREE.Line(geometry, material)
          this.threadGroup.add(line)
          this.threadLines.push(line)
        }
      }
    }
  }

  public getBubbleMeshes(): THREE.Mesh[] {
    return this.bubbles.map(b => b.mesh)
  }

  public getBubbleByMesh(mesh: THREE.Mesh): BubbleData | undefined {
    const idx = mesh.userData.bubbleIndex
    if (idx !== undefined) return this.bubbles[idx]
    return undefined
  }

  public hoverBubble(data: BubbleData | null): void {
    this.state.hover(data ? data.id : null, this.time)
  }

  public lockBubble(data: BubbleData | null): void {
    this.state.lock(data ? data.id : null, this.time)
  }

  public resetInteraction(): void {
    this.state.reset()
    for (const bubble of this.bubbles) {
      bubble.highlightProgress = 0
    }
  }

  public setScaleFactor(scale: number): void {
    this.state.scaleFactor = scale
  }

  public setDisplayMode(mode: DisplayMode): void {
    this.state.displayMode = mode
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (current < target) return Math.min(current + maxDelta, target)
    return Math.max(current - maxDelta, target)
  }

  private computeHighlightTargets(): void {
    this.highlightTargets.fill(0)
    const activeId = this.state.activeId
    if (activeId === null) return

    this.highlightTargets[activeId] = 1
    const neighbors = this.bubbles[activeId].neighbors
    if (neighbors.length === 0) return

    const elapsed = this.time - this.state.focusStartedAt
    const delayStep = this.WAVE_DURATION / neighbors.length
    for (let i = 0; i < neighbors.length; i++) {
      if (elapsed >= i * delayStep) {
        this.highlightTargets[neighbors[i]] = 1
      }
    }
  }

  public update(delta: number, camera: THREE.Camera): void {
    this.time += delta
    this.computeHighlightTargets()

    const activeId = this.state.activeId
    const mode = this.state.displayMode
    const scaleFactor = this.state.scaleFactor
    const opacityStep = delta / this.TRANSITION_DURATION

    for (let i = 0; i < this.bubbles.length; i++) {
      const bubble = this.bubbles[i]

      bubble.highlightProgress = this.moveToward(
        bubble.highlightProgress,
        this.highlightTargets[i],
        delta * this.HIGHLIGHT_SPEED
      )

      let scaleTarget = bubble.baseRadius * scaleFactor
      if (i === activeId) {
        scaleTarget *= this.HOVER_SCALE
      } else {
        scaleTarget *= 1 + this.NEIGHBOR_SCALE_BOOST * bubble.highlightProgress
      }
      bubble.currentScale += (scaleTarget - bubble.currentScale) * Math.min(delta * this.SCALE_LERP_SPEED, 1)
      bubble.mesh.scale.setScalar(bubble.currentScale)
      bubble.innerParticles.scale.setScalar(bubble.currentScale / bubble.baseRadius)

      const pulse = 1 + Math.sin(this.time * 2 + i * 0.1) * 0.03
      bubble.mesh.scale.multiplyScalar(pulse)

      const bubbleOpacityTarget = mode === 'normal' ? bubble.baseOpacity : 0
      bubble.bubbleOpacity = this.moveToward(bubble.bubbleOpacity, bubbleOpacityTarget, opacityStep)
      const bubbleMat = bubble.mesh.material as THREE.MeshBasicMaterial
      bubbleMat.opacity = bubble.bubbleOpacity
      bubble.mesh.visible = bubble.bubbleOpacity > this.VISIBLE_EPSILON

      const particleOpacityTarget = mode === 'threads' ? 0 : mode === 'particles' ? 1.0 : 0.8
      bubble.particleOpacity = this.moveToward(bubble.particleOpacity, particleOpacityTarget, opacityStep)
      const particleMat = bubble.innerParticles.material as THREE.PointsMaterial
      particleMat.opacity = bubble.particleOpacity
      bubble.innerParticles.visible = bubble.particleOpacity > this.VISIBLE_EPSILON

      const positions = bubble.innerParticles.geometry.attributes.position.array as Float32Array
      const velocities = bubble.innerParticles.userData.velocities as THREE.Vector3[]
      for (let p = 0; p < velocities.length; p++) {
        positions[p * 3] += velocities[p].x + (Math.random() - 0.5) * 0.005
        positions[p * 3 + 1] += velocities[p].y + (Math.random() - 0.5) * 0.005
        positions[p * 3 + 2] += velocities[p].z + (Math.random() - 0.5) * 0.005

        const dx = positions[p * 3]
        const dy = positions[p * 3 + 1]
        const dz = positions[p * 3 + 2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const maxR = bubble.baseRadius * 0.85

        if (dist > maxR) {
          const norm = maxR / dist
          positions[p * 3] *= norm
          positions[p * 3 + 1] *= norm
          positions[p * 3 + 2] *= norm
          velocities[p].multiplyScalar(-0.3)
        }
      }
      bubble.innerParticles.geometry.attributes.position.needsUpdate = true

      const labelMat = bubble.labelSprite.material as THREE.SpriteMaterial
      const labelTarget = i === activeId ? 0.95 : 0
      labelMat.opacity = this.moveToward(labelMat.opacity, labelTarget, delta * this.LABEL_FADE_SPEED)
      bubble.labelSprite.visible = labelMat.opacity > this.VISIBLE_EPSILON

      const labelOffset = bubble.baseRadius * scaleFactor * (i === activeId ? this.HOVER_SCALE : 1) + 0.8
      bubble.labelSprite.position.set(
        bubble.position.x,
        bubble.position.y + labelOffset,
        bubble.position.z
      )
      bubble.labelSprite.lookAt(camera.position)
    }

    const threadOpacityTarget = mode === 'particles' ? 0 : 0.15
    this.threadOpacity = this.moveToward(this.threadOpacity, threadOpacityTarget, opacityStep)
    const threadsVisible = this.threadOpacity > this.VISIBLE_EPSILON
    for (let i = 0; i < this.threadLines.length; i++) {
      const line = this.threadLines[i]
      const mat = line.material as THREE.LineBasicMaterial
      mat.opacity = this.threadOpacity * (0.85 + Math.sin(this.time * 1.5 + i * 0.05) * 0.15)
      line.visible = threadsVisible
    }
  }
}
