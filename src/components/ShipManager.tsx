import { useRef, useMemo, useEffect, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore, ShipData, ShipType } from '../store/gameStore'

interface ShipManagerProps {
  riverLength: number
  riverWidth: number
  waterLevel: number
  windSpeed: number
}

interface ShipMeshProps {
  ship: ShipData
  riverLength: number
  riverWidth: number
  waterLevel: number
  windSpeed: number
  onClick: (id: string) => void
  isSelected: boolean
}

function ShipMesh({ ship, riverLength, riverWidth, waterLevel, windSpeed, onClick, isSelected }: ShipMeshProps) {
  const shipGroupRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<THREE.Mesh>(null)
  const oscillationRef = useRef(Math.random() * Math.PI * 2)
  const localProgressRef = useRef(ship.progress)
  const laneOffset = useMemo(() => {
    const laneIndex = parseInt(ship.id.replace('ship', '')) % 4
    return (laneIndex - 1.5) * 2.5
  }, [ship.id])

  const getShipLength = useCallback((type: ShipType) => {
    switch (type) {
      case 'cargo': return 4.5
      case 'passenger': return 4
      case 'fishing': return 3.5
      case 'pleasure': return 5
      default: return 4
    }
  }, [])

  const getRollAmount = useCallback((wind: number) => {
    if (wind < 3) return 1 + Math.random()
    if (wind < 5) return 3 + Math.random() * 2
    return 6 + Math.random() * 2
  }, [])

  const shipLength = getShipLength(ship.type)
  const isDanger = ship.navigationStatus === 'danger'

  useFrame((state, delta) => {
    if (!shipGroupRef.current) return

    localProgressRef.current += ship.speed * 0.003 * delta * 60
    if (localProgressRef.current > 1.1) {
      localProgressRef.current = -0.1
    }

    const progress = localProgressRef.current
    const x = (progress - 0.5) * riverLength
    const waterY = waterLevel * 0.1 - 0.5
    const draftOffset = (5 - waterLevel) * 0.08
    const baseY = waterY - draftOffset

    oscillationRef.current += delta * (1 + windSpeed * 0.15)
    const rollAngle = (getRollAmount(windSpeed) * Math.PI / 180) * Math.sin(oscillationRef.current)
    const pitchAngle = 0.02 * Math.sin(oscillationRef.current * 0.7)
    const bobOffset = 0.05 * Math.sin(oscillationRef.current * 1.2)

    shipGroupRef.current.position.set(x, baseY + bobOffset, laneOffset)
    shipGroupRef.current.rotation.z = rollAngle
    shipGroupRef.current.rotation.x = pitchAngle

    if (bodyRef.current && isDanger) {
      const material = bodyRef.current.material as THREE.MeshStandardMaterial
      const pulse = Math.sin(state.clock.elapsedTime * 8) * 0.5 + 0.5
      material.emissive.setRGB(pulse, 0, 0)
      material.emissiveIntensity = pulse * 0.5
    } else if (bodyRef.current) {
      const material = bodyRef.current.material as THREE.MeshStandardMaterial
      material.emissive.setRGB(0, 0, 0)
      material.emissiveIntensity = 0
    }
  })

  const handleClick = (e: any) => {
    e.stopPropagation()
    onClick(ship.id)
  }

  const renderShipBody = () => {
    const height = ship.type === 'cargo' ? 1.2 : ship.type === 'pleasure' ? 1.8 : 1
    const width = ship.type === 'cargo' ? 1.8 : ship.type === 'pleasure' ? 2 : 1.5

    return (
      <mesh ref={bodyRef} position={[0, height / 2, 0]} castShadow onClick={handleClick}>
        <boxGeometry args={[shipLength, height, width]} />
        <meshStandardMaterial 
          color={ship.color} 
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>
    )
  }

  const renderShipDetails = () => {
    const height = ship.type === 'cargo' ? 1.2 : ship.type === 'pleasure' ? 1.8 : 1

    switch (ship.type) {
      case 'cargo':
        return (
          <group>
            <mesh position={[0, height + 0.3, 0]} castShadow>
              <boxGeometry args={[shipLength * 0.8, 0.6, 1.4]} />
              <meshStandardMaterial color="#8b4513" roughness={0.8} />
            </mesh>
            <mesh position={[-shipLength * 0.3, height + 1.5, 0]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 2.5, 8]} />
              <meshStandardMaterial color="#5c4033" />
            </mesh>
            <mesh position={[-shipLength * 0.3, height + 1.5, 0]} rotation={[0, 0, Math.PI / 2]}>
              <planeGeometry args={[1.5, 2.5]} />
              <meshStandardMaterial color="#f5deb3" side={THREE.DoubleSide} transparent opacity={0.9} />
            </mesh>
          </group>
        )
      case 'passenger':
        return (
          <group>
            {[-0.5, 0.5].map((x, i) => (
              <mesh key={i} position={[x * shipLength * 0.4, height + 0.5, 0]} castShadow>
                <boxGeometry args={[shipLength * 0.35, 1, 1.2]} />
                <meshStandardMaterial color="#f5deb3" roughness={0.8} />
              </mesh>
            ))}
            {[-0.5, 0.5].map((x, i) => (
              <mesh key={`roof${i}`} position={[x * shipLength * 0.4, height + 1.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <coneGeometry args={[1.2, 0.8, 4]} />
                <meshStandardMaterial color="#2f4f4f" roughness={0.8} />
              </mesh>
            ))}
            <mesh position={[0, height + 2, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 2, 8]} />
              <meshStandardMaterial color="#5c4033" />
            </mesh>
          </group>
        )
      case 'fishing':
        return (
          <group>
            <mesh position={[0, height + 0.3, 0]} castShadow>
              <boxGeometry args={[shipLength * 0.6, 0.5, 1]} />
              <meshStandardMaterial color="#5c4033" roughness={0.9} />
            </mesh>
            {[-1, 0, 1].map((x, i) => (
              <mesh key={i} position={[x * shipLength * 0.25, height + 1.2, 0]} rotation={[0, 0, (x * 15) * Math.PI / 180]}>
                <coneGeometry args={[0.05, 1.5, 6]} />
                <meshStandardMaterial color="#8b4513" />
              </mesh>
            ))}
          </group>
        )
      case 'pleasure':
        return (
          <group>
            <mesh position={[0, height + 0.6, 0]} castShadow>
              <boxGeometry args={[shipLength * 0.9, 1.2, 1.6]} />
              <meshStandardMaterial color="#8b0000" roughness={0.6} />
            </mesh>
            <mesh position={[0, height + 1.5, 0]} castShadow>
              <boxGeometry args={[shipLength * 0.95, 0.2, 1.8]} />
              <meshStandardMaterial color="#ffd700" roughness={0.4} metalness={0.6} />
            </mesh>
            {[-0.4, 0, 0.4].map((x, i) => (
              <mesh key={i} position={[x * shipLength, height + 0.6, 0.81]}>
                <boxGeometry args={[0.4, 0.6, 0.05]} />
                <meshStandardMaterial color="#ffd700" />
              </mesh>
            ))}
            <mesh position={[0, height + 2.5, 0]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 3, 8]} />
              <meshStandardMaterial color="#8b4513" />
            </mesh>
            <mesh position={[0, height + 3.5, 0]}>
              <planeGeometry args={[2, 1.5]} />
              <meshStandardMaterial color="#ff6347" side={THREE.DoubleSide} />
            </mesh>
          </group>
        )
      default:
        return null
    }
  }

  const waterLineY = waterLevel * 0.1 - 0.5
  const effectiveDraft = ship.draft + (5 - waterLevel) * 0.1

  return (
    <group ref={shipGroupRef}>
      {renderShipBody()}
      {renderShipDetails()}
      
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[shipLength + 0.5, 2.5]} />
        <meshStandardMaterial 
          color="#000000" 
          transparent 
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>

      <Html
        position={[0, 4, 0]}
        center
        style={{
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        <div
          style={{
            background: isSelected ? 'rgba(139, 58, 58, 0.9)' : 'rgba(245, 230, 211, 0.9)',
            border: `2px solid ${isSelected ? '#ffd700' : '#8b3a3a'}`,
            borderRadius: '4px',
            padding: '4px 8px',
            fontFamily: "'Noto Serif SC', serif",
            fontSize: '12px',
            color: isSelected ? '#ffd700' : '#5c4033',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease'
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{ship.name}</div>
          <div style={{ fontSize: '10px', opacity: 0.8 }}>航速: {ship.speed.toFixed(1)} 节</div>
        </div>
      </Html>

      {isSelected && (
        <mesh position={[0, 0.5, 0]}>
          <ringGeometry args={[shipLength / 2 + 0.5, shipLength / 2 + 0.8, 32]} />
          <meshBasicMaterial 
            color="#ffd700" 
            transparent 
            opacity={0.8}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {isDanger && (
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[shipLength + 0.4, 3, 2.4]} />
          <meshBasicMaterial 
            color="#ff0000" 
            transparent 
            opacity={0.15}
            wireframe
          />
        </mesh>
      )}
    </group>
  )
}

function ShipManager({ riverLength, riverWidth, waterLevel, windSpeed }: ShipManagerProps) {
  const { ships, selectedShipId, setSelectedShipId, updateShip } = useGameStore()

  const handleShipClick = useCallback((id: string) => {
    setSelectedShipId(selectedShipId === id ? null : id)
  }, [selectedShipId, setSelectedShipId])

  useFrame(() => {
    ships.forEach(ship => {
      const shipElement = document.querySelector(`[data-ship-id="${ship.id}"]`)
      if (shipElement) {
        const style = window.getComputedStyle(shipElement)
        const transform = style.transform
        if (transform && transform !== 'none') {
          const matrix = new DOMMatrix(transform)
          const x = matrix.m41 / riverLength + 0.5
          updateShip(ship.id, { progress: Math.max(0, Math.min(1, x)) })
        }
      }
    })
  })

  return (
    <group>
      {ships.map((ship) => (
        <ShipMesh
          key={ship.id}
          ship={ship}
          riverLength={riverLength}
          riverWidth={riverWidth}
          waterLevel={waterLevel}
          windSpeed={windSpeed}
          onClick={handleShipClick}
          isSelected={selectedShipId === ship.id}
        />
      ))}
    </group>
  )
}

export default ShipManager
