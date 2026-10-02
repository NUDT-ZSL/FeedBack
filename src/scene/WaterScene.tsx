import { useMemo, useRef, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import Duct from '../model/Duct'
import Cup from '../model/Cup'
import Rockery from '../model/Rockery'
import WaterParticles from '../model/WaterParticles'
import { generateDuctPoints, createDuctCurve, CUP_COLORS } from '../utils/curveUtils'
import { useWaterStore, getWaterDepth } from '../store/waterStore'

interface SceneContentProps {
  onFinish: (cupId: number) => void
  poemTexts: { id: number; x: number; y: number; z: number }[]
}

function SceneContent({ onFinish, poemTexts }: SceneContentProps) {
  const { gateOpening, slope, curvature, incrementCollision } = useWaterStore()
  const lightRef = useRef<THREE.PointLight>(null)
  const flashTimerRef = useRef<number | null>(null)

  const { curve, totalLength } = useMemo(() => {
    const points = generateDuctPoints(slope, curvature, 50)
    const curve = createDuctCurve(points)
    const totalLength = curve.getLength()
    return { curve, totalLength }
  }, [slope, curvature])

  const waterDepth = useMemo(() => getWaterDepth(gateOpening), [gateOpening])

  const [cupDistances, setCupDistances] = useState<{ [key: number]: number }>(
    Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [i, i * 0.3])
    )
  )

  const handleCollision = useCallback(() => {
    incrementCollision()

    if (lightRef.current) {
      lightRef.current.intensity = 2

      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current)
      }

      const startTime = Date.now()
      const animateFlash = () => {
        if (lightRef.current) {
          const elapsed = Date.now() - startTime
          const progress = Math.min(elapsed / 300, 1)
          lightRef.current.intensity = 2 - progress * 1.5

          if (progress < 1) {
            flashTimerRef.current = requestAnimationFrame(animateFlash)
          }
        }
      }

      flashTimerRef.current = requestAnimationFrame(animateFlash)
    }
  }, [incrementCollision])

  const handleFinish = useCallback((id: number) => {
    setCupDistances(prev => ({ ...prev, [id]: 0 }))
    onFinish(id)
  }, [onFinish])

  const cupColors = useMemo(() => {
    const colors: string[] = []
    for (let i = 0; i < 6; i++) {
      colors.push(CUP_COLORS[i % 3])
    }
    return colors.sort(() => Math.random() - 0.5)
  }, [])

  const allCups = useMemo(() => {
    return Object.entries(cupDistances).map(([id, distance]) => ({
      id: parseInt(id),
      distance,
      setDistance: (d: number) => setCupDistances(prev => ({ ...prev, [id]: d }))
    }))
  }, [cupDistances])

  return (
    <>
      <hemisphereLight args={['#ffffff', '#8fbc8f', 0.6]} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight
        ref={lightRef}
        position={[0, 2, 0]}
        intensity={0.5}
        distance={10}
        color="#ffd700"
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#8fbc8f" roughness={1} />
      </mesh>

      <Duct slope={slope} curvature={curvature} waterDepth={waterDepth} />

      <WaterParticles
        curve={curve}
        totalLength={totalLength}
        gateOpening={gateOpening}
        slope={slope}
        curvature={curvature}
      />

      <Rockery />

      {cupColors.map((color, index) => (
        <Cup
          key={index}
          id={index}
          color={color}
          curve={curve}
          totalLength={totalLength}
          gateOpening={gateOpening}
          slope={slope}
          curvature={curvature}
          allCups={allCups}
          onCollision={handleCollision}
          onFinish={() => handleFinish(index)}
          distance={cupDistances[index]}
          setDistance={(d) => setCupDistances(prev => ({ ...prev, [index]: d }))}
        />
      ))}

      {poemTexts.map(text => (
        <Html
          key={text.id}
          position={[text.x, text.y + 1, text.z]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="poem-text"
            style={{
              color: '#ffd700',
              fontSize: '24px',
              fontWeight: 'bold',
              textShadow: '0 0 10px rgba(255, 215, 0, 0.8)',
              fontFamily: 'Georgia, serif',
              whiteSpace: 'nowrap'
            }}
          >
            已赋诗
          </div>
        </Html>
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  )
}

interface WaterSceneProps {
  poemTexts: { id: number; x: number; y: number; z: number }[]
  onPoemText: (x: number, y: number, z: number) => void
}

export default function WaterScene({ poemTexts, onPoemText }: WaterSceneProps) {
  const handleFinish = useCallback((_cupId: number) => {
    const points = generateDuctPoints(
      useWaterStore.getState().slope,
      useWaterStore.getState().curvature,
      50
    )
    const curve = createDuctCurve(points)
    const endPoint = curve.getPointAt(1)
    onPoemText(endPoint.x, endPoint.y, endPoint.z)
  }, [onPoemText])

  return (
    <Canvas
      camera={{ position: [0, 5, 10], fov: 50 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#e6f0e6' }}
      dpr={[1, 2]}
    >
      <fog attach="fog" args={['#e6f0e6', 15, 30]} />
      <SceneContent onFinish={handleFinish} poemTexts={poemTexts} />
    </Canvas>
  )
}

export type { WaterSceneProps }
