import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Color, Vector3 } from 'three'

interface LampData {
  id: string
  position: Vector3
  color: Color
  glowRadius: number
}

interface CompassRoseProps {
  lamps: LampData[]
  showReflections: boolean
}

function CompassRose({ lamps, showReflections }: CompassRoseProps) {
  const waterRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const waterShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color('#0a1628') },
      uReflectionStrength: { value: 0.3 },
      uLampPositions: { value: new Float32Array(32 * 3) },
      uLampColors: { value: new Float32Array(32 * 3) },
      uLampRadii: { value: new Float32Array(32) },
      uLampCount: { value: 0 },
      uShowReflections: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      
      uniform float uTime;
      
      void main() {
        vUv = uv;
        
        vec3 pos = position;
        float wave1 = sin(pos.x * 0.5 + uTime * 0.5) * 0.02;
        float wave2 = sin(pos.z * 0.7 + uTime * 0.3) * 0.015;
        float wave3 = sin((pos.x + pos.z) * 0.3 + uTime * 0.4) * 0.01;
        pos.y += wave1 + wave2 + wave3;
        
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalMatrix * normal;
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uReflectionStrength;
      uniform vec3 uLampPositions[32];
      uniform vec3 uLampColors[32];
      uniform float uLampRadii[32];
      uniform int uLampCount;
      uniform float uShowReflections;
      
      void main() {
        vec3 baseColor = uColor;
        
        float ripple = sin(vUv.x * 50.0 + uTime * 2.0) * 0.5 + 0.5;
        ripple *= sin(vUv.y * 50.0 + uTime * 1.5) * 0.5 + 0.5;
        baseColor += vec3(0.01) * ripple;
        
        vec3 reflectionColor = vec3(0.0);
        
        if (uShowReflections > 0.5) {
          for (int i = 0; i < 32; i++) {
            if (i >= uLampCount) break;
            
            vec3 lampPos = uLampPositions[i];
            vec3 reflectionPos = vec3(lampPos.x, -lampPos.y, lampPos.z);
            
            float dist = distance(vWorldPosition.xz, reflectionPos.xz);
            float radius = uLampRadii[i] * 3.0;
            
            if (dist < radius) {
              float intensity = 1.0 - smoothstep(0.0, radius, dist);
              intensity *= 0.4 * uReflectionStrength;
              
              float flicker = sin(uTime * 3.0 + float(i) * 0.7) * 0.1 + 0.9;
              intensity *= flicker;
              
              vec2 rippleOffset = vec2(
                sin(dist * 2.0 - uTime * 2.0) * 0.1,
                cos(dist * 2.0 - uTime * 1.5) * 0.1
              );
              
              reflectionColor += uLampColors[i] * intensity;
            }
          }
        }
        
        float rimHighlight = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0))), 3.0);
        baseColor += vec3(0.1, 0.15, 0.2) * rimHighlight;
        
        vec3 finalColor = baseColor + reflectionColor;
        
        gl_FragColor = vec4(finalColor, 0.85);
      }
    `,
  }), [])

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      
      const positions = materialRef.current.uniforms.uLampPositions.value as Float32Array
      const colors = materialRef.current.uniforms.uLampColors.value as Float32Array
      const radii = materialRef.current.uniforms.uLampRadii.value as Float32Array
      
      for (let i = 0; i < 32; i++) {
        if (i < lamps.length) {
          const lamp = lamps[i]
          positions[i * 3] = lamp.position.x
          positions[i * 3 + 1] = lamp.position.y
          positions[i * 3 + 2] = lamp.position.z
          
          colors[i * 3] = lamp.color.r
          colors[i * 3 + 1] = lamp.color.g
          colors[i * 3 + 2] = lamp.color.b
          
          radii[i] = lamp.glowRadius
        } else {
          positions[i * 3] = 0
          positions[i * 3 + 1] = 0
          positions[i * 3 + 2] = 0
          colors[i * 3] = 0
          colors[i * 3 + 1] = 0
          colors[i * 3 + 2] = 0
          radii[i] = 0
        }
      }
      
      materialRef.current.uniforms.uLampPositions.needsUpdate = true
      materialRef.current.uniforms.uLampColors.needsUpdate = true
      materialRef.current.uniforms.uLampRadii.needsUpdate = true
      materialRef.current.uniforms.uLampCount.value = lamps.length
      materialRef.current.uniforms.uShowReflections.value = showReflections ? 1 : 0
    }
  })

  return (
    <group>
      <mesh ref={waterRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[12.5, 128]} />
        <shaderMaterial
          ref={materialRef}
          {...waterShader}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <ringGeometry args={[12.5, 13, 64]} />
        <meshBasicMaterial color="#0d1b2a" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>

      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2
        const x = Math.cos(angle) * 12.5
        const z = Math.sin(angle) * 12.5
        return (
          <mesh key={i} position={[x, 0.2, z]} rotation={[0, -angle, 0]}>
            <coneGeometry args={[0.3, 1, 8]} />
            <meshStandardMaterial color="#2d5a3d" />
          </mesh>
        )
      })}

      {lamps.filter(l => showReflections && l.position.y > 2).map((lamp, i) => (
        <mesh
          key={`reflection-${lamp.id}`}
          position={[lamp.position.x, -lamp.position.y * 0.3 + 0.05, lamp.position.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[lamp.glowRadius * 0.8, 32]} />
          <meshBasicMaterial 
            color={lamp.color} 
            transparent 
            opacity={0.15 * lamp.glowRadius / 2} 
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      <hemisphereLight args={['#1a2a4a', '#0a1628', 0.3]} />
    </group>
  )
}

export default CompassRose
