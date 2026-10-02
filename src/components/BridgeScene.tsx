import { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Text } from '@react-three/drei'
import * as THREE from 'three'
import ShipManager from './ShipManager'
import { useGameStore } from '../store/gameStore'

const RIVER_LENGTH = 80
const RIVER_WIDTH = 18
const BRIDGE_POSITION = new THREE.Vector3(0, 0, 0)

function River({ waterLevel }: { waterLevel: number }) {
  const waterRef = useRef<THREE.Mesh>(null)
  const waterGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(RIVER_LENGTH, RIVER_WIDTH, 40, 10)
    const positions = geo.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      const z = positions.getY(i)
      positions.setZ(i, Math.sin(x * 0.3) * 0.1 + Math.cos(z * 0.5) * 0.1)
    }
    geo.computeVertexNormals()
    return geo
  }, [])

  useFrame((state) => {
    if (waterRef.current) {
      waterRef.current.position.y = waterLevel * 0.1 - 0.5
      const positions = waterRef.current.geometry.attributes.position as THREE.BufferAttribute
      const time = state.clock.elapsedTime
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i)
        const z = positions.getY(i)
        const wave = Math.sin(x * 0.3 + time * 0.8) * 0.15 + Math.cos(z * 0.5 + time * 0.6) * 0.1
        positions.setZ(i, wave)
      }
      positions.needsUpdate = true
      waterRef.current.geometry.computeVertexNormals()
    }
  })

  return (
    <mesh ref={waterRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, waterLevel * 0.1 - 0.5, 0]}>
      <primitive object={waterGeometry} attach="geometry" />
      <meshStandardMaterial
        color="#87ceeb"
        transparent
        opacity={0.7}
        roughness={0.1}
        metalness={0.3}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function RiverBanks() {
  const bankMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8b7355', roughness: 0.9 }), [])
  
  return (
    <group>
      <mesh position={[0, -0.5, RIVER_WIDTH / 2 + 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[RIVER_LENGTH, 6]} />
        <meshStandardMaterial color="#6b8e23" roughness={1} />
      </mesh>
      <mesh position={[0, -0.5, -RIVER_WIDTH / 2 - 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[RIVER_LENGTH, 6]} />
        <meshStandardMaterial color="#6b8e23" roughness={1} />
      </mesh>
      <mesh position={[0, 0.2, RIVER_WIDTH / 2]}>
        <boxGeometry args={[RIVER_LENGTH, 1, 0.5]} />
        <meshStandardMaterial color="#708090" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.2, -RIVER_WIDTH / 2]}>
        <boxGeometry args={[RIVER_LENGTH, 1, 0.5]} />
        <meshStandardMaterial color="#708090" roughness={0.8} />
      </mesh>
    </group>
  )
}

function House({ position, rotation = 0, scale = 1 }: { position: [number, number, number]; rotation?: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[2.5, 2, 3]} />
        <meshStandardMaterial color="#d4c4a8" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.2, 0]} castShadow>
        <boxGeometry args={[2.8, 0.4, 3.3]} />
        <meshStandardMaterial color="#8b4513" roughness={0.7} />
      </mesh>
      <mesh position={[0, 3.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <coneGeometry args={[2.2, 1.8, 4]} />
        <meshStandardMaterial color="#2f4f4f" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.8, 1.51]}>
        <boxGeometry args={[0.8, 1.6, 0.05]} />
        <meshStandardMaterial color="#5c4033" />
      </mesh>
      <mesh position={[-0.7, 1.5, 1.51]}>
        <boxGeometry args={[0.5, 0.5, 0.05]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
      <mesh position={[0.7, 1.5, 1.51]}>
        <boxGeometry args={[0.5, 0.5, 0.05]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
    </group>
  )
}

