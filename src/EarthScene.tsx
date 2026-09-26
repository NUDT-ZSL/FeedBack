import { useRef, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { eventBus, type CityData, type ColorMode, type DisplayMode } from './EventBus'
import { dataManager } from './DataManager'

const EARTH_RADIUS = 5

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

function lerpColor(color1: THREE.Color, color2: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().lerpColors(color1, color2, t)
}

function getAqiColor(value: number): THREE.Color {
  const t = Math.max(0, Math.min(1, value / 500))
  const colors = [
    { pos: 0, color: new THREE.Color('#00E676') },
    { pos: 0.33, color: new THREE.Color('#FFEB3B') },
    { pos: 0.66, color: new THREE.Color('#FF9800') },
    { pos: 1, color: new THREE.Color('#FF1744') },
  ]
  for (let i = 0; i < colors.length - 1; i++) {
    if (t >= colors[i].pos && t <= colors[i + 1].pos) {
      const localT = (t - colors[i].pos) / (colors[i + 1].pos - colors[i].pos)
      return lerpColor(colors[i].color, colors[i + 1].color, localT)
    }
  }
  return colors[colors.length - 1].color
}

function getTemperatureColor(value: number): THREE.Color {
  const t = Math.max(0, Math.min(1, (value + 20) / 60))
  return lerpColor(new THREE.Color('#00BCD4'), new THREE.Color('#FF9800'), t)
}

function getWindSpeedColor(value: number): THREE.Color {
  const t = Math.max(0, Math.min(1, value / 15))
  return lerpColor(new THREE.Color('#ECEFF1'), new THREE.Color('#37474F'), t)
}

interface DataPointProps {
  city: CityData
  monthIndex: number
  colorMode: ColorMode
  aqiFilter: [number, number]
  isSelected: boolean
  isHovered: boolean
}

function DataPoint({ city, monthIndex, colorMode, aqiFilter, isSelected, isHovered }: DataPointProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const basePos = useMemo(() => latLngToVector3(city.lat, city.lng, EARTH_RADIUS + 0.02), [city.lat, city.lng])
  const [baseScale, baseColor] = useMemo(() => {
    const data = city.monthlyData[monthIndex]
    const scale = 0.06 + ((data?.aqi ?? 50) / 500) * 0.115
    let color: THREE.Color
    switch (colorMode) {
      case 'temperature':
        color = getTemperatureColor(data?.temperature ?? 15)
        break
      case 'windSpeed':
        color = getWindSpeedColor(data?.windSpeed ?? 3)
        break
      default:
        color = getAqiColor(data?.aqi ?? 100)
    }
    return [scale, color]
  }, [city, monthIndex, colorMode])

  const aqi = city.monthlyData[monthIndex]?.aqi ?? 100
  const inRange = aqi >= aqiFilter[0] && aqi <= aqiFilter[1]
  const targetOpacity = inRange ? 1.0 : 0.1

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const breathe = 1 + Math.sin(t * Math.PI) * 0.15
    const selectedScale = isSelected ? 1.5 : 1
    const hoverScale = isHovered ? 1.2 : 1
    const scale = baseScale * breathe * selectedScale * hoverScale

    if (meshRef.current) {
      meshRef.current.position.copy(basePos)
      meshRef.current.scale.setScalar(scale)
      const mat = meshRef.current.material as THREE.MeshBasicMaterial
      if (!mat.color.equals(baseColor)) {
        mat.color.lerp(baseColor, 0.1)
      }
      if (Math.abs(mat.opacity - targetOpacity) > 0.01) {
        mat.opacity += (targetOpacity - mat.opacity) * 0.1
      }
    }
    if (glowRef.current) {
      glowRef.current.position.copy(basePos)
      glowRef.current.scale.setScalar(scale * 1.5)
      const mat = glowRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = isSelected ? 0.6 * (0.7 + Math.sin(t * 4) * 0.3) : 0
    }
  })

  const handleClick = (e: any) => {
    e.stopPropagation()
    eventBus.emit('city:select', isSelected ? null : city)
  }

  const handlePointerOver = (e: any) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
    eventBus.emit('city:hover', city)
  }

  const handlePointerOut = (e: any) => {
    e.stopPropagation()
    document.body.style.cursor = 'default'
    eventBus.emit('city:hover', null)
  }

  return (
    <group>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={targetOpacity}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#FFD54F" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

interface EarthProps {
  earthRadius: number
}

function Earth({ earthRadius }: EarthProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  const earthTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#0a1628')
    gradient.addColorStop(0.5, '#0d2137')
    gradient.addColorStop(1, '#0a1628')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1a5c3a'
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * canvas.width
      const y = 80 + Math.random() * (canvas.height - 160)
      const w = 30 + Math.random() * 120
      const h = 20 + Math.random() * 80
      ctx.beginPath()
      ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#2d7a4a'
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * canvas.width
      const y = 80 + Math.random() * (canvas.height - 160)
      const w = 20 + Math.random() * 60
      const h = 15 + Math.random() * 40
      ctx.beginPath()
      ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    return texture
  }, [])

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.0003
    }
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[earthRadius, 64, 64]} />
      <meshStandardMaterial
        map={earthTexture}
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  )
}

interface HeatmapLayerProps {
  monthIndex: number
  earthRadius: number
  visible: boolean
}

