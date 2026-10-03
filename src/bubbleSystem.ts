import * as THREE from 'three'
import {
  HIGHLIGHT_NONE,
  HIGHLIGHT_PRIMARY,
  ViewerState
} from './state'

interface BubbleData {
  mesh: THREE.Mesh
  innerParticles: THREE.Points
  baseRadius: number
  currentScale: number
  baseOpacity: number
  baseColor: THREE.Color
  labelSprite: THREE.Sprite
  redShift: number
  id: number
  position: THREE.Vector3
}

export class BubbleSystem {
  private scene: THREE.Scene
  private bubbles: BubbleData[] = []
  private threadGroup: THREE.Group
  private bubbleGroup: THREE.Group
  private particleGroup: THREE.Group
  private threadLines: THREE.Line[] = []
  private state: ViewerState
  private time: number = 0

  private readonly BUBBLE_COUNT = 3000
  private readonly SCENE_RADIUS = 80
  private readonly NEIGHBOR_DISTANCE = 5
  private readonly HOVER_SCALE = 1.3

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.threadGroup = new THREE.Group()
    this.bubbleGroup = new THREE.Group()
    this.particleGroup = new THREE.Group()
    this.scene.add(this.bubbleGroup)
    this.scene.add(this.threadGroup)
    this.scene.add(this.particleGroup)

    const neighbors = this.generateBubbles()
    this.state = new ViewerState(neighbors)
    this.generateThreads(neighbors)
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

  private generateBubbles(): number[][] {
    const bubbleGeometry = new THREE.SphereGeometry(1, 24, 24)
    const neighbors: number[][] = new Array(this.BUBBLE_COUNT)

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
        currentScale: baseRadius,
        baseOpacity: 0.25,
        baseColor: color.clone(),
        labelSprite,
        redShift,
        id: i,
        position: new THREE.Vector3(x, y, z)
      })
      neighbors[i] = []
    }

    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      for (let j = i + 1; j < this.BUBBLE_COUNT; j++) {
        if (this.bubbles[i].position.distanceTo(this.bubbles[j].position) < this.NEIGHBOR_DISTANCE) {
          neighbors[i].push(j)
          neighbors[j].push(i)
        }
      }
    }

    return neighbors
  }

  private generateThreads(neighbors: number[][]): void {
    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      for (const neighborIdx of neighbors[i]) {
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

  public getState(): ViewerState {
    return this.state
  }

  public getBubbleMeshes(): THREE.Mesh[] {
    return this.bubbles.map(b => b.mesh)
  }

  public getBubbleIdByMesh(mesh: THREE.Mesh): number | null {
    const idx = mesh.userData.bubbleIndex
    return idx !== undefined ? (idx as number) : null
  }

  private scaleMultiplier(highlightLevel: number): number {
    if (highlightLevel <= HIGHLIGHT_NONE) return 1
    if (highlightLevel < HIGHLIGHT_PRIMARY) {
      return 1 + 0.1 * highlightLevel
    }
    return this.HOVER_SCALE
  }

  private applyDisplayMode(): void {
    const mode = this.state.displayMode
    this.bubbleGroup.visible = mode === 'normal'
    this.threadGroup.visible = mode !== 'particles'
    this.particleGroup.visible = mode !== 'threads'
  }

  public update(delta: number, camera: THREE.Camera): void {
    this.time += delta
    this.state.tickHighlights(delta)
    this.applyDisplayMode()

    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      const bubble = this.bubbles[i]
      const highlightLevel = this.state.getHighlightLevel(i)
      const multiplier = this.scaleMultiplier(highlightLevel)
      const targetScale = bubble.baseRadius * this.state.scaleFactor * multiplier

      const scaleSpeed = 1 / 0.5
      bubble.currentScale += (targetScale - bubble.currentScale) * Math.min(delta * scaleSpeed, 1)
      bubble.mesh.scale.setScalar(bubble.currentScale)
      bubble.innerParticles.scale.setScalar(bubble.currentScale / bubble.baseRadius)

      const pulse = 1 + Math.sin(this.time * 2 + i * 0.1) * 0.03
      bubble.mesh.scale.multiplyScalar(pulse)

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

      const isPrimary = this.state.isPrimary(i)
      const labelTargetOpacity =
        isPrimary && this.state.displayMode === 'normal' ? 0.95 : 0
      const labelMat = bubble.labelSprite.material as THREE.SpriteMaterial
      labelMat.opacity += (labelTargetOpacity - labelMat.opacity) * Math.min(delta * 5, 1)

      const labelOffset =
        bubble.baseRadius * this.state.scaleFactor * multiplier + 0.8
      bubble.labelSprite.position.set(
        bubble.position.x,
        bubble.position.y + labelOffset,
        bubble.position.z
      )
      bubble.labelSprite.lookAt(camera.position)
    }

    for (let i = 0; i < this.threadLines.length; i++) {
      const line = this.threadLines[i]
      const mat = line.material as THREE.LineBasicMaterial
      const baseOpacity = this.state.displayMode === 'particles' ? 0.08 : 0.15
      mat.opacity = baseOpacity * (0.85 + Math.sin(this.time * 1.5 + i * 0.05) * 0.15)
    }
  }
}
