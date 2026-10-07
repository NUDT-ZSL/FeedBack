import { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Environment, Float, Stars } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { gsap } from 'gsap'
import { WoodMaterial } from './Materials'
import { FurnitureComponent, shouldShowHalo, isAutoRotate, setAutoRotate } from './Assembly'

interface WoodParticle {
  id: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  rotation: THREE.Euler
  age: number
}

interface SceneProps {
  selectedMaterial: WoodMaterial | null
  selectedTool: 'plane' | 'chisel' | null
  components: FurnitureComponent[]
  onProcessingComplete: () => void
  onComponentHover: (component: FurnitureComponent | null) => void
}

function WoodTextureMaterial({ color, texture }: { color: string; texture: string }) {
  const material = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const baseColor = new THREE.Color(color)
    
    ctx.fillStyle = `rgb(${baseColor.r * 255}, ${baseColor.g * 255}, ${baseColor.b * 255})`
    ctx.fillRect(0, 0, 512, 512)
    
    for (let i = 0; i < 512; i++) {
      const alpha = 0.08 + Math.random() * 0.08
      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`
      ctx.lineWidth = 1 + Math.random() * 2
      ctx.beginPath()
      
      if (texture === 'straight') {
        const y = i + (Math.random() - 0.5) * 10
        ctx.moveTo(0, y)
        ctx.lineTo(512, y + (Math.random() - 0.5) * 5)
      } else if (texture === 'wave') {
        const offset = Math.sin(i * 0.02) * 20
        ctx.moveTo(0, i + offset)
        for (let x = 0; x < 512; x += 10) {
          ctx.lineTo(x, i + Math.sin(x * 0.015 + i * 0.01) * 15 + offset)
        }
      } else if (texture === 'oxhair') {
        const y = i + (Math.random() - 0.5) * 30
        ctx.moveTo(0, y)
        ctx.bezierCurveTo(170, y + 10, 341, y - 10, 512, y + (Math.random() - 0.5) * 20)
      } else if (texture === 'gold') {
        const y = i
        ctx.moveTo(0, y)
        ctx.lineTo(512, y)
        if (Math.random() > 0.85) {
          ctx.fillStyle = '#FFD700'
          for (let j = 0; j < 3; j++) {
            const gx = Math.random() * 512
            const gy = y + (Math.random() - 0.5) * 20
            ctx.beginPath()
            ctx.arc(gx, gy, 1 + Math.random() * 2, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.stroke()
    }
    
    const textureObj = new THREE.CanvasTexture(canvas)
    textureObj.wrapS = THREE.RepeatWrapping
    textureObj.wrapT = THREE.RepeatWrapping
    return new THREE.MeshStandardMaterial({
      map: textureObj,
      roughness: 0.7,
      metalness: 0.1
    })
  }, [color, texture])
  
  return <primitive object={material} attach="material" />
}

function WorkshopRoom() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 8]} />
        <meshStandardMaterial color="#e8d5b7" roughness={0.9} />
      </mesh>
      
      <mesh position={[0, 2.5, -4]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#c4a882" side={THREE.DoubleSide} />
      </mesh>
      
      <mesh position={[-5, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[8, 5]} />
        <meshStandardMaterial color="#c4a882" side={THREE.DoubleSide} />
      </mesh>
      
      <mesh position={[5, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[8, 5]} />
        <meshStandardMaterial color="#c4a882" side={THREE.DoubleSide} />
      </mesh>
      
      <mesh position={[0, 2.5, 4]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color="#c4a882" side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function HangingTools() {
  const toolPositions = useMemo(() => {
    const positions: Array<[number, number, number, number]> = []
    for (let i = 0; i < 12; i++) {
      const wall = Math.floor(Math.random() * 3)
      let x = 0, z = 0
      if (wall === 0) {
        x = (Math.random() - 0.5) * 9
        z = -3.9
      } else if (wall === 1) {
        x = -4.9
        z = (Math.random() - 0.5) * 7
      } else {
        x = 4.9
        z = (Math.random() - 0.5) * 7
      }
      const y = 2 + Math.random() * 2
      const rotation = (Math.random() - 0.5) * 0.5
      positions.push([x, y, z, rotation])
    }
    return positions
  }, [])
  
  return (
    <group>
      {toolPositions.map((pos, i) => (
        <group key={i} position={[pos[0], pos[1], pos[2]]} rotation={[0, 0, pos[3]]}>
          <mesh>
            <boxGeometry args={[0.05, 0.6, 0.15]} />
            <meshStandardMaterial color="#8b4513" />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[0.02, 0.3, 0.02]} />
            <meshStandardMaterial color="#333333" metalness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Workbench() {
  return (
    <group position={[0, 0.4, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4, 0.2, 3]} />
        <meshStandardMaterial color="#8b6914" roughness={0.8} />
      </mesh>
      
      {[-1.8, -0.6, 0.6, 1.8].map((x, i) => (
        <mesh key={`leg-${i}`} position={[x, -0.45, 1.3]} castShadow>
          <boxGeometry args={[0.15, 0.9, 0.15]} />
          <meshStandardMaterial color="#6b4423" />
        </mesh>
      ))}
      
      {[-1.8, -0.6, 0.6, 1.8].map((x, i) => (
        <mesh key={`leg2-${i}`} position={[x, -0.45, -1.3]} castShadow>
          <boxGeometry args={[0.15, 0.9, 0.15]} />
          <meshStandardMaterial color="#6b4423" />
        </mesh>
      ))}
      
      <group position={[0, 0.11, 0]}>
        {Array.from({ length: 9 }).map((_, i) => (
          <mesh key={`line-v-${i}`} position={[-1.9 + i * 0.475, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.005, 0.002, 2.8]} />
            <meshStandardMaterial color="#5c4a1a" />
          </mesh>
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={`line-h-${i}`} position={[0, 0, -1.4 + i * 0.47]}>
            <boxGeometry args={[3.8, 0.002, 0.005]} />
            <meshStandardMaterial color="#5c4a1a" />
          </mesh>
        ))}
      </group>
      
      <mesh position={[1.5, 0.15, 0.8]} rotation={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.1, 0.2, 0.3]} />
        <meshStandardMaterial color="#4a3728" metalness={0.3} />
      </mesh>
      
      <mesh position={[-1.5, 0.15, -0.8]} rotation={[0, -0.2, 0]} castShadow>
        <boxGeometry args={[0.1, 0.2, 0.3]} />
        <meshStandardMaterial color="#4a3728" metalness={0.3} />
      </mesh>
    </group>
  )
}

function WoodBlock({ 
  material, 
  selectedTool,
  onProcessComplete 
}: { 
  material: WoodMaterial | null
  selectedTool: 'plane' | 'chisel' | null
  onProcessComplete: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [particles, setParticles] = useState<WoodParticle[]>([])
  const [planeCount, setPlaneCount] = useState(0)
  const [chiselCount, setChiselCount] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const particleIdRef = useRef(0)
  const lastParticleTime = useRef(0)
  
  const [chiselMarks, setChiselMarks] = useState<Array<[number, number, number]>>([])
  
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!selectedTool || !material) return
    e.stopPropagation()
    setIsDragging(true)
  }
  
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !selectedTool || !material) return
    e.stopPropagation()
    
    const now = Date.now()
    if (now - lastParticleTime.current > 50) {
      lastParticleTime.current = now
      
      if (selectedTool === 'plane') {
        const point = e.point
        const newParticle: WoodParticle = {
          id: particleIdRef.current++,
          position: point.clone(),
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            0.03 + Math.random() * 0.02,
            (Math.random() - 0.5) * 0.02
          ),
          rotation: new THREE.Euler(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          ),
          age: 0
        }
        setParticles(prev => [...prev.slice(-80), newParticle])
        setPlaneCount(prev => {
          const newCount = prev + 1
          if (newCount >= 20 && chiselCount >= 4) {
            setTimeout(onProcessComplete, 500)
          }
          return newCount
        })
      }
    }
  }
  
  const handlePointerUp = () => {
    setIsDragging(false)
  }
  
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (selectedTool !== 'chisel' || !material) return
    e.stopPropagation()
    
    const point = e.point
    const localPoint = meshRef.current?.worldToLocal(point.clone())
    if (localPoint) {
      setChiselMarks(prev => [...prev, [localPoint.x, localPoint.y, localPoint.z]])
      setChiselCount(prev => {
        const newCount = prev + 1
        if (planeCount >= 20 && newCount >= 4) {
          setTimeout(onProcessComplete, 500)
        }
        return newCount
      })
    }
  }
  
  useFrame((_, delta) => {
    setParticles(prev => 
      prev
        .map(p => ({
          ...p,
          position: p.position.clone().add(p.velocity),
          velocity: p.velocity.clone().add(new THREE.Vector3(0, -0.001, 0)),
          rotation: new THREE.Euler(
            p.rotation.x + 0.1,
            p.rotation.y + 0.15,
            p.rotation.z + 0.05
          ),
          age: p.age + delta
        }))
        .filter(p => p.age < 3 && p.position.y > 0.5)
    )
  })
  
  if (!material) return null
  
  return (
    <group>
      <mesh
        ref={meshRef}
        position={[0, 1.2, 0]}
        castShadow
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onClick={handleClick}
      >
        <boxGeometry args={[2, 0.4, 1.2]} />
        <WoodTextureMaterial color={material.color} texture={material.texture} />
      </mesh>
      
      {chiselMarks.map((pos, i) => (
        <mesh key={i} position={[pos[0], pos[1] + 0.21, pos[2]]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.02, 6]} />
          <meshStandardMaterial color="#2a1008" />
        </mesh>
      ))}
      
      {selectedTool === 'chisel' && material && (
        <group position={[0, 1.41, 0]}>
          {[[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].map(([x, z], i) => (
            <mesh key={`mark-${i}`} position={[x, 0, z]} rotation={[0, 0, Math.PI / 4]}>
              <boxGeometry args={[0.15, 0.005, 0.15]} />
              <meshBasicMaterial color="#ff6600" transparent opacity={0.6} />
            </mesh>
          ))}
        </group>
      )}
      
      {particles.map(p => (
        <mesh key={p.id} position={p.position.toArray()} rotation={p.rotation.toArray()}>
          <torusGeometry args={[0.04, 0.01, 4, 8]} />
          <meshStandardMaterial color="#f5e6d0" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

function ChairComponent({ 
  component, 
  onHover 
}: { 
  component: FurnitureComponent
  onHover: (c: FurnitureComponent | null) => void
}) {
  const meshRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  
  useFrame(() => {
    if (meshRef.current && component.assembled) {
      meshRef.current.position.lerp(
        new THREE.Vector3(...component.targetPosition),
        0.1
      )
    }
  })
  
  const getGeometry = () => {
    switch (component.type) {
      case 'seat':
        return <boxGeometry args={[1.8, 0.15, 0.8]} />
      case 'armrest':
        return (
          <group>
            <mesh position={[0, 0.15, 0]}>
              <boxGeometry args={[0.1, 0.3, 0.8]} />
            </mesh>
            <mesh position={[0, 0.3, 0]}>
              <boxGeometry args={[0.1, 0.1, 0.9]} />
            </mesh>
            <mesh position={[0, -0.05, 0.3]}>
              <cylinderGeometry args={[0.04, 0.04, 0.15, 8]} />
            </mesh>
            <mesh position={[0, -0.05, -0.3]}>
              <cylinderGeometry args={[0.04, 0.04, 0.15, 8]} />
            </mesh>
          </group>
        )
      case 'backrest':
        return (
          <group>
            <mesh position={[0, 0.4, 0]} rotation={[0.2, 0, 0]}>
              <boxGeometry args={[1.5, 0.8, 0.08]} />
            </mesh>
            <mesh position={[-0.6, -0.1, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
            </mesh>
            <mesh position={[0.6, -0.1, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
            </mesh>
          </group>
        )
      case 'footrest':
        return (
          <group>
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[0.8, 0.08, 0.3]} />
            </mesh>
            <mesh position={[-0.3, -0.1, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
            </mesh>
            <mesh position={[0.3, -0.1, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
            </mesh>
          </group>
        )
    }
  }
  
  if (!component.assembled) return null
  
  return (
    <group
      ref={meshRef}
      position={component.position}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        onHover(component)
        setAutoRotate(false)
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        setHovered(false)
        onHover(null)
        if (isAutoRotate()) setAutoRotate(true)
      }}
    >
      <group>
        {component.type === 'seat' ? (
          <mesh castShadow>
            <boxGeometry args={[1.8, 0.15, 0.8]} />
            <meshStandardMaterial 
              color={hovered ? '#7a3a20' : component.color} 
              roughness={0.6}
            />
          </mesh>
        ) : (
          getGeometry()
        )}
        
        {component.type !== 'seat' && component.type !== 'armrest' && (
          <meshStandardMaterial 
            color={hovered ? '#7a3a20' : component.color}
            roughness={0.6}
          />
        )}
        
        {component.type === 'armrest' && (
          <meshStandardMaterial 
            color={hovered ? '#7a3a20' : component.color}
            roughness={0.6}
          />
        )}
      </group>
      
      {hovered && (
        <Float speed={2} rotationIntensity={0} floatIntensity={0.3}>
          <mesh position={[0, 1.5, 0]}>
            <planeGeometry args={[1.2, 0.4]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.7} />
          </mesh>
        </Float>
      )}
    </group>
  )
}

function HaloEffect() {
  const meshRef = useRef<THREE.Mesh>(null)
  const [visible, setVisible] = useState(shouldShowHalo())
  
  useEffect(() => {
    const checkHalo = () => {
      const show = shouldShowHalo()
      setVisible(show)
      if (show && meshRef.current) {
        gsap.fromTo(meshRef.current.scale,
          { x: 0.1, y: 0.1, z: 0.1 },
          { x: 2, y: 2, z: 2, duration: 1.5, ease: 'power2.out' }
        )
        gsap.fromTo(meshRef.current.material,
          { opacity: 0.8 },
          { opacity: 0, duration: 1.5, ease: 'power2.out' }
        )
      }
    }
    
    const interval = setInterval(checkHalo, 100)
    return () => clearInterval(interval)
  }, [])
  
  if (!visible) return null
  
  return (
    <mesh ref={meshRef} position={[0, 1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.8, 2, 32]} />
      <meshBasicMaterial color="#FFD700" transparent opacity={0.8} side={THREE.DoubleSide} />
    </mesh>
  )
}

function SceneContent({ 
  selectedMaterial, 
  selectedTool, 
  components,
  onProcessingComplete,
  onComponentHover
}: SceneProps) {
  const controlsRef = useRef<any>(null)
  
  useEffect(() => {
    const checkAutoRotate = () => {
      if (controlsRef.current) {
        controlsRef.current.autoRotate = isAutoRotate()
        controlsRef.current.autoRotateSpeed = 6
      }
    }
    
    const interval = setInterval(checkAutoRotate, 100)
    return () => clearInterval(interval)
  }, [])
  
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight 
        position={[5, 8, 5]} 
        intensity={1.2} 
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[0, 4, 0]} intensity={0.5} color="#ffeedd" />
      
      <WorkshopRoom />
      <HangingTools />
      <Workbench />
      
      <WoodBlock 
        material={selectedMaterial}
        selectedTool={selectedTool}
        onProcessComplete={onProcessingComplete}
      />
      
      {components.map(comp => (
        <ChairComponent
          key={comp.id}
          component={comp}
          onHover={onComponentHover}
        />
      ))}
      
      <HaloEffect />
      
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={4}
        maxDistance={15}
        minPolarAngle={Math.PI / 12}
        maxPolarAngle={7 * Math.PI / 18}
        enableDamping
        dampingFactor={0.05}
      />
      
      <EffectComposer>
        <Bloom 
          luminanceThreshold={0.2} 
          luminanceSmoothing={0.9} 
          intensity={0.3} 
        />
      </EffectComposer>
    </>
  )
}

export default function Scene(props: SceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [8, 6, 8], fov: 50 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <SceneContent {...props} />
    </Canvas>
  )
}
