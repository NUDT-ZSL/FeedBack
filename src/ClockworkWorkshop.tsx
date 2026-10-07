import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Vector3, Color } from 'three'
import CompassRose from './components/compassRose'
import CompassRoseLamp from './components/compassRoseLamp'
import { LanternInstance, LanternType, LANTERN_CONFIGS } from './types'

interface ClockworkWorkshopProps {
  lanterns: LanternInstance[]
  updateLanterns: (lanterns: LanternInstance[]) => void
  onCanvasReady: (gl: any, canvas: HTMLCanvasElement) => void
  onLanternClick: (id: string) => void
  onDragLantern: (type: LanternType, position: Vector3) => void
  selectedType: LanternType
}

function Boat({ boatRef }: { boatRef: React.RefObject<THREE.Group> }) {
  useFrame((state) => {
    if (boatRef.current) {
      boatRef.current.rotation.z = Math.sin(state.clock.elapsedTime * Math.PI) * 0.017
    }
  })

  const palaceLanterns = useMemo(() => {
    const positions = [
      [-2.5, 1.8, -0.8], [2.5, 1.8, -0.8],
      [-1, 1.8, -0.8], [1, 1.8, -0.8],
      [-2.5, 1.8, 0.8], [2.5, 1.8, 0.8],
    ]
    return positions
  }, [])

  return (
    <group ref={boatRef} position={[0, 0.5, 0]}>
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[8, 1, 3]} />
        <meshStandardMaterial color="#8b0000" metalness={0.3} roughness={0.7} />
      </mesh>

      <mesh position={[0, 0.6, 0]} castShadow>
        <boxGeometry args={[8.2, 0.3, 3.2]} />
        <meshStandardMaterial color="#6b0000" metalness={0.5} roughness={0.5} />
      </mesh>

      <mesh position={[0, 0.75, 1.5]} castShadow>
        <boxGeometry args={[8.4, 0.15, 0.1]} />
        <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.1} emissive="#ffaa00" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.75, -1.5]} castShadow>
        <boxGeometry args={[8.4, 0.15, 0.1]} />
        <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.1} emissive="#ffaa00" emissiveIntensity={0.3} />
      </mesh>

      {[-3, -1, 1, 3].map((x, i) => (
        <mesh key={i} position={[x, 0.75, 1.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.15, 0.08, 8, 16]} />
          <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.1} emissive="#ffaa00" emissiveIntensity={0.5} />
        </mesh>
      ))}

      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[6, 1.5, 2.5]} />
        <meshStandardMaterial color="#8b0000" metalness={0.3} roughness={0.7} transparent opacity={0.9} />
      </mesh>

      <mesh position={[0, 2.3, 0]} castShadow>
        <boxGeometry args={[6.2, 0.2, 2.7]} />
        <meshStandardMaterial color="#6b0000" metalness={0.5} roughness={0.5} />
      </mesh>

      <mesh position={[0, 2.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 6.5, 8]} />
        <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.1} emissive="#ffaa00" emissiveIntensity={0.3} />
      </mesh>

      {palaceLanterns.map((pos, i) => (
        <PalaceLantern key={i} position={pos as [number, number, number]} index={i} />
      ))}

      <LanternStand position={[-4, 0.75, 0]} side="left" />
      <LanternStand position={[4, 0.75, 0]} side="right" />
    </group>
  )
}

function PalaceLantern({ position, index }: { position: [number, number, number]; index: number }) {
  const lanternRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (lanternRef.current) {
      const sway = Math.sin(state.clock.elapsedTime * 1.5 + index * 0.5) * 0.2
      lanternRef.current.position.y = position[1] + sway * 0.1
      lanternRef.current.rotation.z = sway * 0.1
    }
  })

  return (
    <group ref={lanternRef} position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.12, 0.15, 0.35, 16]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff2200" emissiveIntensity={0.8} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.1, 8]} />
        <meshStandardMaterial color="#ffd700" metalness={0.9} />
      </mesh>
      <mesh position={[0, -0.2, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.1, 8]} />
        <meshStandardMaterial color="#ffd700" metalness={0.9} />
      </mesh>
      <pointLight position={[0, 0, 0]} color="#ff6600" intensity={0.5} distance={3} />
    </group>
  )
}

