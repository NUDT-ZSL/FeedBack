import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CatmullRomCurve3 } from 'three'

import { getWaterDepth, getFlowSpeed, getSlopeSpeedMultiplier } from '../store/waterStore'

interface CupProps {
  id: number
  color: string
  curve: CatmullRomCurve3
  totalLength: number
  gateOpening: number
  slope: number
  curvature: number
  allCups: { id: number; distance: number; setDistance: (d: number) => void }[]
  onCollision: () => void
  onFinish: () => void
  setDistance: (d: number) => void
  distance: number
}

export default function Cup({
  id,
  color,
  curve,
  totalLength,
  gateOpening,
  slope,
  curvature,
  allCups,
  onCollision,
  onFinish,
  setDistance,
  distance
}: CupProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const rotationRef = useRef({ x: 0, y: 0, z: 0 })
  const velocityRef = useRef(0)
  const stuckRef = useRef(false)
  const [rotation, setRotation] = useState([0, 0, 0])

  const cupGeometry = useMemo(() => {
    const profilePoints: THREE.Vector2[] = []
    const segments = 16

    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const radius = 0.08 + t * 0.04
      const y = -0.05 + t * 0.1
      profilePoints.push(new THREE.Vector2(radius, y))
    }

    const geometry = new THREE.LatheGeometry(profilePoints, 16)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(0, 0.02, 0)
    return geometry
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!stuckRef.current) {
        rotationRef.current.x = (Math.random() - 0.5) * (Math.PI / 12)
        rotationRef.current.z = (Math.random() - 0.5) * (Math.PI / 12)
      }
    }, 800)
    return () => clearInterval(interval)
  }, [])

  useFrame((_, delta) => {
    if (!meshRef.current) return

    const waterDepth = getWaterDepth(gateOpening)
    const baseSpeed = getFlowSpeed(gateOpening, slope)
    const slopeMultiplier = getSlopeSpeedMultiplier(slope)
    const speed = baseSpeed * slopeMultiplier

    const currentT = distance / totalLength
    const bendFactor = Math.sin(currentT * Math.PI)
    const curveSlowdown = 1 - bendFactor * (curvature / 90) * 0.3

    velocityRef.current = speed * curveSlowdown

    if (waterDepth < 0.12) {
      stuckRef.current = true
      velocityRef.current = 0
      rotationRef.current.z = Math.PI / 6 + (Math.random() * Math.PI / 12)
    } else if (stuckRef.current && waterDepth > 0.15) {
      stuckRef.current = false
      velocityRef.current = speed * 0.5
    }

    let buoyancyOffset = 0
    let pitchOffset = 0

    if (waterDepth > 0.2) {
      buoyancyOffset = (waterDepth - 0.2) * 0.5
    } else if (waterDepth < 0.18) {
      pitchOffset = (0.18 - waterDepth) * 2
    }

    const newDistance = distance + velocityRef.current * delta
    const t = Math.max(0, Math.min(1, newDistance / totalLength))
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()

    allCups.forEach(otherCup => {
      if (otherCup.id !== id) {
        const distanceDiff = Math.abs(newDistance - otherCup.distance)

        if (distanceDiff < 0.08 && distanceDiff > 0) {
          onCollision()

          const thisBehind = newDistance < otherCup.distance
          if (thisBehind) {
            velocityRef.current *= -0.5
            rotationRef.current.y += (Math.random() - 0.5) * (Math.PI / 9)
          }
        }
      }
    })

    if (newDistance >= totalLength) {
      setDistance(0)
      onFinish()
      return
    }

    setDistance(newDistance)

    const lookAtPoint = point.clone().add(tangent)
    meshRef.current.position.set(
      point.x,
      point.y + buoyancyOffset + 0.08,
      point.z
    )
    meshRef.current.lookAt(lookAtPoint)

    const finalRotX = rotationRef.current.x - pitchOffset
    const finalRotY = rotationRef.current.y
    const finalRotZ = rotationRef.current.z

    setRotation([finalRotX, finalRotY, finalRotZ])
  })

  return (
    <mesh
      ref={meshRef}
      geometry={cupGeometry}
      rotation={rotation as [number, number, number]}
      castShadow
    >
      <meshStandardMaterial
        color={color}
        roughness={0.7}
        metalness={0.1}
        flatShading
      />
    </mesh>
  )
}

export type { CupProps }