function HeatmapLayer({ monthIndex, earthRadius, visible }: HeatmapLayerProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const dataTexture = useMemo(() => {
    const resolution = 50
    const pixelData = new Uint8Array(resolution * resolution * 4)
    const monthlyData = dataManager.getMonthlyData(monthIndex)
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const lat = 90 - (i / (resolution - 1)) * 180
        const lng = -180 + (j / (resolution - 1)) * 360
        let totalAqi = 0
        let count = 0
        for (const { city, data } of monthlyData) {
          const dist = Math.sqrt(Math.pow(city.lat - lat, 2) + Math.pow(city.lng - lng, 2))
          if (dist < 30) {
            const weight = 1 - dist / 30
            totalAqi += data.aqi * weight
            count += weight
          }
        }
        const aqi = count > 0 ? totalAqi / count : 0
        const idx = (i * resolution + j) * 4
        pixelData[idx] = Math.floor(aqi)
        pixelData[idx + 1] = Math.floor((aqi % 1) * 256)
        pixelData[idx + 2] = 0
        pixelData[idx + 3] = 255
      }
    }
    const texture = new THREE.DataTexture(pixelData, resolution, resolution, THREE.RGBAFormat)
    texture.needsUpdate = true
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
  }, [monthIndex])

  const uniforms = useMemo(() => ({
    uDataTexture: { value: dataTexture },
    uOpacity: { value: visible ? 0.5 : 0 },
  }), [dataTexture, visible])

  useFrame((_, delta) => {
    if (materialRef.current) {
      const target = visible ? 0.5 : 0
      materialRef.current.uniforms.uOpacity.value += (target - materialRef.current.uniforms.uOpacity.value) * Math.min(1, delta * 3)
    }
  })

  return (
    <mesh>
      <sphereGeometry args={[earthRadius + 0.01, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision highp float;
          varying vec2 vUv;
          uniform sampler2D uDataTexture;
          uniform float uOpacity;

          vec3 getColor(float t) {
            if (t < 0.33) return mix(vec3(0.0, 0.9, 0.46), vec3(1.0, 0.92, 0.23), t / 0.33);
            if (t < 0.66) return mix(vec3(1.0, 0.92, 0.23), vec3(1.0, 0.6, 0.0), (t - 0.33) / 0.33);
            return mix(vec3(1.0, 0.6, 0.0), vec3(1.0, 0.09, 0.27), (t - 0.66) / 0.34);
          }

          void main() {
            vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
            vec4 texColor = texture2D(uDataTexture, uv);
            float aqi = float(texColor.r) + float(texColor.g) / 256.0;
            float t = clamp(aqi / 500.0, 0.0, 1.0);
            vec3 color = getColor(t);
            gl_FragColor = vec4(color, uOpacity * t * 0.8);
          }
        `}
      />
    </mesh>
  )
}

interface SceneContentProps {
  earthRadius: number
  monthIndex: number
  colorMode: ColorMode
  displayMode: DisplayMode
  aqiFilter: [number, number]
  selectedCityId: string | null
  hoveredCityId: string | null
}

function SceneContent({
  earthRadius,
  monthIndex,
  colorMode,
  displayMode,
  aqiFilter,
  selectedCityId,
  hoveredCityId,
}: SceneContentProps) {
  const cities = useMemo(() => dataManager.getCities(), [])

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 5, 10]} intensity={1} />
      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
      <Earth earthRadius={earthRadius} />
      <HeatmapLayer monthIndex={monthIndex} earthRadius={earthRadius} visible={displayMode === 'heatmap'} />
      {displayMode === 'bubble' && cities.map((city) => (
        <DataPoint
          key={city.id}
          city={city}
          monthIndex={monthIndex}
          colorMode={colorMode}
          aqiFilter={aqiFilter}
          isSelected={city.id === selectedCityId}
          isHovered={city.id === hoveredCityId}
        />
      ))}
      <OrbitControls
        enablePan={false}
        minDistance={earthRadius * 1.5}
        maxDistance={earthRadius * 5}
        enableDamping
        dampingFactor={0.05}
      />
    </>
  )
}

interface EarthSceneProps {
  earthRadius: number
}

export function EarthScene({ earthRadius }: EarthSceneProps) {
  const [monthIndex, setMonthIndex] = useState(0)
  const [colorMode, setColorMode] = useState<ColorMode>('aqi')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble')
  const [aqiFilter, setAqiFilter] = useState<[number, number]>([0, 500])
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null)
  const [hoveredCityId, setHoveredCityId] = useState<string | null>(null)

  useEffect(() => {
    const unsub1 = eventBus.on('time:change', setMonthIndex)
    const unsub2 = eventBus.on('mode:color', setColorMode)
    const unsub3 = eventBus.on('mode:display', setDisplayMode)
    const unsub4 = eventBus.on('filter:aqi', setAqiFilter)
    const unsub5 = eventBus.on('city:select', (city) => setSelectedCityId(city?.id ?? null))
    const unsub6 = eventBus.on('city:hover', (city) => setHoveredCityId(city?.id ?? null))
    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
      unsub5()
      unsub6()
    }
  }, [])

  return (
    <Canvas
      camera={{ position: [0, 0, earthRadius * 3], fov: 45 }}
      style={{ background: '#0A0E17' }}
      gl={{ antialias: true, alpha: false }}
      onClick={() => eventBus.emit('city:select', null)}
    >
      <SceneContent
        earthRadius={earthRadius}
        monthIndex={monthIndex}
        colorMode={colorMode}
        displayMode={displayMode}
        aqiFilter={aqiFilter}
        selectedCityId={selectedCityId}
        hoveredCityId={hoveredCityId}
      />
    </Canvas>
  )
}
