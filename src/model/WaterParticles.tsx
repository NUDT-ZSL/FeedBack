import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CatmullRomCurve3 } from 'three'
import { getVortexOffset } from '../utils/curveUtils'
import { getFlowSpeed, getSlopeSpeedMultiplier } from '../store/waterStore'

interface WaterParticlesProps {
  curve: CatmullRomCurve3
  totalLength: number
  gateOpening: number
  slope: number
  curvature: number
}

const PARTICLE_COUNT = 300

export default function WaterParticles({
  curve,
  totalLength,
  gateOpening,
  slope,
  curvature
}: WaterParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const particleData = useRef<{ progress: number; offset: number }[]>([])

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const colors = new Float32Array(PARTICLE_COUNT * 3)
    const sizes = new Float32Array(PARTICLE_COUNT)

    const colorStart = new THREE.Color('#3a7bd5')
    const colorEnd = new THREE.Color('#1a3a6b')

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const progress = i / PARTICLE_COUNT
      particleData.current[i] = {
        progress,
        offset: (Math.random() - 0.5) * 0.1
      }

      const point = curve.getPointAt(progress)
      positions[i * 3] = point.x
      positions[i * 3 + 1] = point.y + 0.05
      positions[i * 3 + 2] = point.z

      const color = new THREE.Color().lerpColors(colorStart, colorEnd, progress)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b

      sizes[i] = 0.02 + Math.random() * 0.02
    }

    return { positions, colors, sizes }
  }, [curve])

  useFrame((_, delta) => {
    if (!pointsRef.current) return

    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array
    const baseSpeed = getFlowSpeed(gateOpening, slope)
    const slopeMultiplier = getSlopeSpeedMultiplier(slope)
    const speed = (baseSpeed * slopeMultiplier) / totalLength

    const currentSpeed = Math.max(speed * delta * 0.3, 0.001)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let progress = particleData.current[i].progress
      progress += currentSpeed * (0.8 + Math.random() * 0.4)

      if (progress > 1) {
        progress -= 1
      }

      particleData.current[i].progress = progress

      const t = progress
      const point = curve.getPointAt(t)

      const vortexPoint = getVortexOffset(point, t, curvature, i)
      const bendFactor = Math.sin(t * Math.PI)
      const vortexDepth = bendFactor * (curvature / 90) * 0.1

      const tangent = curve.getTangentAt(t).normalize()
      const up = new THREE.Vector3(0, 1, 0)
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize()
      const centripetalOffset = normal.multiplyScalar(vortexDepth * 0.5)

      const finalPoint = vortexPoint.add(centripetalOffset)
      const yOffset = Math.sin(progress * Math.PI * 8 + i * 0.618) * 0.01

      positions[i * 3] = finalPoint.x
      positions[i * 3 + 1] = finalPoint.y + yOffset + 0.05
      positions[i * 3 + 2] = finalPoint.z

      const stretchFactor = 1 + baseSpeed * 0.5
      if (pointsRef.current.material instanceof THREE.PointsMaterial) {
        pointsRef.current.material.size = 0.03 * stretchFactor
      }
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={PARTICLE_COUNT}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={PARTICLE_COUNT}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        vertexColors
        transparent
        opacity={0.8}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export type { WaterParticlesProps }
