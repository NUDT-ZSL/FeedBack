import * as THREE from 'three'

export type DisplayMode = 'normal' | 'threads' | 'particles'

interface BubbleData {
  mesh: THREE.Mesh
  innerParticles: THREE.Points
  baseRadius: number
  baseScale: number
  targetScale: number
  currentScale: number
  baseOpacity: number
  baseColor: THREE.Color
  labelSprite: THREE.Sprite
  labelVisible: boolean
  redShift: number
  id: number
  position: THREE.Vector3
  neighbors: number[]
  highlightProgress: number
  isHovered: boolean
  isLocked: boolean
}

export class BubbleSystem {
  private scene: THREE.Scene
  private bubbles: BubbleData[] = []
  private threadGroup: THREE.Group
  private bubbleGroup: THREE.Group
  private particleGroup: THREE.Group
  private threadLines: THREE.Line[] = []
  private scaleFactor: number = 1.0
  private displayMode: DisplayMode = 'normal'
  private time: number = 0

  private readonly BUBBLE_COUNT = 3000
  private readonly SCENE_RADIUS = 80
  private readonly NEIGHBOR_DISTANCE = 5
  private readonly TRANSITION_DURATION = 0.3
  private readonly HOVER_SCALE = 1.3

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
        baseScale: baseRadius,
        targetScale: baseRadius,
        currentScale: baseRadius,
        baseOpacity: 0.25,
        baseColor: color.clone(),
        labelSprite,
        labelVisible: false,
        redShift,
        id: i,
        position: new THREE.Vector3(x, y, z),
        neighbors: [],
        highlightProgress: 0,
        isHovered: false,
        isLocked: false
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
    for (const bubble of this.bubbles) {
      if (!bubble.isLocked) {
        bubble.isHovered = false
        bubble.highlightProgress = 0
        bubble.targetScale = bubble.baseRadius * this.scaleFactor
        bubble.labelVisible = false
      }
    }

    if (data) {
      data.isHovered = true
      data.targetScale = data.baseRadius * this.scaleFactor * this.HOVER_SCALE
      data.labelVisible = true

      const delayStep = 1000 / data.neighbors.length
      data.neighbors.forEach((nIdx, i) => {
        setTimeout(() => {
          const neighbor = this.bubbles[nIdx]
          if (!neighbor.isLocked) {
            neighbor.highlightProgress = 1
            neighbor.targetScale = neighbor.baseRadius * this.scaleFactor * 1.1
          }
        }, i * delayStep * 0.5)
      })
    }
  }

  public lockBubble(data: BubbleData | null): void {
    for (const bubble of this.bubbles) {
      bubble.isLocked = false
    }
    if (data) {
      data.isLocked = true
      this.hoverBubble(data)
    }
  }

  public setScaleFactor(scale: number): void {
    this.scaleFactor = scale
    for (const bubble of this.bubbles) {
      const baseTarget = bubble.baseRadius * scale
      if (bubble.isHovered || bubble.isLocked) {
        bubble.targetScale = baseTarget * this.HOVER_SCALE
      } else if (bubble.highlightProgress > 0) {
        bubble.targetScale = baseTarget * 1.1
      } else {
        bubble.targetScale = baseTarget
      }
    }
  }

  public setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode
    const transitionTime = this.TRANSITION_DURATION * 1000

    for (const bubble of this.bubbles) {
      const bubbleMat = bubble.mesh.material as THREE.MeshBasicMaterial
      const particleMat = bubble.innerParticles.material as THREE.PointsMaterial

      let targetBubbleOpacity: number
      let targetParticleOpacity: number

      switch (mode) {
        case 'normal':
          targetBubbleOpacity = bubble.baseOpacity
          targetParticleOpacity = 0.8
          break
        case 'threads':
          targetBubbleOpacity = 0
          targetParticleOpacity = 0
          break
        case 'particles':
          targetBubbleOpacity = 0
          targetParticleOpacity = 1.0
          break
      }

      this.animateOpacity(bubbleMat, bubbleMat.opacity, targetBubbleOpacity, transitionTime)
      this.animateOpacity(particleMat, particleMat.opacity, targetParticleOpacity, transitionTime)
    }

    for (const line of this.threadLines) {
      const lineMat = line.material as THREE.LineBasicMaterial
      const targetOpacity = (mode === 'particles') ? 0.08 : 0.15
      this.animateOpacity(lineMat, lineMat.opacity, targetOpacity, transitionTime)
    }
  }

  private animateOpacity(
    material: { opacity: number; transparent?: boolean },
    from: number,
    to: number,
    duration: number
  ): void {
    const start = performance.now()
    const animate = () => {
      const elapsed = performance.now() - start
      const t = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      material.opacity = from + (to - from) * ease
      if (t < 1) requestAnimationFrame(animate)
    }
    animate()
  }

  public update(delta: number, camera: THREE.Camera): void {
    this.time += delta

    for (let i = 0; i < this.BUBBLE_COUNT; i++) {
      const bubble = this.bubbles[i]

      const scaleSpeed = 1 / 0.5
      bubble.currentScale += (bubble.targetScale - bubble.currentScale) * Math.min(delta * scaleSpeed, 1)
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

      const labelMat = bubble.labelSprite.material as THREE.SpriteMaterial
      const targetOpacity = bubble.labelVisible ? 0.95 : 0
      labelMat.opacity += (targetOpacity - labelMat.opacity) * Math.min(delta * 5, 1)

      const labelOffset = bubble.baseRadius * this.scaleFactor * (bubble.isHovered ? this.HOVER_SCALE : 1) + 0.8
      bubble.labelSprite.position.set(
        bubble.position.x,
        bubble.position.y + labelOffset,
        bubble.position.z
      )
      bubble.labelSprite.lookAt(camera.position)

      if (bubble.highlightProgress > 0 && !bubble.isHovered && !bubble.isLocked) {
        bubble.highlightProgress -= delta * 1.5
        if (bubble.highlightProgress <= 0) {
          bubble.highlightProgress = 0
          bubble.targetScale = bubble.baseRadius * this.scaleFactor
        }
      }
    }

    for (let i = 0; i < this.threadLines.length; i++) {
      const line = this.threadLines[i]
      const mat = line.material as THREE.LineBasicMaterial
      const baseOpacity = (this.displayMode === 'particles') ? 0.08 : 0.15
      mat.opacity = baseOpacity * (0.85 + Math.sin(this.time * 1.5 + i * 0.05) * 0.15)
    }
  }
}