function Willow({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const leavesRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (leavesRef.current) {
      leavesRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.05
    }
  })

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.25, 3, 8]} />
        <meshStandardMaterial color="#5c4033" roughness={0.9} />
      </mesh>
      <group ref={leavesRef} position={[0, 3.5, 0]}>
        {[-1, -0.5, 0, 0.5, 1].map((x, i) => (
          <mesh key={i} position={[x, -0.5, 0]} rotation={[0, 0, x * 0.3]}>
            <sphereGeometry args={[0.4, 8, 8]} />
            <meshStandardMaterial color="#228b22" roughness={0.8} />
          </mesh>
        ))}
        {[-0.7, 0.7].map((z, i) => (
          <mesh key={`z${i}`} position={[0, -0.5, z]}>
            <sphereGeometry args={[0.35, 8, 8]} />
            <meshStandardMaterial color="#32cd32" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function Buildings() {
  const houses = useMemo(() => {
    const result: { pos: [number, number, number]; rot: number; scale: number }[] = []
    for (let x = -35; x <= 35; x += 6) {
      if (Math.abs(x) < 8) continue
      const zOffset = (Math.random() - 0.5) * 2
      result.push({
        pos: [x + (Math.random() - 0.5) * 2, 0, RIVER_WIDTH / 2 + 4 + zOffset],
        rot: Math.PI + (Math.random() - 0.5) * 0.3,
        scale: 0.8 + Math.random() * 0.4
      })
      result.push({
        pos: [x + (Math.random() - 0.5) * 2, 0, -RIVER_WIDTH / 2 - 4 - zOffset],
        rot: (Math.random() - 0.5) * 0.3,
        scale: 0.8 + Math.random() * 0.4
      })
    }
    return result
  }, [])

  const willows = useMemo(() => {
    const result: { pos: [number, number, number]; rot: number }[] = []
    for (let x = -32; x <= 32; x += 8) {
      if (Math.abs(x) < 12) continue
      result.push({
        pos: [x, 0, RIVER_WIDTH / 2 + 1],
        rot: Math.random() * Math.PI * 2
      })
      result.push({
        pos: [x, 0, -RIVER_WIDTH / 2 - 1],
        rot: Math.random() * Math.PI * 2
      })
    }
    return result
  }, [])

  return (
    <group>
      {houses.map((h, i) => (
        <House key={`house${i}`} position={h.pos} rotation={h.rot} scale={h.scale} />
      ))}
      {willows.map((w, i) => (
        <Willow key={`willow${i}`} position={w.pos} rotation={w.rot} />
      ))}
    </group>
  )
}

function Bridge() {
  const bridgeArchHeight = 6
  const bridgeLength = 22
  const bridgeWidth = 5
  const segments = 10

  const archPoints = useMemo(() => {
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const x = (t - 0.5) * bridgeLength
      const y = bridgeArchHeight * Math.cos((t - 0.5) * Math.PI)
      points.push(new THREE.Vector3(x, y, 0))
    }
    return points
  }, [])

  const archCurve = useMemo(() => new THREE.CatmullRomCurve3(archPoints), [archPoints])

  const archGeometry = useMemo(() => {
    return new THREE.TubeGeometry(archCurve, 32, 0.3, 8, false)
  }, [archCurve])

  const deckPoints = useMemo(() => {
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const x = (t - 0.5) * bridgeLength
      const y = bridgeArchHeight * Math.cos((t - 0.5) * Math.PI) + 0.5
      points.push(new THREE.Vector3(x, y, 0))
    }
    return points
  }, [])

  const deckCurve = useMemo(() => new THREE.CatmullRomCurve3(deckPoints), [deckPoints])

  return (
    <group position={BRIDGE_POSITION}>
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <primitive object={archGeometry} attach="geometry" />
        <meshStandardMaterial color="#8b4513" roughness={0.7} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[0, 0, -bridgeWidth / 2]} castShadow>
        <primitive object={archGeometry} attach="geometry" />
        <meshStandardMaterial color="#8b4513" roughness={0.7} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[0, 0, bridgeWidth / 2]} castShadow>
        <primitive object={archGeometry} attach="geometry" />
        <meshStandardMaterial color="#8b4513" roughness={0.7} />
      </mesh>

      {Array.from({ length: segments }).map((_, i) => {
        const t = (i + 0.5) / segments
        const x = (t - 0.5) * bridgeLength
        const y = bridgeArchHeight * Math.cos((t - 0.5) * Math.PI) + 0.8
        return (
          <group key={`beam${i}`}>
            <mesh position={[x, y, 0]} rotation={[0, 0, Math.sin((t - 0.5) * Math.PI) * 0.3]} castShadow>
              <boxGeometry args={[0.25, 0.25, bridgeWidth + 0.5]} />
              <meshStandardMaterial color="#a0522d" roughness={0.6} />
            </mesh>
            {[-bridgeWidth / 2, bridgeWidth / 2].map((z, j) => (
              <mesh key={`rail${i}-${j}`} position={[x, y + 0.6, z]} castShadow>
                <boxGeometry args={[0.15, 1, 0.15]} />
                <meshStandardMaterial color="#654321" roughness={0.7} />
              </mesh>
            ))}
          </group>
        )
      })}

      {Array.from({ length: segments + 1 }).map((_, i) => {
        const t = i / segments
        const x = (t - 0.5) * bridgeLength
        const y = bridgeArchHeight * Math.cos((t - 0.5) * Math.PI) + 0.5
        const angle = Math.atan2(-bridgeArchHeight * Math.PI * Math.sin((t - 0.5) * Math.PI) * 0.5, bridgeLength * 0.5)
        return (
          <group key={`deck${i}`}>
            <mesh position={[x, y, 0]} rotation={[0, 0, angle]} castShadow receiveShadow>
              <boxGeometry args={[bridgeLength / segments + 0.05, 0.15, bridgeWidth]} />
              <meshStandardMaterial color="#deb887" roughness={0.8} />
            </mesh>
          </group>
        )
      })}

      {[-bridgeWidth / 2 - 0.1, bridgeWidth / 2 + 0.1].map((z, zi) => (
        <mesh key={`handrail${zi}`} position={[0, bridgeArchHeight + 1.3, z]}>
          <boxGeometry args={[bridgeLength + 1, 0.1, 0.1]} />
          <meshStandardMaterial color="#654321" roughness={0.7} />
        </mesh>
      ))}

      <Pedestrians deckCurve={deckCurve} bridgeWidth={bridgeWidth} />
      <WarningFlag />
    </group>
  )
}

