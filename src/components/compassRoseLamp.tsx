import { useRef, useMemo, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LanternInstance, LanternConfig } from '../types'

interface CompassRoseLampProps {
  lantern: LanternInstance
  config: LanternConfig
  onClick: () => void
}

function CompassRoseLamp({ lantern, config, onClick }: CompassRoseLampProps) {
  const lanternRef = useRef<THREE.Group>(null)
  const [particles, setParticles] = useState<Array<{
    id: number
    position: [number, number, number]
    velocity: [number, number, number]
    life: number
    maxLife: number
    color: string
    size: number
  }>>([])
  const [splashParticles, setSplashParticles] = useState<Array<{
    id: number
    position: [number, number, number]
    velocity: [number, number, number]
    life: number
    maxLife: number
  }>>([])
  const particleIdRef = useRef(0)

  const glowRadius = useMemo(() => {
    if (lantern.state === 'hovering') return 0.5
    return 0.5 + (config.glowRadius - 0.5) * lantern.glowIntensity
  }, [lantern.state, lantern.glowIntensity, config.glowRadius])

  const baseColor = useMemo(() => new THREE.Color(config.color), [config.color])

  useEffect(() => {
    if (lantern.state === 'ignited' || lantern.state === 'rising') {
      const interval = setInterval(() => {
        setParticles(prev => {
          if (prev.length > 300) return prev
          
          const newParticles = []
          for (let i = 0; i < 2; i++) {
            const angle = Math.random() * Math.PI * 2
            const radius = Math.random() * 0.2
            newParticles.push({
              id: particleIdRef.current++,
              position: [
                lantern.position.x + Math.cos(angle) * radius,
                lantern.position.y - 0.3,
                lantern.position.z + Math.sin(angle) * radius,
              ] as [number, number, number],
              velocity: [
                (Math.random() - 0.5) * 0.5,
                1 + Math.random() * 1.5,
                (Math.random() - 0.5) * 0.5,
              ] as [number, number, number],
              life: 0,
              maxLife: 2,
              color: Math.random() > 0.5 ? '#ffa500' : '#ff6347',
              size: 0.05 + Math.random() * 0.05,
            })
          }
          return [...prev, ...newParticles].slice(-300)
        })
      }, 50)

      return () => clearInterval(interval)
    }
  }, [lantern.state, lantern.position])

  useEffect(() => {
    if (lantern.state === 'fallen' && lantern.fallTime) {
      const newParticles = []
      for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.5 + Math.random() * 2
        newParticles.push({
          id: particleIdRef.current++,
          position: [lantern.position.x, 0.5, lantern.position.z] as [number, number, number],
          velocity: [
            Math.cos(angle) * speed,
            1 + Math.random() * 3,
            Math.sin(angle) * speed,
          ] as [number, number, number],
          life: 0,
          maxLife: 1,
        })
      }
      setSplashParticles(newParticles)
    }
  }, [lantern.state])

  useFrame((_, delta) => {
    if (lanternRef.current) {
      const now = performance.now()
      const swayAmount = lantern.state === 'falling' && lantern.fallTime 
        ? Math.sin(now * 0.01) * 0.2 
        : Math.sin(now * 0.002 + lantern.swayOffset) * 0.03
      
      lanternRef.current.position.set(
        lantern.position.x,
        lantern.position.y,
        lantern.position.z,
      )
      lanternRef.current.rotation.z = swayAmount
      lanternRef.current.rotation.y = Math.sin(now * 0.001 + lantern.swayOffset) * 0.02
    }

    setParticles(prev => 
      prev
        .map(p => ({
          ...p,
          life: p.life + delta,
          position: [
            p.position[0] + p.velocity[0] * delta,
            p.position[1] + p.velocity[1] * delta,
            p.position[2] + p.velocity[2] * delta,
          ] as [number, number, number],
          velocity: [
            p.velocity[0],
            p.velocity[1] - 2 * delta,
            p.velocity[2],
          ] as [number, number, number],
        }))
        .filter(p => p.life < p.maxLife)
    )

    setSplashParticles(prev => 
      prev
        .map(p => ({
          ...p,
          life: p.life + delta,
          position: [
            p.position[0] + p.velocity[0] * delta,
            p.position[1] + p.velocity[1] * delta,
            p.position[2] + p.velocity[2] * delta,
          ] as [number, number, number],
          velocity: [
            p.velocity[0] * 0.98,
            p.velocity[1] - 5 * delta,
            p.velocity[2] * 0.98,
          ] as [number, number, number],
        }))
        .filter(p => p.life < p.maxLife)
    )
  })

  const isRisingOrFloating = lantern.state === 'rising' || lantern.state === 'floating'

  return (
    <group>
      <group
        ref={lanternRef}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}

      >
        <mesh position={[0, 0, 0]} castShadow>
          <cylinderGeometry args={[0.25, 0.35, 0.6, 16]} />
          <meshStandardMaterial
            color={baseColor}
            emissive={baseColor}
            emissiveIntensity={0.3 + lantern.glowIntensity * 0.7}
            transparent
            opacity={0.85 + lantern.glowIntensity * 0.15}
            metalness={0.1}
            roughness={0.8}
          />
        </mesh>

        <mesh position={[0, 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.28, 0.05, 16]} />
          <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.1} />
        </mesh>

        <mesh position={[0, -0.35, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.05, 16]} />
          <meshStandardMaterial color="#ffd700" metalness={0.9} roughness={0.1} />
        </mesh>

        <mesh position={[0, -0.45, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.15, 8]} />
          <meshStandardMaterial color="#8b4513" />
        </mesh>

        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.15, 8]} />
          <meshStandardMaterial color="#8b4513" />
        </mesh>

        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[glowRadius, 32, 32]} />
          <meshBasicMaterial
            color={baseColor}
            transparent
            opacity={0.1 * lantern.glowIntensity}
            side={THREE.BackSide}
          />
        </mesh>

        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[glowRadius * 0.6, 32, 32]} />
          <meshBasicMaterial
            color={baseColor}
            transparent
            opacity={0.15 * lantern.glowIntensity}
            side={THREE.BackSide}
          />
        </mesh>

        {lantern.glowIntensity > 0.3 && (
          <pointLight
            position={[0, 0, 0]}
            color={baseColor}
            intensity={lantern.glowIntensity * 2}
            distance={glowRadius * 8}
            decay={2}
          />
        )}

        {(lantern.state === 'ignited' || lantern.state === 'rising') && (
          <mesh position={[0, -0.3, 0]}>
            <coneGeometry args={[0.1, 0.3, 8]} />
            <meshBasicMaterial
              color="#ff6600"
              transparent
              opacity={0.8 + Math.sin(performance.now() * 0.01) * 0.2}
            />
          </mesh>
        )}
      </group>

      {particles.map(particle => {
        const lifeRatio = particle.life / particle.maxLife
        const color = new THREE.Color(particle.color)
        color.lerp(new THREE.Color('#ff0000'), lifeRatio * 0.5)
        return (
          <mesh
            key={particle.id}
            position={particle.position}
          >
            <sphereGeometry args={[particle.size * (1 - lifeRatio * 0.5), 8, 8]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={(1 - lifeRatio) * 0.8}
            />
          </mesh>
        )
      })}

      {splashParticles.map(particle => {
        const lifeRatio = particle.life / particle.maxLife
        return (
          <mesh
            key={particle.id}
            position={particle.position}
          >
            <sphereGeometry args={[0.04 * (1 - lifeRatio * 0.3), 6, 6]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={(1 - lifeRatio) * 0.7}
            />
          </mesh>
        )
      })}
    </group>
  )
}

export default CompassRoseLamp
