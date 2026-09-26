import { useRef, useState, useEffect, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Equipment } from '../../App'

interface PlayerShipProps {
  equipment: Equipment | null
  onShoot: (position: THREE.Vector3, color: string, damage: number) => void
  isDamaged: boolean
  onDamageEnd: () => void
}

const DEFAULT_PRIMARY_COLOR = '#ffffff'
const DEFAULT_ATTACK_COLOR = '#ffffff'
const DEFAULT_DAMAGE = 10
const DEFAULT_FIRE_RATE = 250

export default function PlayerShip({ equipment, onShoot, isDamaged, onDamageEnd }: PlayerShipProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { viewport, pointer } = useThree()
  const [isMouseDown, setIsMouseDown] = useState(false)
  const lastShotRef = useRef(0)
  const damageTimerRef = useRef<number | null>(null)

  const primaryColor = equipment?.primaryColor || DEFAULT_PRIMARY_COLOR
  const attackColor = equipment?.attackColor || DEFAULT_ATTACK_COLOR
  const damage = equipment?.damage || DEFAULT_DAMAGE
  const fireRate = equipment?.fireRate || DEFAULT_FIRE_RATE

  useEffect(() => {
    const handleMouseDown = () => setIsMouseDown(true)
    const handleMouseUp = () => setIsMouseDown(false)

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  useEffect(() => {
    if (isDamaged) {
      if (damageTimerRef.current) {
        clearTimeout(damageTimerRef.current)
      }
      damageTimerRef.current = window.setTimeout(() => {
        onDamageEnd()
        damageTimerRef.current = null
      }, 200)
    }
    return () => {
      if (damageTimerRef.current) {
        clearTimeout(damageTimerRef.current)
      }
    }
  }, [isDamaged, onDamageEnd])

  const shipShape = useCallback(() => {
    const shape = new THREE.Shape()
    const size = 2
    shape.moveTo(0, size)
    shape.lineTo(-size * 0.7, -size * 0.5)
    shape.lineTo(0, -size * 0.2)
    shape.lineTo(size * 0.7, -size * 0.5)
    shape.lineTo(0, size)
    return shape
  }, [])

  const targetX = (pointer.x * viewport.width) / 2
  const targetY = Math.max((pointer.y * viewport.height) / 2 - viewport.height * 0.3, -viewport.height * 0.4)

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.position.x += (targetX - meshRef.current.position.x) * delta * 10
      meshRef.current.position.y += (targetY - meshRef.current.position.y) * delta * 10

      const now = performance.now()
      if (isMouseDown && now - lastShotRef.current > fireRate) {
        const bulletPos = new THREE.Vector3(
          meshRef.current.position.x,
          meshRef.current.position.y + 2,
          meshRef.current.position.z
        )
        onShoot(bulletPos, attackColor, damage)
        lastShotRef.current = now
      }
    }
  })

  const displayColor = isDamaged ? '#ff0000' : primaryColor

  return (
    <mesh ref={meshRef} position={[0, -3, 0]}>
      <extrudeGeometry
        args={[
          shipShape(),
          {
            depth: 0.3,
            bevelEnabled: true,
            bevelThickness: 0.1,
            bevelSize: 0.1,
            bevelSegments: 2
          }
        ]}
      />
      <meshStandardMaterial
        color={displayColor}
        emissive={displayColor}
        emissiveIntensity={isDamaged ? 2 : 0.5}
        metalness={0.8}
        roughness={0.2}
      />
    </mesh>
  )
}
