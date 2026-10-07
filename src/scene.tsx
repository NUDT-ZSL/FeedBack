import { useRef, useMemo, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useStore, GlazeStroke } from './store'
import { calculateTemperatureCurve, calculateCoolingCurve, generateTextureData, getFireColor } from './kilnSimulation'
import { hexToRgb, getGlazeColorWithThickness } from './glazeInteraction'

const ROOM_WIDTH = 10
const ROOM_DEPTH = 8
const ROOM_HEIGHT = 5

const createPotGeometry = () => {
  const points: THREE.Vector2[] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    let x: number
    const y = t * 2.5
    
    if (t < 0.15) {
      x = 0.15 + t * 0.5
    } else if (t < 0.3) {
      x = 0.225 - (t - 0.15) * 0.5
    } else if (t < 0.75) {
      const bellyT = (t - 0.3) / 0.45
      x = 0.15 + Math.sin(bellyT * Math.PI) * 0.6
    } else {
      x = 0.75 - (t - 0.75) * 2
    }
    
    points.push(new THREE.Vector2(x, y))
  }
  
  const geometry = new THREE.LatheGeometry(points, 64)
  geometry.computeVertexNormals()
  return geometry
}

const Room = () => {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.9} />
      </mesh>
      <mesh position={[0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, ROOM_HEIGHT]} />
        <meshStandardMaterial color="#f5f0e8" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[ROOM_DEPTH, ROOM_HEIGHT]} />
        <meshStandardMaterial color="#f5f0e8" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[ROOM_DEPTH, ROOM_HEIGHT]} />
        <meshStandardMaterial color="#f5f0e8" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, ROOM_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_WIDTH, ROOM_DEPTH]} />
        <meshStandardMaterial color="#e8e0d0" side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

const WorkTable = () => {
  return (
    <group position={[0, 0.4, 0]}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[3, 0.8, 2]} />
        <meshStandardMaterial color="#6b4c3b" roughness={0.7} />
      </mesh>
      <mesh position={[-1.3, 0, 0.8]} castShadow>
        <boxGeometry args={[0.15, 0.8, 0.15]} />
        <meshStandardMaterial color="#5a3c2b" />
      </mesh>
      <mesh position={[1.3, 0, 0.8]} castShadow>
        <boxGeometry args={[0.15, 0.8, 0.15]} />
        <meshStandardMaterial color="#5a3c2b" />
      </mesh>
      <mesh position={[-1.3, 0, -0.8]} castShadow>
        <boxGeometry args={[0.15, 0.8, 0.15]} />
        <meshStandardMaterial color="#5a3c2b" />
      </mesh>
      <mesh position={[1.3, 0, -0.8]} castShadow>
        <boxGeometry args={[0.15, 0.8, 0.15]} />
        <meshStandardMaterial color="#5a3c2b" />
      </mesh>
    </group>
  )
}

const GlazeShelf = () => {
  const glazes = useStore(state => state.glazes)
  const selectedGlaze = useStore(state => state.selectedGlaze)
  const selectGlaze = useStore(state => state.selectGlaze)
  const setIsDraggingGlaze = useStore(state => state.setIsDraggingGlaze)
  const setGlazeThickness = useStore(state => state.setGlazeThickness)
  const glazeThickness = useStore(state => state.glazeThickness)
  
  return (
    <group position={[-3.5, 1.5, 0]}>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.6, 3, 1.5]} />
        <meshStandardMaterial color="#8b7355" roughness={0.8} />
      </mesh>
      {glazes.map((glaze, index) => (
        <group
          key={glaze.id}
          position={[0, 1 - index * 0.55, 0]}
          onPointerDown={(e) => {
            e.stopPropagation()
            selectGlaze(glaze.id)
            setIsDraggingGlaze(true)
          }}
        >
          <mesh
            castShadow
            onClick={(e) => {
              e.stopPropagation()
              selectGlaze(glaze.id)
            }}
          >
            <cylinderGeometry args={[0.18, 0.15, 0.35, 16]} />
            <meshStandardMaterial 
              color="#5c3a21" 
              roughness={0.6}
              emissive={selectedGlaze === glaze.id ? glaze.color : '#000000'}
              emissiveIntensity={selectedGlaze === glaze.id ? 0.3 : 0}
            />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <torusGeometry args={[0.18, 0.02, 8, 16]} />
            <meshStandardMaterial color="#3d2815" />
          </mesh>
          <mesh position={[0, 0.18, 0]}>
            <circleGeometry args={[0.16, 16]} />
            <meshStandardMaterial color={glaze.color} />
          </mesh>
        </group>
      ))}
      <mesh position={[0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 2.8, 8]} />
        <meshStandardMaterial color="#6b5a45" />
      </mesh>
      <mesh position={[0.5, -1.4, 0]}>
        <boxGeometry args={[0.08, 0.1, 0.08]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
      <mesh position={[0.5, 1.4, 0]}>
        <boxGeometry args={[0.08, 0.1, 0.08]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
    </group>
  )
}

