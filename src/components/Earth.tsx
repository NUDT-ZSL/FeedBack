import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface EarthProps {
  isRotating: boolean;
  radius?: number;
}

export const Earth: React.FC<EarthProps> = ({ isRotating, radius = 2 }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const oceanColor = '#4A90D9';
  const landColor = '#7CB342';

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = oceanColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const continents = [
      { x: 80, y: 60, w: 120, h: 80 },
      { x: 260, y: 50, w: 100, h: 90 },
      { x: 180, y: 130, w: 60, h: 50 },
      { x: 320, y: 120, w: 80, h: 70 },
      { x: 380, y: 70, w: 70, h: 50 },
      { x: 430, y: 140, w: 50, h: 40 },
      { x: 120, y: 170, w: 40, h: 30 },
      { x: 20, y: 130, w: 50, h: 70 },
    ];

    ctx.fillStyle = landColor;
    continents.forEach((c) => {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y + c.h * 0.3);
      ctx.quadraticCurveTo(c.x + c.w * 0.2, c.y, c.x + c.w * 0.5, c.y + c.h * 0.1);
      ctx.quadraticCurveTo(c.x + c.w * 0.8, c.y, c.x + c.w, c.y + c.h * 0.4);
      ctx.quadraticCurveTo(c.x + c.w * 0.9, c.y + c.h * 0.7, c.x + c.w * 0.7, c.y + c.h);
      ctx.quadraticCurveTo(c.x + c.w * 0.4, c.y + c.h * 0.9, c.x + c.w * 0.2, c.y + c.h * 0.8);
      ctx.quadraticCurveTo(c.x, c.y + c.h * 0.6, c.x, c.y + c.h * 0.3);
      ctx.fill();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);

  useFrame((_, delta) => {
    if (isRotating && groupRef.current) {
      groupRef.current.rotation.y += delta * (Math.PI * 2) / 10;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshStandardMaterial
          map={texture}
          flatShading
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      <mesh scale={1.01}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshBasicMaterial
          color="#4A90D9"
          transparent
          opacity={0.15}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
};