function Pedestrians({ deckCurve, bridgeWidth }: { deckCurve: THREE.Curve<THREE.Vector3>; bridgeWidth: number }) {
  const pedestrianData = useMemo(() => {
    return Array.from({ length: 12 }).map((_, i) => ({
      progress: Math.random(),
      speed: 0.03 + Math.random() * 0.05,
      side: Math.random() > 0.5 ? 1 : -1,
      direction: Math.random() > 0.5 ? 1 : -1,
      color: new THREE.Color().setHSL(Math.random(), 0.5, 0.3 + Math.random() * 0.4)
    }))
  }, [])

  const pedestriansRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!pedestriansRef.current) return
    pedestrianData.forEach((p, i) => {
      p.progress += p.speed * 0.016 * p.direction
      if (p.progress > 1) p.progress = 0
      if (p.progress < 0) p.progress = 1
      
      const pos = deckCurve.getPoint(p.progress)
      const mesh = pedestriansRef.current!.children[i] as THREE.Mesh
      mesh.position.set(pos.x, pos.y + 0.5, pos.z + p.side * (bridgeWidth / 3))
      
      const tangent = deckCurve.getTangent(p.progress)
      mesh.rotation.y = Math.atan2(tangent.x, tangent.y) + (p.direction > 0 ? 0 : Math.PI)
    })
  })

  return (
    <group ref={pedestriansRef}>
      {pedestrianData.map((p, i) => (
        <mesh key={i} castShadow>
          <boxGeometry args={[0.3, 1, 0.2]} />
          <meshStandardMaterial color={p.color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function WarningFlag() {
  const { alertActive } = useGameStore()
  const flagRef = useRef<THREE.Mesh>(null)
  
  useFrame((state) => {
    if (flagRef.current) {
      flagRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 3) * 0.3
    }
  })

  return (
    <group position={[-10, 10, 8]}>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 4, 8]} />
        <meshStandardMaterial color="#8b4513" />
      </mesh>
      <mesh ref={flagRef} position={[0.7, 1.8, 0]}>
        <planeGeometry args={[1.5, 1]} />
        <meshStandardMaterial 
          color={alertActive ? '#ff0000' : '#ffd700'} 
          side={THREE.DoubleSide}
          emissive={alertActive ? '#ff0000' : '#000000'}
          emissiveIntensity={alertActive ? 0.5 : 0}
        />
      </mesh>
    </group>
  )
}

function CameraController() {
  const { selectedShipId, ships } = useGameStore()
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)
  const targetCameraPos = useRef(new THREE.Vector3(15, 12, 15))
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0))
  const isAnimating = useRef(false)

  useEffect(() => {
    if (selectedShipId) {
      const ship = ships.find(s => s.id === selectedShipId)
      if (ship) {
        const progress = ship.progress
        const x = (progress - 0.5) * RIVER_LENGTH
        const shipPos = new THREE.Vector3(x, 2, 0)
        targetCameraPos.current.copy(shipPos).add(new THREE.Vector3(6, 4, 6))
        targetLookAt.current.copy(shipPos)
        isAnimating.current = true
      }
    } else {
      targetCameraPos.current.set(15, 12, 15)
      targetLookAt.current.set(0, 0, 0)
      isAnimating.current = true
    }
  }, [selectedShipId, ships])

  useFrame((_, delta) => {
    const lerpFactor = isAnimating.current ? 0.05 : 0
    if (lerpFactor > 0) {
      camera.position.lerp(targetCameraPos.current, lerpFactor)
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLookAt.current, lerpFactor)
      }
      
      if (camera.position.distanceTo(targetCameraPos.current) < 0.1) {
        isAnimating.current = false
      }
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      minDistance={5}
      maxDistance={60}
      maxPolarAngle={Math.PI / 2.1}
      minPolarAngle={Math.PI / 6}
      target={[0, 0, 0]}
    />
  )
}

