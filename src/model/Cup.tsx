import { useRef, useMemo, useEffect, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CatmullRomCurve3 } from 'three'

import { getWaterDepth } from '../store/waterStore'
import type { SimState } from '../sim/cupSimulation'

interface CupProps {
  id: number
  color: string
  curve: CatmullRomCurve3
  totalLength: number
  gateOpening: number
  simRef: MutableRefObject<SimState>
}

export default function Cup({
  id,
  color,
  curve,
  totalLength,
  gateOpening,
  simRef
}: CupProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const rotationRef = useRef(new THREE.Euler(0, 0, 0))
  const wasStuckRef = useRef(false)

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
      if (simRef.current.cups[id].stuck) return
      rotationRef.current.x = (Math.random() - 0.5) * (Math.PI / 12)
      rotationRef.current.z = (Math.random() - 0.5) * (Math.PI / 12)
    }, 800)
    return () => clearInterval(interval)
  }, [id, simRef])

  useFrame(() => {
    if (!meshRef.current) return

    const cup = simRef.current.cups[id]
    const waterDepth = getWaterDepth(gateOpening)

    if (cup.stuck) {
      if (!wasStuckRef.current) {
        rotationRef.current.z = Math.PI / 6 + Math.random() * (Math.PI / 12)
      }
    } else if (wasStuckRef.current) {
      rotationRef.current.z = 0
    }
    wasStuckRef.current = cup.stuck

    if (cup.justCollided) {
      rotationRef.current.y += (Math.random() - 0.5) * (Math.PI / 9)
    }

    let buoyancyOffset = 0
    let pitchOffset = 0

    if (waterDepth > 0.2) {
      buoyancyOffset = (waterDepth - 0.2) * 0.5
    } else if (waterDepth < 0.18) {
      pitchOffset = (0.18 - waterDepth) * 2
    }

    const t = Math.max(0, Math.min(1, cup.distance / totalLength))
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()

    meshRef.current.position.set(
      point.x,
      point.y + buoyancyOffset + 0.08,
      point.z
    )
    meshRef.current.lookAt(point.clone().add(tangent))

    meshRef.current.rotation.set(
      rotationRef.current.x - pitchOffset,
      rotationRef.current.y,
      rotationRef.current.z
    )
  })

  return (
    <mesh
      ref={meshRef}
      geometry={cupGeometry}
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