function LanternStand({ position, side, onClick }: { position: [number, number, number]; side: string; onClick?: () => void }) {
  return (
    <group position={position} onClick={onClick}>
      <mesh castShadow>
        <cylinderGeometry args={[0.05, 0.08, 0.8, 8]} />
        <meshStandardMaterial color="#8b4513" metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff2200" emissiveIntensity={0.6} />
      </mesh>
      <pointLight position={[0, 0.5, 0]} color="#ff6600" intensity={0.3} distance={2} />
    </group>
  )
}

function DropZone({ onDrop, selectedType }: { onDrop: (type: LanternType, pos: Vector3) => void; selectedType: LanternType }) {
  const { camera, raycaster, gl } = useThree()
  const dropZoneRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (!dropZoneRef.current) return
    
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2)
    const intersectPoint = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, intersectPoint)
    
    if (intersectPoint) {
      const clampedX = Math.max(-3, Math.min(3, intersectPoint.x))
      const clampedZ = Math.max(-2, Math.min(2, intersectPoint.z))
      
      const type = (e.dataTransfer?.getData('lanternType') as LanternType) || selectedType
      onDrop(type, new Vector3(clampedX, 3, clampedZ))
    }
  }, [camera, raycaster, gl, onDrop, selectedType])

  useEffect(() => {
    const canvas = gl.domElement
    canvas.addEventListener('dragover', (e) => e.preventDefault())
    canvas.addEventListener('drop', handleDrop)
    return () => {
      canvas.removeEventListener('dragover', (e) => e.preventDefault())
      canvas.removeEventListener('drop', handleDrop)
    }
  }, [gl, handleDrop])

  return (
    <group>
      <mesh
        ref={dropZoneRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        receiveShadow
      >
        <ringGeometry args={[2.8, 3.2, 64]} />
        <meshBasicMaterial 
          color="#4488ff" 
          transparent 
          opacity={hovered ? 0.4 : 0.2} 
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        scale={[3, 2, 1]}
        receiveShadow
      >
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial 
          color="#4488ff" 
          transparent 
          opacity={hovered ? 0.1 : 0.05} 
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.015, 0]}
        scale={[3, 2, 1]}
        receiveShadow
      >
        <ringGeometry args={[0.95, 1, 64]} />
        <meshBasicMaterial 
          color="#4488ff" 
          transparent 
          opacity={hovered ? 0.15 : 0.08} 
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

