import { useMemo } from 'react'
import * as THREE from 'three'
import { generateRockPoints } from '../utils/curveUtils'

const noise = (x: number, y: number, z: number): number => {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return n - Math.floor(n)
}

export default function Rockery() {
  const rocks = useMemo(() => {
    const positions = generateRockPoints()
    const rockData: { pos: THREE.Vector3; scale: THREE.Vector3; rot: THREE.Euler }[] = []

    positions.forEach((pos) => {
      const nx = noise(pos.x, pos.y, pos.z)
      const ny = noise(pos.x + 100, pos.y + 100, pos.z + 100)
      const nz = noise(pos.x + 200, pos.y + 200, pos.z + 200)

      const scale = new THREE.Vector3(
        0.8 + nx * 0.8,
        1.2 + ny * 0.8,
        0.8 + nz * 0.8
      )

      const rot = new THREE.Euler(
        (nx - 0.5) * 0.3,
        (ny - 0.5) * Math.PI,
        (nz - 0.5) * 0.3
      )

      rockData.push({ pos, scale, rot })
    })

    return rockData
  }, [])

  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh
          key={i}
          position={rock.pos}
          rotation={rock.rot}
          scale={rock.scale}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color="#6b4e3a"
            roughness={0.95}
            metalness={0.05}
            flatShading
          />
        </mesh>
      ))}
    </group>
  )
}
