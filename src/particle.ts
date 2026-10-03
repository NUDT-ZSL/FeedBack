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
const SHRINK_EPSILON = 0.002

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
  targetPositions: Float32Array
  count: number
  rotationSpeed: number
  highlightedIndex: number = -1
  twinklePhase: Float32Array
  private pendingShrink: { newCount: number } | null = null

  constructor(
    geometry: THREE.BufferGeometry,
    baseSizes: Float32Array,
    baseColors: Float32Array
  ) {
    this.geometry = geometry
    this.baseSizes = baseSizes
    this.baseColors = baseColors
    this.count = baseSizes.length
    this.rotationSpeed = 1.0

    this.currentSizes = new Float32Array(baseSizes)
    this.currentColors = new Float32Array(baseColors)
    this.targetSizes = new Float32Array(baseSizes)
    this.targetColors = new Float32Array(baseColors)

    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute
    this.targetPositions = new Float32Array(positionAttr.array as Float32Array)

    this.twinklePhase = new Float32Array(this.count)
    for (let i = 0; i < this.count; i++) {
      this.twinklePhase[i] = Math.random() * Math.PI * 2
    }

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

  startTransition(positions: Float32Array, baseSizes: Float32Array, baseColors: Float32Array) {
    const newCount = baseSizes.length

    if (newCount > this.count) {
      this.grow(newCount, positions, baseSizes, baseColors)
      this.pendingShrink = null
    } else if (newCount < this.count) {
      this.pendingShrink = { newCount }
      this.baseSizes.set(baseSizes)
      this.baseColors.set(baseColors)
      this.targetPositions.set(positions)
    } else {
      this.pendingShrink = null
      this.baseSizes = baseSizes
      this.baseColors = baseColors
      this.targetPositions.set(positions)
    }

    this.refreshHighlight()
  }

  private grow(newCount: number, positions: Float32Array, baseSizes: Float32Array, baseColors: Float32Array) {
    const oldCount = this.count

    const newPositions = new Float32Array(newCount * 3)
    const positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    newPositions.set((positionAttr.array as Float32Array).subarray(0, oldCount * 3))
    newPositions.set(positions.subarray(oldCount * 3), oldCount * 3)

    const newColors = new Float32Array(newCount * 3)
    newColors.set(this.currentColors)
    newColors.set(baseColors.subarray(oldCount * 3), oldCount * 3)

    const newSizes = new Float32Array(newCount)
    newSizes.set(this.currentSizes)

    this.geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(newColors, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(newSizes, 1))

    const currentSizes = new Float32Array(newCount)
    currentSizes.set(this.currentSizes)
    this.currentSizes = currentSizes

    const currentColors = new Float32Array(newCount * 3)
    currentColors.set(this.currentColors)
    currentColors.set(baseColors.subarray(oldCount * 3), oldCount * 3)
    this.currentColors = currentColors

    this.targetSizes = new Float32Array(newCount)
    this.targetColors = new Float32Array(newCount * 3)
    this.targetPositions = new Float32Array(positions)

    const twinklePhase = new Float32Array(newCount)
    twinklePhase.set(this.twinklePhase)
    for (let i = oldCount; i < newCount; i++) {
      twinklePhase[i] = Math.random() * Math.PI * 2
    }
    this.twinklePhase = twinklePhase

    this.baseSizes = baseSizes
    this.baseColors = baseColors
    this.count = newCount
  }

  private finalizeShrink() {
    if (!this.pendingShrink) return
    const newCount = this.pendingShrink.newCount
    this.pendingShrink = null

    this.baseSizes = this.baseSizes.slice(0, newCount)
    this.baseColors = this.baseColors.slice(0, newCount * 3)
    this.currentSizes = this.currentSizes.slice(0, newCount)
    this.currentColors = this.currentColors.slice(0, newCount * 3)
    this.targetSizes = this.targetSizes.slice(0, newCount)
    this.targetColors = this.targetColors.slice(0, newCount * 3)
    this.targetPositions = this.targetPositions.slice(0, newCount * 3)
    this.twinklePhase = this.twinklePhase.slice(0, newCount)

    const positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute
    const sizeAttr = this.geometry.getAttribute('size') as THREE.BufferAttribute
    this.geometry.setAttribute('position', new THREE.BufferAttribute((positionAttr.array as Float32Array).slice(0, newCount * 3), 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute((colorAttr.array as Float32Array).slice(0, newCount * 3), 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute((sizeAttr.array as Float32Array).slice(0, newCount), 1))

    this.count = newCount
    this.refreshHighlight()
  }

  private effectiveCount() {
    return this.pendingShrink ? this.pendingShrink.newCount : this.count
  }

  private applyBaseTargets() {
    const effective = this.effectiveCount()
    for (let i = 0; i < this.count; i++) {
      this.targetSizes[i] = i < effective ? this.baseSizes[i] : 0
      this.targetColors[i * 3] = this.baseColors[i * 3]
      this.targetColors[i * 3 + 1] = this.baseColors[i * 3 + 1]
      this.targetColors[i * 3 + 2] = this.baseColors[i * 3 + 2]
    }
  }

  private applyHighlightEffect() {
    const index = this.highlightedIndex
    const effective = this.effectiveCount()
    if (index < 0 || index >= effective) return

    this.targetSizes[index] = this.baseSizes[index] * 2
    this.targetColors[index * 3] = 1
    this.targetColors[index * 3 + 1] = 1
    this.targetColors[index * 3 + 2] = 1

    const targets = this.targetPositions
    const px = targets[index * 3]
    const py = targets[index * 3 + 1]
    const pz = targets[index * 3 + 2]

    for (let i = 0; i < effective; i++) {
      if (i === index) continue
      const dx = targets[i * 3] - px
      const dy = targets[i * 3 + 1] - py
      const dz = targets[i * 3 + 2] - pz
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (dist < HIGHLIGHT_RADIUS) {
        const factor = 1 + (1 - dist / HIGHLIGHT_RADIUS) * 0.3
        this.targetColors[i * 3] = Math.min(1, this.baseColors[i * 3] * factor)
        this.targetColors[i * 3 + 1] = Math.min(1, this.baseColors[i * 3 + 1] * factor)
        this.targetColors[i * 3 + 2] = Math.min(1, this.baseColors[i * 3 + 2] * factor)
      }
    }
  }

  refreshHighlight() {
    const index = this.highlightedIndex
    this.applyBaseTargets()
    if (index < 0 || index >= this.effectiveCount()) {
      this.highlightedIndex = -1
      return
    }
    this.applyHighlightEffect()
  }

  highlightParticle(index: number) {
    if (this.highlightedIndex === index) return
    this.resetHighlight()
    if (index < 0 || index >= this.effectiveCount()) return
    this.highlightedIndex = index
    this.applyHighlightEffect()
  }

  resetHighlight() {
    this.applyBaseTargets()
    this.highlightedIndex = -1
  }

  update(deltaTime: number, elapsedTime: number) {
    const rotationAngle = (0.5 * this.rotationSpeed * Math.PI / 180) * deltaTime
    this.points.rotation.y += rotationAngle

    const positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute
    const sizeAttr = this.geometry.getAttribute('size') as THREE.BufferAttribute
    const positionArray = positionAttr.array as Float32Array

    const easing = 1 - Math.pow(0.01, deltaTime)

    const shrinking = this.pendingShrink !== null
    const shrinkFrom = this.pendingShrink ? this.pendingShrink.newCount : this.count
    let shrinkDone = shrinking

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3
      positionArray[i3] += (this.targetPositions[i3] - positionArray[i3]) * easing
      positionArray[i3 + 1] += (this.targetPositions[i3 + 1] - positionArray[i3 + 1]) * easing
      positionArray[i3 + 2] += (this.targetPositions[i3 + 2] - positionArray[i3 + 2]) * easing

      const twinkle = 0.85 + 0.15 * Math.sin(elapsedTime * 2 + this.twinklePhase[i])

      this.currentSizes[i] += (this.targetSizes[i] - this.currentSizes[i]) * easing
      sizeAttr.setX(i, this.currentSizes[i] * twinkle)

      for (let c = 0; c < 3; c++) {
        const idx = i3 + c
        this.currentColors[idx] += (this.targetColors[idx] - this.currentColors[idx]) * easing
        colorAttr.setComponent(i, c, this.currentColors[idx] * twinkle)
      }

      if (shrinking && i >= shrinkFrom && this.currentSizes[i] > SHRINK_EPSILON) {
        shrinkDone = false
      }
    }

    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    sizeAttr.needsUpdate = true

    if (shrinking && shrinkDone) {
      this.finalizeShrink()
    }
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}
