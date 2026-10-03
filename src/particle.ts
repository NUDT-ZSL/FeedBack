import * as THREE from 'three'

const vertexShader = `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;

  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * 300.0 / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  varying vec3 vColor;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
    alpha = pow(alpha, 1.5);
    gl_FragColor = vec4(vColor, alpha);
  }
`

const HIGHLIGHT_RADIUS = 0.3
const TRANSITION_DURATION = 1.2

export class ParticleSystem {
  points: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
  baseSizes: Float32Array
  baseColors: Float32Array
  currentSizes: Float32Array
  currentColors: Float32Array
  targetSizes: Float32Array
  targetColors: Float32Array
  count: number
  rotationSpeed: number
  twinklePhase: Float32Array
  highlightAnchor: THREE.Vector3 | null = null

  private capacity: number
  private startPositions: Float32Array
  private targetPositions: Float32Array
  private transitionProgress = 1
  private transitionFromCount = 0

  constructor(
    geometry: THREE.BufferGeometry,
    baseSizes: Float32Array,
    baseColors: Float32Array
  ) {
    this.geometry = geometry
    this.baseSizes = baseSizes
    this.baseColors = baseColors
    this.count = baseSizes.length
    this.capacity = this.count
    this.rotationSpeed = 1.0

    this.currentSizes = new Float32Array(baseSizes)
    this.currentColors = new Float32Array(baseColors)
    this.targetSizes = new Float32Array(baseSizes)
    this.targetColors = new Float32Array(baseColors)

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    this.startPositions = new Float32Array(posAttr.array as Float32Array)
    this.targetPositions = new Float32Array(posAttr.array as Float32Array)

    this.twinklePhase = new Float32Array(this.capacity)
    for (let i = 0; i < this.count; i++) {
      this.twinklePhase[i] = Math.random() * Math.PI * 2
    }

    this.geometry.setDrawRange(0, this.count)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geometry, this.material)
  }

  setRotationSpeed(speed: number) {
    this.rotationSpeed = speed
  }

  private ensureCapacity(required: number) {
    if (required <= this.capacity) return
    const newCapacity = required

    const grow = (old: Float32Array, size: number) => {
      const next = new Float32Array(size)
      next.set(old)
      return next
    }

    this.currentSizes = grow(this.currentSizes, newCapacity)
    this.currentColors = grow(this.currentColors, newCapacity * 3)
    this.targetSizes = grow(this.targetSizes, newCapacity)
    this.targetColors = grow(this.targetColors, newCapacity * 3)
    this.twinklePhase = grow(this.twinklePhase, newCapacity)
    this.startPositions = grow(this.startPositions, newCapacity * 3)
    this.targetPositions = grow(this.targetPositions, newCapacity * 3)

    const growAttribute = (name: string, itemSize: number) => {
      const oldAttr = this.geometry.getAttribute(name) as THREE.BufferAttribute
      const next = new Float32Array(newCapacity * itemSize)
      next.set(oldAttr.array as Float32Array)
      this.geometry.setAttribute(name, new THREE.BufferAttribute(next, itemSize))
    }
    growAttribute('position', 3)
    growAttribute('color', 3)
    growAttribute('size', 1)

    this.capacity = newCapacity
  }

  transitionTo(
    newPositions: Float32Array,
    newBaseSizes: Float32Array,
    newBaseColors: Float32Array
  ) {
    const newCount = newBaseSizes.length
    const oldCount = this.count
    const maxCount = Math.max(oldCount, newCount)

    this.ensureCapacity(maxCount)

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const rendered = posAttr.array as Float32Array

    this.startPositions.set(rendered.subarray(0, maxCount * 3))
    this.targetPositions.set(newPositions.subarray(0, newCount * 3))

    for (let i = oldCount; i < newCount; i++) {
      this.startPositions[i * 3] = this.targetPositions[i * 3]
      this.startPositions[i * 3 + 1] = this.targetPositions[i * 3 + 1]
      this.startPositions[i * 3 + 2] = this.targetPositions[i * 3 + 2]
      rendered[i * 3] = this.targetPositions[i * 3]
      rendered[i * 3 + 1] = this.targetPositions[i * 3 + 1]
      rendered[i * 3 + 2] = this.targetPositions[i * 3 + 2]
      this.currentSizes[i] = 0
      this.currentColors[i * 3] = newBaseColors[i * 3]
      this.currentColors[i * 3 + 1] = newBaseColors[i * 3 + 1]
      this.currentColors[i * 3 + 2] = newBaseColors[i * 3 + 2]
      this.twinklePhase[i] = Math.random() * Math.PI * 2
    }
    posAttr.needsUpdate = true

    this.baseSizes = newBaseSizes
    this.baseColors = newBaseColors
    this.transitionFromCount = oldCount
    this.count = newCount
    this.transitionProgress = 0
    this.geometry.setDrawRange(0, maxCount)
  }

  highlightParticle(index: number) {
    if (index < 0 || index >= this.count) return
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    if (!this.highlightAnchor) this.highlightAnchor = new THREE.Vector3()
    this.highlightAnchor.set(posAttr.getX(index), posAttr.getY(index), posAttr.getZ(index))
  }

  resetHighlight() {
    this.highlightAnchor = null
  }

  private applyHighlightTargets() {
    if (!this.highlightAnchor) return
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute

    let nearest = -1
    let nearestDistSq = Infinity
    for (let i = 0; i < this.count; i++) {
      const dx = posAttr.getX(i) - this.highlightAnchor.x
      const dy = posAttr.getY(i) - this.highlightAnchor.y
      const dz = posAttr.getZ(i) - this.highlightAnchor.z
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearest = i
      }
    }
    if (nearest < 0) return

    const px = posAttr.getX(nearest)
    const py = posAttr.getY(nearest)
    const pz = posAttr.getZ(nearest)
    this.highlightAnchor.set(px, py, pz)

    this.targetSizes[nearest] = this.baseSizes[nearest] * 2
    this.targetColors[nearest * 3] = 1
    this.targetColors[nearest * 3 + 1] = 1
    this.targetColors[nearest * 3 + 2] = 1

    for (let i = 0; i < this.count; i++) {
      if (i === nearest) continue
      const dx = posAttr.getX(i) - px
      const dy = posAttr.getY(i) - py
      const dz = posAttr.getZ(i) - pz
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (dist < HIGHLIGHT_RADIUS) {
        const factor = 1 + (1 - dist / HIGHLIGHT_RADIUS) * 0.3
        this.targetColors[i * 3] = Math.min(1, this.baseColors[i * 3] * factor)
        this.targetColors[i * 3 + 1] = Math.min(1, this.baseColors[i * 3 + 1] * factor)
        this.targetColors[i * 3 + 2] = Math.min(1, this.baseColors[i * 3 + 2] * factor)
      }
    }
  }

  update(deltaTime: number, elapsedTime: number) {
    const rotationAngle = (0.5 * this.rotationSpeed * Math.PI / 180) * deltaTime
    this.points.rotation.y += rotationAngle

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute
    const sizeAttr = this.geometry.getAttribute('size') as THREE.BufferAttribute

    const transitioning = this.transitionProgress < 1
    const activeCount = transitioning
      ? Math.max(this.transitionFromCount, this.count)
      : this.count

    if (transitioning) {
      this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / TRANSITION_DURATION)
      const t = this.transitionProgress
      const ease = t * t * (3 - 2 * t)
      const rendered = posAttr.array as Float32Array

      for (let i = 0; i < this.count; i++) {
        const idx = i * 3
        rendered[idx] = this.startPositions[idx] + (this.targetPositions[idx] - this.startPositions[idx]) * ease
        rendered[idx + 1] = this.startPositions[idx + 1] + (this.targetPositions[idx + 1] - this.startPositions[idx + 1]) * ease
        rendered[idx + 2] = this.startPositions[idx + 2] + (this.targetPositions[idx + 2] - this.startPositions[idx + 2]) * ease
      }
      for (let i = this.count; i < activeCount; i++) {
        const idx = i * 3
        rendered[idx] = this.startPositions[idx]
        rendered[idx + 1] = this.startPositions[idx + 1]
        rendered[idx + 2] = this.startPositions[idx + 2]
      }
      posAttr.needsUpdate = true

      if (this.transitionProgress >= 1) {
        this.geometry.setDrawRange(0, this.count)
      }
    }

    for (let i = 0; i < this.count; i++) {
      this.targetSizes[i] = this.baseSizes[i]
      this.targetColors[i * 3] = this.baseColors[i * 3]
      this.targetColors[i * 3 + 1] = this.baseColors[i * 3 + 1]
      this.targetColors[i * 3 + 2] = this.baseColors[i * 3 + 2]
    }
    for (let i = this.count; i < activeCount; i++) {
      this.targetSizes[i] = 0
    }

    this.applyHighlightTargets()

    const easing = 1 - Math.pow(0.01, deltaTime)

    for (let i = 0; i < activeCount; i++) {
      const twinkle = 0.85 + 0.15 * Math.sin(elapsedTime * 2 + this.twinklePhase[i])

      this.currentSizes[i] += (this.targetSizes[i] - this.currentSizes[i]) * easing
      sizeAttr.setX(i, this.currentSizes[i] * twinkle)

      for (let c = 0; c < 3; c++) {
        const idx = i * 3 + c
        this.currentColors[idx] += (this.targetColors[idx] - this.currentColors[idx]) * easing
        colorAttr.setComponent(i, c, this.currentColors[idx] * twinkle)
      }
    }

    colorAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