interface PotProps {
  onPointerDown?: (e: any) => void
  onPointerMove?: (e: any) => void
  onPointerUp?: (e: any) => void
}

const Pot = ({ onPointerDown, onPointerMove, onPointerUp }: PotProps) => {
  const potRef = useRef<THREE.Mesh>(null)
  const outlineRef = useRef<THREE.Mesh>(null)
  const glazeOverlayRef = useRef<THREE.Mesh>(null)
  
  const pot = useStore(state => state.pot)
  const glazeStrokes = useStore(state => state.glazeStrokes)
  const glazes = useStore(state => state.glazes)
  const isDraggingGlaze = useStore(state => state.isDraggingGlaze)
  const selectedGlaze = useStore(state => state.selectedGlaze)
  const glazeThickness = useStore(state => state.glazeThickness)
  
  const geometry = useMemo(() => createPotGeometry(), [])
  
  const glazeTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')!
    
    ctx.fillStyle = '#e8e0d0'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    if (pot.hasGlaze || glazeStrokes.length > 0) {
      const usedGlazes = new Map<string, { count: number; thickness: number }>()
      
      glazeStrokes.forEach(stroke => {
        const existing = usedGlazes.get(stroke.glazeId) || { count: 0, thickness: 0 }
        usedGlazes.set(stroke.glazeId, {
          count: existing.count + 1,
          thickness: Math.max(existing.thickness, stroke.thickness),
        })
      })
      
      if (usedGlazes.size > 0) {
        const entries = Array.from(usedGlazes.entries())
        const mainGlaze = glazes.find(g => g.id === entries[0][0])
        if (mainGlaze) {
          const baseColor = getGlazeColorWithThickness(mainGlaze.color, entries[0][1].thickness)
          ctx.fillStyle = baseColor
          ctx.fillRect(0, 150, canvas.width, canvas.height - 300)
        }
        
        entries.forEach(([glazeId, data]) => {
          const glaze = glazes.find(g => g.id === glazeId)
          if (!glaze) return
          
          const stroke = glazeStrokes.find(s => s.glazeId === glazeId)
          if (!stroke) return
          
          const color = getGlazeColorWithThickness(glaze.color, data.thickness)
          
          stroke.uvCoords.forEach((uv, i) => {
            const x = uv[0] * canvas.width
            const y = uv[1] * canvas.height
            const radius = 15 + data.thickness * 30
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
            gradient.addColorStop(0, color + 'cc')
            gradient.addColorStop(0.5, color + '88')
            gradient.addColorStop(1, color + '00')
            
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx.fill()
          })
        })
      }
    }
    
    if (pot.hasFired) {
      const { textureData } = pot
      
      textureData.spots.forEach(spot => {
        const x = spot.x * canvas.width
        const y = spot.y * canvas.height
        const radius = spot.size * canvas.width
        
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
        
        if (textureData.type === 'rabbit') {
          gradient.addColorStop(0, spot.color + 'ff')
          gradient.addColorStop(0.3, spot.color + 'aa')
          gradient.addColorStop(1, spot.color + '00')
          
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(Math.random() * Math.PI)
          ctx.scale(1, 0.3)
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.ellipse(0, 0, radius, radius, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        } else if (textureData.type === 'oil') {
          gradient.addColorStop(0, spot.color + 'dd')
          gradient.addColorStop(0.6, spot.color + '88')
          gradient.addColorStop(1, spot.color + '00')
          
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
          
          ctx.strokeStyle = '#ffffff44'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2)
          ctx.stroke()
        } else if (textureData.type === 'yohen') {
          gradient.addColorStop(0, spot.color + 'ff')
          gradient.addColorStop(0.2, adjustColorBrightness(spot.color, 30) + 'ee')
          gradient.addColorStop(0.5, spot.color + '88')
          gradient.addColorStop(1, spot.color + '00')
          
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
          
          const rainbowGradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 1.5)
          rainbowGradient.addColorStop(0, 'rgba(255,0,0,0)')
          rainbowGradient.addColorStop(0.3, 'rgba(255,100,100,0.1)')
          rainbowGradient.addColorStop(0.5, 'rgba(100,255,100,0.1)')
          rainbowGradient.addColorStop(0.7, 'rgba(100,100,255,0.1)')
          rainbowGradient.addColorStop(1, 'rgba(255,0,0,0)')
          ctx.fillStyle = rainbowGradient
          ctx.beginPath()
          ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2)
          ctx.fill()
        }
      })
      
      if (pot.currentTemp < 300) {
        ctx.strokeStyle = '#00000022'
        ctx.lineWidth = 0.5
        for (let i = 0; i < 50; i++) {
          const startX = Math.random() * canvas.width
          const startY = 150 + Math.random() * (canvas.height - 300)
          ctx.beginPath()
          ctx.moveTo(startX, startY)
          let x = startX
          let y = startY
          for (let j = 0; j < 10; j++) {
            x += (Math.random() - 0.5) * 30
            y += Math.random() * 15
            ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      }
    }
    
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [glazeStrokes, pot.hasFired, pot.textureData, pot.currentTemp, glazes])
  
  useFrame((state) => {
    if (potRef.current && pot.position === 'table') {
      potRef.current.rotation.y += 0.001
    }
    if (outlineRef.current && potRef.current) {
      outlineRef.current.rotation.y = potRef.current.rotation.y
    }
    if (glazeOverlayRef.current && potRef.current) {
      glazeOverlayRef.current.rotation.y = potRef.current.rotation.y
    }
  })
  
  const getPotPosition = (): [number, number, number] => {
    switch (pot.position) {
      case 'table': return [0, 0.8, 0]
      case 'kiln': return [3.5, 1.2, 0]
      case 'display': return [2, 1.1, 2]
      default: return [0, 0.8, 0]
    }
  }
  
  return (
    <group position={getPotPosition()}>
      <mesh
        ref={potRef}
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <meshStandardMaterial
          map={pot.hasGlaze || pot.hasFired ? glazeTexture : null}
          color={pot.hasGlaze || pot.hasFired ? '#ffffff' : '#e8e0d0'}
          roughness={pot.hasFired ? 0.2 : pot.hasGlaze ? 0.4 : 0.9}
          metalness={pot.hasFired ? 0.1 : 0}
          transparent={false}
        />
      </mesh>
      
      {!pot.hasGlaze && !pot.hasFired && (
        <mesh ref={outlineRef} geometry={geometry} position={[0, 0, -0.01]}>
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
            wireframe
          />
        </mesh>
      )}
      
      {isDraggingGlaze && selectedGlaze && (
        <mesh ref={glazeOverlayRef} geometry={geometry}>
          <meshBasicMaterial
            color={glazes.find(g => g.id === selectedGlaze)?.color || '#ffffff'}
            transparent
            opacity={0.3 + glazeThickness * 0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      
      {pot.currentTemp > 100 && (
        <sprite position={[0, 2.8, 0]} scale={[0.5, 0.2, 1]}>
          <spriteMaterial color="#ffffff" />
        </sprite>
      )}
    </group>
  )
}

const adjustColorBrightness = (hex: string, percent: number): string => {
  const num = parseInt(hex.replace('#', ''), 16)
  const amt = Math.round(2.55 * percent)
  const R = Math.min(255, Math.max(0, (num >> 16) + amt))
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt))
  const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt))
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`
}

const Kiln = () => {
  const groupRef = useRef<THREE.Group>(null)
  const doorRef = useRef<THREE.Group>(null)
  const fireParticlesRef = useRef<THREE.Points>(null)
  
  const kilnTargetTemp = useStore(state => state.kilnTargetTemp)
  const firingStage = useStore(state => state.firingStage)
  const kilnDoorOpen = useStore(state => state.kilnDoorOpen)
  const setKilnDoorOpen = useStore(state => state.setKilnDoorOpen)
  const setPotTemp = useStore(state => state.setPotTemp)
  const addTempPoint = useStore(state => state.addTempPoint)
  const setTextureData = useStore(state => state.setTextureData)
  const markFired = useStore(state => state.markFired)
  const glazeStrokes = useStore(state => state.glazeStrokes)
  const glazes = useStore(state => state.glazes)
  const pot = useStore(state => state.pot)
  
  const [firingTime, setFiringTime] = useState(0)
  const [coolingTime, setCoolingTime] = useState(0)
  const [peakTemp, setPeakTemp] = useState(25)
  
  const particleCount = 200
  const firePositions = useMemo(() => new Float32Array(particleCount * 3), [])
  const fireColors = useMemo(() => new Float32Array(particleCount * 3), [])
  const fireSizes = useMemo(() => new Float32Array(particleCount), [])
  
  useEffect(() => {
    for (let i = 0; i < particleCount; i++) {
      firePositions[i * 3] = (Math.random() - 0.5) * 0.8
      firePositions[i * 3 + 1] = Math.random() * 1.5
      firePositions[i * 3 + 2] = (Math.random() - 0.5) * 0.8
      fireSizes[i] = Math.random() * 2 + 1
    }
  }, [firePositions, fireSizes])
  
  useFrame((state, delta) => {
    if (firingStage === 'heating') {
      const newTime = firingTime + delta
      setFiringTime(newTime)
      
      const currentTemp = calculateTemperatureCurve(newTime, kilnTargetTemp, 10)
      setPotTemp(currentTemp)
      setPeakTemp(Math.max(peakTemp, currentTemp))
      addTempPoint({ time: newTime, temp: currentTemp })
      
      const usedGlazeColors = [...new Set(glazeStrokes.map(s => s.glazeId))]
        .map(id => glazes.find(g => g.id === id)?.color || '#ffffff')
      
      const textureData = generateTextureData(
        currentTemp,
        kilnTargetTemp,
        usedGlazeColors.length > 0 ? usedGlazeColors : ['#b56e7d'],
        newTime
      )
      setTextureData(textureData)
      
      if (newTime >= 10) {
        useStore.getState().stopFiring()
        setCoolingTime(0)
      }
    }
    
    if (firingStage === 'cooling') {
      const newTime = coolingTime + delta
      setCoolingTime(newTime)
      
      const currentTemp = calculateCoolingCurve(newTime, peakTemp, 8)
      setPotTemp(currentTemp)
      addTempPoint({ time: firingTime + newTime, temp: currentTemp })
      
      if (currentTemp <= 200) {
        useStore.setState({ firingStage: 'finished' })
        setKilnDoorOpen(true)
        markFired()
      }
    }
    
    if (fireParticlesRef.current && firingStage !== 'idle') {
      const positions = fireParticlesRef.current.geometry.attributes.position.array as Float32Array
      const colors = fireParticlesRef.current.geometry.attributes.color.array as Float32Array
      
      const fireColor = new THREE.Color(getFireColor(pot.currentTemp))
      
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3 + 1] += delta * (0.5 + Math.random() * 0.5)
        
        if (positions[i * 3 + 1] > 1.5) {
          positions[i * 3] = (Math.random() - 0.5) * 0.8
          positions[i * 3 + 1] = 0
          positions[i * 3 + 2] = (Math.random() - 0.5) * 0.8
        }
        
        const intensity = 1 - positions[i * 3 + 1] / 1.5
        colors[i * 3] = fireColor.r * intensity
        colors[i * 3 + 1] = fireColor.g * intensity
        colors[i * 3 + 2] = fireColor.b * intensity
      }
      
      fireParticlesRef.current.geometry.attributes.position.needsUpdate = true
      fireParticlesRef.current.geometry.attributes.color.needsUpdate = true
    }
    
    if (doorRef.current) {
      const targetRotation = kilnDoorOpen ? -Math.PI * 0.7 : 0
      doorRef.current.rotation.y += (targetRotation - doorRef.current.rotation.y) * delta * 3
    }
  })
  
  return (
    <group ref={groupRef} position={[3.5, 0, 0]}>
      <mesh position={[0, 1.25, 0]} castShadow>
        <sphereGeometry args={[1.2, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#b8a88a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[1.1, 1.2, 1, 32]} />
        <meshStandardMaterial color="#a8987a" roughness={0.9} />
      </mesh>
      
      <mesh position={[0, 0.8, 0.9]}>
        <boxGeometry args={[0.9, 1.4, 0.1]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
      
      <group ref={doorRef} position={[0, 0.8, 0.95]}>
        <mesh castShadow>
          <boxGeometry args={[0.85, 1.3, 0.08]} />
          <meshStandardMaterial color="#5c3a21" roughness={0.8} />
        </mesh>
        <mesh position={[0.35, 0, 0.05]}>
          <torusGeometry args={[0.06, 0.02, 8, 16]} />
          <meshStandardMaterial color="#3d2815" />
        </mesh>
      </group>
      
      {firingStage !== 'idle' && (
        <points ref={fireParticlesRef} position={[0, 0.3, 0]}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={particleCount}
              array={firePositions}
              itemSize={3}
            />
            <bufferAttribute
              attach="attributes-color"
              count={particleCount}
              array={fireColors}
              itemSize={3}
            />
            <bufferAttribute
              attach="attributes-size"
              count={particleCount}
              array={fireSizes}
              itemSize={1}
            />
          </bufferGeometry>
          <pointsMaterial
            size={0.1}
            vertexColors
            transparent
            opacity={0.8}
            blending={THREE.AdditiveBlending}
            sizeAttenuation
          />
        </points>
      )}
      
      <mesh position={[0.5, 2, 0.5]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.8, 12]} />
        <meshStandardMaterial color="#8b7355" />
      </mesh>
    </group>
  )
}

const DisplayStand = () => {
  return (
    <group position={[2, 0, 2]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.75, 0.75, 0.1, 32]} />
        <meshStandardMaterial color="#6b4c3b" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <circleGeometry args={[0.7, 32]} rotation={[-Math.PI / 2, 0, 0]} />
        <meshStandardMaterial color="#8b0000" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.5, 16]} />
        <meshStandardMaterial color="#5a3c2b" />
      </mesh>
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.1, 16]} />
        <meshStandardMaterial color="#6b4c3b" />
      </mesh>
    </group>
  )
}

const SceneContent = () => {
  const { camera } = useThree()
  const potMeshRef = useRef<THREE.Mesh>(null)
  const lastUVRef = useRef<[number, number] | null>(null)
  
  const setCamera = useStore(state => state.setCamera)
  const selectedGlaze = useStore(state => state.selectedGlaze)
  const glazeThickness = useStore(state => state.glazeThickness)
  const addGlazeStroke = useStore(state => state.addGlazeStroke)
  const setIsDraggingGlaze = useStore(state => state.setIsDraggingGlaze)
  const setDragPosition = useStore(state => state.setDragPosition)
  const isDraggingGlaze = useStore(state => state.isDraggingGlaze)
  const markGlazed = useStore(state => state.markGlazed)
  const glazeStrokes = useStore(state => state.glazeStrokes)
  const useTongs = useStore(state => state.useTongs)
  const setUseTongs = useStore(state => state.setUseTongs)
  const pot = useStore(state => state.pot)
  const setPotPosition = useStore(state => state.setPotPosition)
  const setFps = useStore(state => state.setFps)
  
  const frameCountRef = useRef(0)
  const lastFpsTimeRef = useRef(Date.now())
  
  useFrame(() => {
    frameCountRef.current++
    const now = Date.now()
    if (now - lastFpsTimeRef.current >= 1000) {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
      lastFpsTimeRef.current = now
    }
  })
  
  const handlePotPointerDown = useCallback((e: any) => {
    if (!selectedGlaze || !isDraggingGlaze || pot.hasGlaze || pot.hasFired) return
    e.stopPropagation()
    
    const uv = e.uv
    if (uv) {
      lastUVRef.current = [uv.x, uv.y]
    }
  }, [selectedGlaze, isDraggingGlaze, pot.hasGlaze, pot.hasFired])
  
  const handlePotPointerMove = useCallback((e: any) => {
    if (!selectedGlaze || !isDraggingGlaze || !lastUVRef.current) return
    e.stopPropagation()
    
    const uv = e.uv
    if (uv) {
      const currentUV: [number, number] = [uv.x, uv.y]
      const stroke = {
        glazeId: selectedGlaze,
        uvCoords: [lastUVRef.current, currentUV],
        thickness: glazeThickness,
      }
      addGlazeStroke(stroke)
      lastUVRef.current = currentUV
    }
    
    setDragPosition({ x: e.clientX, y: e.clientY })
  }, [selectedGlaze, isDraggingGlaze, glazeThickness, addGlazeStroke, setDragPosition])
  
  const handlePotPointerUp = useCallback(() => {
    if (isDraggingGlaze && glazeStrokes.length > 0) {
      markGlazed()
    }
    setIsDraggingGlaze(false)
    setDragPosition(null)
    lastUVRef.current = null
  }, [isDraggingGlaze, glazeStrokes.length, markGlazed, setIsDraggingGlaze, setDragPosition])
  
  const handleDisplayClick = useCallback(() => {
    if (useTongs && pot.position === 'kiln' && pot.hasFired) {
      setPotPosition('display')
      setUseTongs(false)
    }
  }, [useTongs, pot.position, pot.hasFired, setPotPosition, setUseTongs])
  
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[-3, 3, 0]} intensity={0.3} color="#ffeedd" />
      <pointLight position={[3.5, 2, 0]} intensity={pot.currentTemp > 500 ? 1.5 : 0.2} color={getFireColor(pot.currentTemp)} />
      
      <Room />
      <WorkTable />
      <GlazeShelf />
      <Kiln />
      <DisplayStand />
      
      <Pot
        onPointerDown={handlePotPointerDown}
        onPointerMove={handlePotPointerMove}
        onPointerUp={handlePotPointerUp}
      />
      
      <mesh
        position={[2, 0.6, 2]}
        onClick={handleDisplayClick}
        visible={useTongs && pot.position === 'kiln'}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#ffff00" transparent opacity={0.2} />
      </mesh>
      
      <OrbitControls
        enablePan={true}
        minDistance={3}
        maxDistance={12}
        minPolarAngle={Math.PI / 12}
        maxPolarAngle={Math.PI * 5 / 12}
        enableDamping
        dampingFactor={0.05}
        onChange={(e) => {
          const spherical = new THREE.Spherical()
          spherical.setFromVector3(camera.position)
          setCamera({
            azimuth: (spherical.theta * 180 / Math.PI + 360) % 360,
            elevation: 90 - spherical.phi * 180 / Math.PI,
            distance: spherical.radius,
          })
        }}
      />
    </>
  )
}

export const Scene = () => {
  const fps = useStore(state => state.fps)
  
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        shadows
        camera={{ position: [6, 4, 6], fov: 50 }}
        gl={{ antialias: true, pixelRatio: Math.min(window.devicePixelRatio, 2) }}
        onWheel={(e) => {
          const state = useStore.getState()
          if (state.isDraggingGlaze) {
            e.stopPropagation()
            const delta = e.deltaY > 0 ? -0.05 : 0.05
            state.setGlazeThickness(state.glazeThickness + delta)
          }
        }}
      >
        <SceneContent />
      </Canvas>
      <div style={{
        position: 'absolute',
        bottom: 10,
        left: 10,
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '4px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'monospace',
      }}>
        FPS: {fps}
      </div>
    </div>
  )
}
