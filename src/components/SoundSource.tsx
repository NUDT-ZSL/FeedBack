import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SoundSourceConfig } from '@/types';

interface SoundSourceProps {
  config: SoundSourceConfig;
  onPositionChange: (pos: [number, number, number]) => void;
  onClick: () => void;
}

export function SoundSource({ config, onPositionChange, onClick }: SoundSourceProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const rippleRef1 = useRef<THREE.Mesh>(null);
  const rippleRef2 = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const time = useRef(0);

  const glowMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: '#ff8800',
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
    });
  }, []);

  const rippleMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: '#ffdd57',
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
  }, []);

  useFrame((_, delta) => {
    time.current += delta;

    if (meshRef.current) {
      const pulse = 1 + Math.sin(time.current * 3) * 0.05;
      meshRef.current.scale.setScalar(pulse);
    }

    if (config.active) {
      const cycle1 = (time.current * 1.5) % 1;
      const cycle2 = (time.current * 1.5 + 0.5) % 1;

      if (rippleRef1.current) {
        rippleRef1.current.scale.setScalar(0.3 + cycle1 * 1.5);
        const mat = rippleRef1.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.6 * (1 - cycle1);
        rippleRef1.current.visible = true;
      }
      if (rippleRef2.current) {
        rippleRef2.current.scale.setScalar(0.3 + cycle2 * 1.5);
        const mat = rippleRef2.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.6 * (1 - cycle2);
        rippleRef2.current.visible = true;
      }
      if (glowRef.current) {
        const glowPulse = 1 + Math.sin(time.current * 2) * 0.2;
        glowRef.current.scale.setScalar(glowPulse * 1.5);
        const mat = glowRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.2 + Math.sin(time.current * 2) * 0.1;
      }
    } else {
      if (rippleRef1.current) rippleRef1.current.visible = false;
      if (rippleRef2.current) rippleRef2.current.visible = false;
      if (glowRef.current) {
        glowRef.current.scale.setScalar(1.2);
        const mat = glowRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.15;
      }
    }
  });

  const handleDrag = (e: any) => {
    e.stopPropagation();
    const point = e.point;
    onPositionChange([point.x, point.y, point.z]);
  };

  return (
    <group position={config.position}>
      <mesh ref={glowRef}>
        <sphereGeometry args={[config.radius * 1.5, 32, 32]} />
        <primitive object={glowMaterial} attach="material" />
      </mesh>

      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
        }}
      >
        <sphereGeometry args={[config.radius, 32, 32]} />
        <meshStandardMaterial
          color="#ff7700"
          emissive="#ff5500"
          emissiveIntensity={config.active ? 1 : 0.3}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>

      <mesh ref={rippleRef1} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[config.radius * 0.8, config.radius, 64]} />
        <primitive object={rippleMaterial} attach="material" />
      </mesh>

      <mesh ref={rippleRef2} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[config.radius * 0.8, config.radius, 64]} />
        <primitive object={rippleMaterial} attach="material" />
      </mesh>
    </group>
  );
}
