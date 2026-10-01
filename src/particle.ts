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
  highlightedIndex: number = -1
  twinklePhase: Float32Array

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

  updateBaseData(baseSizes: Float32Array, baseColors: Float32Array) {
    this.baseSizes = baseSizes
    this.baseColors = baseColors
    for (let i = 0; i < this.count; i++) {
      this.targetSizes[i] = baseSizes[i]
      this.targetColors[i * 3] = baseColors[i * 3]
      this.targetColors[i * 3 + 1] = baseColors[i * 3 + 1]
      this.targetColors[i * 3 + 2] = baseColors[i * 3 + 2]
    }
  }

  highlightParticle(index: number) {
    if (this.highlightedIndex === index) return
    this.resetHighlight()
    this.highlightedIndex = index

    if (index >= 0 && index < this.count) {
      this.targetSizes[index] = this.baseSizes[index] * 2
      this.targetColors[index * 3] = 1
      this.targetColors[index * 3 + 1] = 1
      this.targetColors[index * 3 + 2] = 1

      const positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
      const px = positionAttr.getX(index)
      const py = positionAttr.getY(index)
      const pz = positionAttr.getZ(index)

      for (let i = 0; i < this.count; i++) {
        if (i === index) continue
        const dx = positionAttr.getX(i) - px
        const dy = positionAttr.getY(i) - py
        const dz = positionAttr.getZ(i) - pz
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

        if (dist < 0.3) {
          const factor = 1 + (1 - dist / 0.3) * 0.3
          this.targetColors[i * 3] = Math.min(1, this.baseColors[i * 3] * factor)
          this.targetColors[i * 3 + 1] = Math.min(1, this.baseColors[i * 3 + 1] * factor)
          this.targetColors[i * 3 + 2] = Math.min(1, this.baseColors[i * 3 + 2] * factor)
        }
      }
    }
  }

  resetHighlight() {
    for (let i = 0; i < this.count; i++) {
      this.targetSizes[i] = this.baseSizes[i]
      this.targetColors[i * 3] = this.baseColors[i * 3]
      this.targetColors[i * 3 + 1] = this.baseColors[i * 3 + 1]
      this.targetColors[i * 3 + 2] = this.baseColors[i * 3 + 2]
    }
    this.highlightedIndex = -1
  }

  update(deltaTime: number, elapsedTime: number) {
    const rotationAngle = (0.5 * this.rotationSpeed * Math.PI / 180) * deltaTime
    this.points.rotation.y += rotationAngle

    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute
    const sizeAttr = this.geometry.getAttribute('size') as THREE.BufferAttribute

    const easing = 1 - Math.pow(0.01, deltaTime)

    for (let i = 0; i < this.count; i++) {
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
