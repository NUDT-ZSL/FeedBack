import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import * as TWEEN from '@tweenjs/tween.js'
import { useSundialStore, SHICHEN, SEASONS } from '../store/store'
import {
  DIAL_RADIUS,
  DIAL_HEIGHT,
  GNOMON_LENGTH,
  TABLE_HEIGHT,
  computeGnomonShadow,
  computeTableShadow,
} from '../lib/sundialMath'

function ObservatoryBase() {
  return (
    <group position={[0, -0.5, 0]}>
      <mesh position={[0, 0.25, 0]} receiveShadow>
        <boxGeometry args={[8, 0.5, 8]} />
        <meshStandardMaterial color="#7a8a7a" roughness={0.8} metalness={0.1} />
      </mesh>
      {[-3.5, 3.5].map((x) =>
        [-3.5, 3.5].map((z) => (
          <mesh key={`pillar-${x}-${z}`} position={[x, 0.75, z]} castShadow receiveShadow>
            <boxGeometry args={[0.3, 1.5, 0.3]} />
            <meshStandardMaterial color="#6a7a6a" roughness={0.9} />
          </mesh>
        ))
      )}
      <mesh position={[0, 1, 0]} receiveShadow>
        <boxGeometry args={[7.5, 0.2, 7.5]} />
        <meshStandardMaterial color="#8a9a8a" roughness={0.7} />
      </mesh>
    </group>
  )
}

function SundialDial() {
  const gnomonRotation = useSundialStore((s) => s.gnomonRotation)
  const highlightedShichen = useSundialStore((s) => s.highlightedShichen)

  const gradientTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
    gradient.addColorStop(0, '#b87333')
    gradient.addColorStop(1, '#4a2e1b')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 512, 512)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }, [])

  // 晷面旋转直接绑定 store 姿态，不再经过组件内补间，保证与推演链路同步
  const rotationY = (gnomonRotation * Math.PI) / 180

  return (
    <group position={[0, DIAL_HEIGHT, 0]} rotation={[0, rotationY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[DIAL_RADIUS, 64]} />
        <meshStandardMaterial map={gradientTexture} roughness={0.5} metalness={0.3} />
      </mesh>
      {SHICHEN.map((mark, i) => {
        const angle = (mark.angle * Math.PI) / 180
        const innerRadius = DIAL_RADIUS * 0.3
        const outerRadius = DIAL_RADIUS * 0.95
        const x1 = Math.cos(angle) * innerRadius
        const z1 = Math.sin(angle) * innerRadius
        const x2 = Math.cos(angle) * outerRadius
        const z2 = Math.sin(angle) * outerRadius
        const highlighted = mark.name === highlightedShichen
        return (
          <group key={i}>
            <mesh position={[(x1 + x2) / 2, 0.001, (z1 + z2) / 2]} rotation={[-Math.PI / 2, 0, -angle]}>
              <planeGeometry args={[outerRadius - innerRadius, 0.03]} />
              <meshBasicMaterial
                color={highlighted ? '#ffe066' : '#d4a017'}
                transparent
                opacity={highlighted ? 1 : 0.9}
              />
            </mesh>
            <mesh position={[Math.cos(angle) * (outerRadius + 0.15), 0.002, Math.sin(angle) * (outerRadius + 0.15)]}>
              <planeGeometry args={[0.25, 0.15]} />
              <meshBasicMaterial
                color={highlighted ? '#ffe066' : '#d4a017'}
                transparent
                opacity={highlighted ? 0.95 : 0.1}
              />
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[DIAL_RADIUS * 0.25, DIAL_RADIUS * 0.27, 64]} />
        <meshBasicMaterial color="#d4a017" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[DIAL_RADIUS * 0.95, DIAL_RADIUS * 0.98, 64]} />
        <meshBasicMaterial color="#d4a017" transparent opacity={0.6} />
      </mesh>
    </group>
  )
}

function Gnomon() {
  const gnomonElevation = useSundialStore((s) => s.gnomonElevation)
  // 倾角直接绑定 store 姿态，与影长推演使用同一数值
  const tilt = ((90 - gnomonElevation) * Math.PI) / 180

  return (
    <group position={[0, DIAL_HEIGHT, 0]}>
      <group rotation={[0, 0, tilt]}>
        <mesh position={[0, GNOMON_LENGTH / 2, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.05, GNOMON_LENGTH, 8]} />
          <meshStandardMaterial color="#5d6e5d" roughness={0.6} metalness={0.4} />
        </mesh>
        <mesh position={[0, GNOMON_LENGTH + 0.05, 0]} castShadow>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#6d7e6d" roughness={0.5} metalness={0.5} />
        </mesh>
      </group>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.1, 16]} />
        <meshStandardMaterial color="#4a2e1b" roughness={0.7} metalness={0.3} />
      </mesh>
    </group>
  )
}