function SceneContent() {
  const { waterLevel, windSpeed, ships, setAlertActive, updateShip } = useGameStore()

  useFrame(() => {
    let hasWarning = false
    ships.forEach(ship => {
      const effectiveDraft = ship.draft + (5 - waterLevel) * 0.1
      const diff = waterLevel * 0.1 - effectiveDraft * 0.3
      if (diff < 0.5) {
        hasWarning = true
        updateShip(ship.id, { navigationStatus: 'warning' })
      } else if (windSpeed >= 7) {
        updateShip(ship.id, { navigationStatus: 'danger' })
      } else {
        updateShip(ship.id, { navigationStatus: 'normal' })
      }
    })
    setAlertActive(hasWarning)
  })

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 30, 20]} intensity={1} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-10, 10, -10]} intensity={0.3} />
      <hemisphereLight args={['#87ceeb', '#8b7355', 0.4]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#f5e6d3" />
      </mesh>

      <fog attach="fog" args={['#f5e6d3', 50, 100]} />

      <River waterLevel={waterLevel} />
      <RiverBanks />
      <Buildings />
      <Bridge />
      <ShipManager riverLength={RIVER_LENGTH} riverWidth={RIVER_WIDTH} waterLevel={waterLevel} windSpeed={windSpeed} />
      <CameraController />
    </>
  )
}

function BridgeScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [15, 12, 15], fov: 60, near: 0.1, far: 1000 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      style={{ background: '#f5e6d3' }}
    >
      <SceneContent />
    </Canvas>
  )
}

export default BridgeScene
