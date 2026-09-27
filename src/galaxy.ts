import * as THREE from 'three'

export interface GalaxyParams {
  particleCount: number
  mainArms: number
  smallArms: number
  radius: number
  centerColor: THREE.Color
  edgeColor: THREE.Color
  vividness: number
}

export function generateGalaxy(params: GalaxyParams): {
  geometry: THREE.BufferGeometry
  baseSizes: Float32Array
  baseColors: Float32Array
} {
  const {
    particleCount,
    mainArms,
    smallArms,
    radius,
    centerColor,
    edgeColor,
    vividness,
  } = params

  const totalArms = mainArms + smallArms
  const mainArmParticles = Math.floor(particleCount * 0.8 / mainArms)
  const smallArmParticles = Math.floor(particleCount * 0.2 / smallArms)

  const positions = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)
  const sizes = new Float32Array(particleCount)
  const baseColors = new Float32Array(particleCount * 3)
  const baseSizes = new Float32Array(particleCount)

  let particleIndex = 0

  for (let arm = 0; arm < totalArms; arm++) {
    const isMainArm = arm < mainArms
    const armParticles = isMainArm ? mainArmParticles : smallArmParticles
    const armAngle = (arm / totalArms) * Math.PI * 2
    const armTightness = isMainArm ? 0.5 : 0.3
    const armRadius = isMainArm ? radius : radius * 0.6

    for (let i = 0; i < armParticles && particleIndex < particleCount; i++) {
      const t = i / armParticles
      const distanceFactor = Math.pow(t, 1.2)
      const distance = distanceFactor * armRadius

      const densityFalloff = 1 - distanceFactor * 0.7
      const scatterRadius = (isMainArm ? 0.3 : 0.15) * (0.5 + distanceFactor * 0.5)
      const scatter = scatterRadius * (Math.random() - 0.5) * 2

      const spiralAngle = armAngle + distance * armTightness

      const x = Math.cos(spiralAngle) * distance + (Math.random() - 0.5) * scatter * 2
      const y = (Math.random() - 0.5) * 0.1 * (1 - distanceFactor) + (Math.random() - 0.5) * 0.02
      const z = Math.sin(spiralAngle) * distance + (Math.random() - 0.5) * scatter * 2

      positions[particleIndex * 3] = x
      positions[particleIndex * 3 + 1] = y
      positions[particleIndex * 3 + 2] = z

      const colorMix = distanceFactor
      const r = centerColor.r + (edgeColor.r - centerColor.r) * colorMix
      const g = centerColor.g + (edgeColor.g - centerColor.g) * colorMix
      const b = centerColor.b + (edgeColor.b - centerColor.b) * colorMix

      const colorOffset = (Math.random() - 0.5) * 0.3
      const finalR = THREE.MathUtils.clamp(r * vividness + colorOffset * 0.15, 0, 1)
      const finalG = THREE.MathUtils.clamp(g * vividness + colorOffset * 0.15, 0, 1)
      const finalB = THREE.MathUtils.clamp(b * vividness + colorOffset * 0.15, 0, 1)

      colors[particleIndex * 3] = finalR
      colors[particleIndex * 3 + 1] = finalG
      colors[particleIndex * 3 + 2] = finalB

      baseColors[particleIndex * 3] = finalR
      baseColors[particleIndex * 3 + 1] = finalG
      baseColors[particleIndex * 3 + 2] = finalB

      const size = THREE.MathUtils.lerp(0.08, 0.02, distanceFactor)
      sizes[particleIndex] = size
      baseSizes[particleIndex] = size

      particleIndex++
    }
  }

  while (particleIndex < particleCount) {
    const distanceFactor = Math.pow(Math.random(), 0.8)
    const distance = distanceFactor * radius
    const angle = Math.random() * Math.PI * 2
    const height = (Math.random() - 0.5) * 0.05

    positions[particleIndex * 3] = Math.cos(angle) * distance
    positions[particleIndex * 3 + 1] = height
    positions[particleIndex * 3 + 2] = Math.sin(angle) * distance

    const colorMix = distanceFactor
    const r = centerColor.r + (edgeColor.r - centerColor.r) * colorMix
    const g = centerColor.g + (edgeColor.g - centerColor.g) * colorMix
    const b = centerColor.b + (edgeColor.b - centerColor.b) * colorMix

    colors[particleIndex * 3] = r
    colors[particleIndex * 3 + 1] = g
    colors[particleIndex * 3 + 2] = b
    baseColors[particleIndex * 3] = r
    baseColors[particleIndex * 3 + 1] = g
    baseColors[particleIndex * 3 + 2] = b

    const size = THREE.MathUtils.lerp(0.08, 0.02, distanceFactor)
    sizes[particleIndex] = size
    baseSizes[particleIndex] = size

    particleIndex++
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  return { geometry, baseSizes, baseColors }
}
