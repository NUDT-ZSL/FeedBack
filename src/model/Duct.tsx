import { useMemo } from 'react'
import * as THREE from 'three'
import { generateDuctPoints, createDuctCurve } from '../utils/curveUtils'

interface DuctProps {
  slope: number
  curvature: number
  waterDepth: number
}

export default function Duct({ slope, curvature, waterDepth }: DuctProps) {
  const { ductGeometry, innerWaterGeometry } = useMemo(() => {
    const points = generateDuctPoints(slope, curvature, 50)
    const curve = createDuctCurve(points)

    const ductGeometry = new THREE.TubeGeometry(curve, 100, 0.25, 12, false)
    const innerWaterGeometry = new THREE.TubeGeometry(curve, 100, 0.18, 10, false)

    return { ductGeometry, innerWaterGeometry }
  }, [slope, curvature])

  const waterYOffset = useMemo(() => {
    return 0.18 - waterDepth * 0.4
  }, [waterDepth])

  return (
    <group>
      <mesh geometry={ductGeometry} receiveShadow castShadow>
        <meshStandardMaterial
          color="#b87333"
          roughness={0.9}
          metalness={0.1}
          flatShading
        />
      </mesh>

      <mesh geometry={innerWaterGeometry} position={[0, waterYOffset, 0]}>
        <meshStandardMaterial
          color="#3a7bd5"
          transparent
          opacity={0.6}
          roughness={0.1}
          metalness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[-6, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.6, 0.3, 8]} />
        <meshStandardMaterial color="#6b4e3a" flatShading />
      </mesh>

      <mesh position={[6, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.6, 0.3, 8]} />
        <meshStandardMaterial color="#6b4e3a" flatShading />
      </mesh>

      <mesh position={[-6, -0.1, 0]}>
        <boxGeometry args={[0.3, 0.15, 0.3]} />
        <meshStandardMaterial color="#8b7355" flatShading />
      </mesh>
    </group>
  )
}

export type { DuctProps }