function Scene({ 
  lanterns, 
  updateLanterns, 
  onLanternClick, 
  onDragLantern,
  selectedType,
  boatRef
}: { 
  lanterns: LanternInstance[]
  updateLanterns: (lanterns: LanternInstance[]) => void
  onLanternClick: (id: string) => void
  onDragLantern: (type: LanternType, pos: Vector3) => void
  selectedType: LanternType
  boatRef: React.RefObject<THREE.Group>
}) {
  const { gl, scene, camera } = useThree()
  const [stars, setStars] = useState<{ position: [number, number, number]; size: number }[]>([])

  const floatingLampCount = lanterns.filter(l => l.currentHeight > 2 && l.state !== 'fallen').length
  const shouldShowReflections = floatingLampCount >= 3

  useEffect(() => {
    const generateStars = () => {
      const newStars = []
      const count = 20 + Math.floor(Math.random() * 11)
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.random() * Math.PI * 0.3 + Math.PI * 0.1
        const radius = 40 + Math.random() * 10
        newStars.push({
          position: [
            Math.sin(phi) * Math.cos(theta) * radius,
            Math.cos(phi) * radius + 5,
            Math.sin(phi) * Math.sin(theta) * radius,
          ] as [number, number, number],
          size: 0.02 + Math.random() * 0.06,
        })
      }
      setStars(newStars)
    }
    
    generateStars()
    const interval = setInterval(generateStars, 10000)
    return () => clearInterval(interval)
  }, [])

  const lampData = useMemo(() => {
    return lanterns
      .filter(l => l.state !== 'fallen' && l.currentHeight > 0)
      .map(l => ({
        id: l.id,
        position: l.position,
        color: new Color(LANTERN_CONFIGS[l.type].color),
        glowRadius: LANTERN_CONFIGS[l.type].glowRadius * l.glowIntensity,
      }))
  }, [lanterns])

  useFrame((state, delta) => {
    const now = performance.now()
    let hasChanges = false
    const updated = lanterns.map(lantern => {
      const config = LANTERN_CONFIGS[lantern.type]
      const l = { ...lantern }

      if (l.state === 'hovering') {
        const flicker = Math.sin(now * 0.005 + l.swayOffset) * 0.1
        l.glowIntensity = 0.3 + flicker
        l.position.y = 3 + Math.sin(now * 0.003 + l.swayOffset) * 0.1
      }

      if (l.state === 'ignited' && l.igniteTime) {
        const elapsed = (now - l.igniteTime) / 1000
        if (elapsed > 0.5) {
          l.state = 'rising'
        }
        l.glowIntensity = Math.min(1, elapsed * 2)
      }

      if (l.state === 'rising') {
        l.currentHeight += 0.5 * delta
        l.position.y = l.currentHeight
        l.glowIntensity = Math.min(1, l.glowIntensity + delta * 0.5)

        if (l.currentHeight >= l.targetHeight) {
          if (l.targetHeight > config.maxHeight) {
            l.state = 'falling'
            l.fallTime = now
          } else {
            l.state = 'floating'
            l.glowIntensity = 1
          }
        }

        if (l.currentHeight > config.maxHeight + 1) {
          l.state = 'falling'
          l.fallTime = now
        }
      }

      if (l.state === 'floating') {
        const sway = Math.sin(now * 0.002 + l.swayOffset) * 0.05
        l.position.x += sway * delta
        l.position.z += Math.cos(now * 0.002 + l.swayOffset) * 0.03 * delta
      }

      if (l.state === 'falling' && l.fallTime) {
        const fallElapsed = (now - l.fallTime) / 1000
        const flicker = Math.sin(now * 0.02) * 0.5 + 0.5
        l.glowIntensity = flicker * (1 - fallElapsed / 2)
        
        if (fallElapsed > 2) {
          l.currentHeight -= 2 * delta
          l.position.y = l.currentHeight
          
          if (l.currentHeight <= 0.5) {
            l.state = 'fallen'
            l.glowIntensity = 0
          }
        }
      }

      if (l.state !== lantern.state || 
          l.currentHeight !== lantern.currentHeight ||
          l.glowIntensity !== lantern.glowIntensity ||
          l.position.x !== lantern.position.x ||
          l.position.z !== lantern.position.z ||
          l.position.y !== lantern.position.y) {
        hasChanges = true
      }

      return l
    })

    if (hasChanges) {
      updateLanterns(updated)
    }
  })

  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 20, 10]} intensity={0.3} color="#4466aa" />
      <pointLight position={[0, 10, 0]} intensity={0.2} color="#6688ff" />

      <fog attach="fog" args={['#0a1128', 20, 60]} />
      <color attach="background" args={['#0a1128']} />

      {stars.map((star, i) => (
        <mesh key={i} position={star.position}>
          <sphereGeometry args={[star.size, 8, 8]} />
          <meshBasicMaterial 
            color="#ffffff" 
            transparent 
            opacity={0.5 + Math.sin(Date.now() * 0.001 + i) * 0.3} 
          />
        </mesh>
      ))}

      <CompassRose lamps={lampData} showReflections={shouldShowReflections} />

      <Boat boatRef={boatRef} />

      <DropZone onDrop={onDragLantern} selectedType={selectedType} />

      {lanterns.filter(l => l.state !== 'fallen').map(lantern => (
        <CompassRoseLamp
          key={lantern.id}
          lantern={lantern}
          config={LANTERN_CONFIGS[lantern.type]}
          onClick={() => onLanternClick(lantern.id)}
        />
      ))}

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={20}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.1}
        enableDamping
        dampingFactor={0.05}
      />
    </>
  )
}

function ClockworkWorkshop({
  lanterns,
  updateLanterns,
  onCanvasReady,
  onLanternClick,
  onDragLantern,
  selectedType,
}: ClockworkWorkshopProps) {
  const boatRef = useRef<THREE.Group>(null)

  const handleCreated = useCallback((state: any) => {
    onCanvasReady(state.gl, state.gl.domElement)
    state.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    state.gl.shadowMap.enabled = true
    state.gl.shadowMap.type = THREE.PCFSoftShadowMap
    state.gl.toneMapping = THREE.ACESFilmicToneMapping
    state.gl.toneMappingExposure = 1.2
  }, [onCanvasReady])

  return (
    <Canvas
      shadows
      camera={{ position: [0, 8, 15], fov: 60 }}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      onCreated={handleCreated}
      style={{ width: '100%', height: '100%' }}
    >
      <Scene
        lanterns={lanterns}
        updateLanterns={updateLanterns}
        onLanternClick={onLanternClick}
        onDragLantern={onDragLantern}
        selectedType={selectedType}
        boatRef={boatRef}
      />
    </Canvas>
  )
}

export default ClockworkWorkshop