function GnomonShadow() {
  const shadowRef = useRef<THREE.Mesh>(null)
  const shadowTipRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    // 只读取 store 状态做可视化，不再向 store 回写；几何与面板共用同一推演函数
    const { gnomonElevation, gnomonRotation, currentSeason, shadowBeyondDial } =
      useSundialStore.getState()
    const shadow = computeGnomonShadow(gnomonElevation, gnomonRotation, currentSeason)

    const start = new THREE.Vector3(...shadow.worldStart)
    const end = new THREE.Vector3(...shadow.worldEnd)

    if (shadowRef.current) {
      const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      shadowRef.current.position.copy(midPoint)
      shadowRef.current.lookAt(end)
      shadowRef.current.rotateX(Math.PI / 2)
      shadowRef.current.scale.set(1, Math.max(shadow.length, 1e-4), 1)
    }

    if (shadowTipRef.current) {
      shadowTipRef.current.position.copy(end)
      const material = shadowTipRef.current.material as THREE.MeshBasicMaterial
      material.color.set(shadowBeyondDial ? '#ff6b4a' : '#d4a017')
    }
  })

  return (
    <group>
      <mesh ref={shadowRef} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.08, 1]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.4} />
      </mesh>
      <mesh ref={shadowTipRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.06, 16]} />
        <meshBasicMaterial color="#d4a017" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

function ShadowTable() {
  const shadowRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    const { currentSeason } = useSundialStore.getState()
    const shadow = computeTableShadow(currentSeason)

    if (shadowRef.current) {
      const start = new THREE.Vector3(...shadow.localStart)
      const end = new THREE.Vector3(...shadow.localEnd)
      const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      shadowRef.current.position.copy(midPoint)
      shadowRef.current.lookAt(end)
      shadowRef.current.rotateX(Math.PI / 2)
      shadowRef.current.scale.set(1, Math.max(shadow.length, 1e-4), 1)
    }
  })

  return (
    <group position={[4, 0, 0]}>
      <mesh position={[0, TABLE_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, TABLE_HEIGHT, 8]} />
        <meshStandardMaterial color="#7a8a7a" roughness={0.9} />
      </mesh>
      <mesh position={[0, TABLE_HEIGHT + 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.1, 16]} />
        <meshStandardMaterial color="#8a9a8a" roughness={0.8} />
      </mesh>
      <mesh ref={shadowRef} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.2, 1]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} />
      </mesh>
    </group>
  )
}

function Ground() {
  return (
    <mesh position={[0, -0.76, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#5a6a5a" roughness={1} />
    </mesh>
  )
}

function DynamicSky() {
  const currentSeason = useSundialStore((s) => s.currentSeason)
  const { scene } = useThree()
  const currentColor = useRef(new THREE.Color(0x66ccff))
  const targetColor = useRef(new THREE.Color(0x66ccff))

  useEffect(() => {
    const season = SEASONS[currentSeason]
    const sunHeight = season.sunHeight

    let color: THREE.Color
    if (sunHeight < 25) {
      color = new THREE.Color('#ff9966')
    } else if (sunHeight < 50) {
      color = new THREE.Color('#66ccff')
    } else {
      color = new THREE.Color('#ff6600')
    }

    targetColor.current = color

    new TWEEN.Tween({ t: 0 })
      .to({ t: 1 }, 500)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate((obj) => {
        currentColor.current.lerpColors(
          new THREE.Color(scene.background as THREE.Color),
          targetColor.current,
          obj.t
        )
        scene.background = currentColor.current.clone()
      })
      .start()
  }, [currentSeason, scene])

  useEffect(() => {
    scene.background = new THREE.Color('#66ccff')
  }, [scene])

  return null
}

function Lighting() {
  const currentSeason = useSundialStore((s) => s.currentSeason)
  const directionalLightRef = useRef<THREE.DirectionalLight>(null)

  useFrame(() => {
    if (directionalLightRef.current) {
      const season = SEASONS[currentSeason]
      const sunHeightRad = (season.sunHeight * Math.PI) / 180
      const sunAngleRad = (season.sunAngle * Math.PI) / 180

      const distance = 20
      directionalLightRef.current.position.set(
        Math.cos(sunAngleRad) * Math.cos(sunHeightRad) * distance,
        Math.sin(sunHeightRad) * distance,
        Math.sin(sunAngleRad) * Math.cos(sunHeightRad) * distance
      )

      const intensity = 0.5 + (season.sunHeight / 90) * 1.5
      directionalLightRef.current.intensity = intensity
    }
  })

  return (
    <>
      <ambientLight intensity={0.4} color="#fff8e7" />
      <directionalLight
        ref={directionalLightRef}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0001}
      />
    </>
  )
}

function AnimationFrame() {
  useFrame(() => {
    TWEEN.update()
  })
  return null
}

export default function SundialScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [8, 6, 8], fov: 50 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
    >
      <DynamicSky />
      <Lighting />
      <Ground />
      <ObservatoryBase />
      <SundialDial />
      <Gnomon />
      <GnomonShadow />
      <ShadowTable />
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={25}
        maxPolarAngle={Math.PI / 2.1}
        target={[0, 1.5, 0]}
      />
      <AnimationFrame />
    </Canvas>
  )
}
