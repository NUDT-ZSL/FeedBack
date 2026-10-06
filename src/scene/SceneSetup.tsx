import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLightSource } from '@/store/useStore';
import { COLORS, MURAL_DIMENSIONS } from '@/types';

export function SceneSetup() {
  const lightRef = useRef<THREE.SpotLight>(null);
  const lightTargetRef = useRef<THREE.Object3D>(null);
  const lightConeRef = useRef<THREE.Mesh>(null);
  const lightSource = useLightSource();

  const muralTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 683;
    const ctx = canvas.getContext('2d')!;
    
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, COLORS.SILK_BG);
    gradient.addColorStop(1, '#c9b9a9');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = COLORS.DAMAGED;
    const damagedWidth = canvas.width * MURAL_DIMENSIONS.damagedAreaRatio;
    const damagedHeight = canvas.height * MURAL_DIMENSIONS.damagedAreaRatio * 1.5;
    const damagedX = (canvas.width - damagedWidth) / 2;
    const damagedY = (canvas.height - damagedHeight) / 2;
    
    ctx.beginPath();
    ctx.roundRect(damagedX, damagedY, damagedWidth, damagedHeight, 20);
    ctx.fill();
    
    ctx.strokeStyle = COLORS.INK;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX - 200, centerY - 100);
    ctx.quadraticCurveTo(centerX - 150, centerY - 150, centerX - 100, centerY - 120);
    ctx.quadraticCurveTo(centerX - 50, centerY - 90, centerX, centerY - 100);
    ctx.quadraticCurveTo(centerX + 50, centerY - 110, centerX + 100, centerY - 90);
    ctx.quadraticCurveTo(centerX + 150, centerY - 70, centerX + 200, centerY - 100);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 60, 80, 0, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(centerX - 80, centerY + 80);
    ctx.quadraticCurveTo(centerX - 40, centerY + 120, centerX, centerY + 100);
    ctx.quadraticCurveTo(centerX + 40, centerY + 80, centerX + 80, centerY + 110);
    ctx.stroke();
    
    const flowerPositions = [
      { x: centerX - 180, y: centerY - 180, r: 15 },
      { x: centerX + 160, y: centerY - 160, r: 12 },
      { x: centerX - 150, y: centerY + 150, r: 10 },
      { x: centerX + 170, y: centerY + 140, r: 14 },
      { x: centerX - 220, y: centerY, r: 11 },
      { x: centerX + 210, y: centerY + 20, r: 13 },
    ];
    
    flowerPositions.forEach(({ x, y, r }) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const petalX = x + Math.cos(angle) * r;
        const petalY = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(petalX, petalY);
        else ctx.lineTo(petalX, petalY);
        const innerAngle = ((i + 0.5) / 5) * Math.PI * 2 - Math.PI / 2;
        const innerX = x + Math.cos(innerAngle) * r * 0.5;
        const innerY = y + Math.sin(innerAngle) * r * 0.5;
        ctx.quadraticCurveTo(innerX, innerY, x + Math.cos(((i + 1) / 5) * Math.PI * 2 - Math.PI / 2) * r, y + Math.sin(((i + 1) / 5) * Math.PI * 2 - Math.PI / 2) * r);
      }
      ctx.closePath();
      ctx.stroke();
    });
    
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.CINNABAR;
    ctx.globalAlpha = 0.8;
    flowerPositions.forEach(({ x, y, r }) => {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });
    
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = COLORS.STONE_GREEN;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 40, 60, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = COLORS.STONE_BLUE;
    ctx.beginPath();
    ctx.moveTo(centerX - 180, centerY - 80);
    ctx.quadraticCurveTo(centerX - 150, centerY - 130, centerX - 100, centerY - 100);
    ctx.quadraticCurveTo(centerX - 50, centerY - 70, centerX, centerY - 80);
    ctx.quadraticCurveTo(centerX + 50, centerY - 90, centerX + 100, centerY - 70);
    ctx.quadraticCurveTo(centerX + 150, centerY - 50, centerX + 180, centerY - 80);
    ctx.quadraticCurveTo(centerX + 100, centerY - 40, centerX, centerY - 50);
    ctx.quadraticCurveTo(centerX - 100, centerY - 60, centerX - 180, centerY - 80);
    ctx.fill();
    
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = COLORS.GAMBOGE;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY - 10, 25, 35, 0, 0, Math.PI * 2);
    ctx.fill();
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  const lightConeGeometry = useMemo(() => {
    return new THREE.ConeGeometry(1, 2, 32, 1, true);
  }, []);

  const lightConeMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        glowColor: { value: new THREE.Color(COLORS.LAMP_GLOW) },
      },
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        varying vec3 vPosition;
        void main() {
          float alpha = 1.0 - abs(vPosition.y / 1.0);
          alpha = pow(alpha, 1.5) * 0.4;
          float edge = smoothstep(0.8, 1.0, length(vPosition.xz));
          alpha *= (1.0 - edge * 0.5);
          gl_FragColor = vec4(glowColor, alpha);
        }
      `,
    });
  }, []);

  useFrame(() => {
    if (lightRef.current && lightTargetRef.current) {
      lightRef.current.position.set(
        lightSource.x,
        lightSource.y,
        lightSource.z
      );
      lightTargetRef.current.position.set(lightSource.x, lightSource.y, 0);
      lightRef.current.angle = lightSource.radius * 0.4;
      lightRef.current.penumbra = 0.5;
    }
    
    if (lightConeRef.current) {
      lightConeRef.current.position.set(
        lightSource.x,
        lightSource.y + lightSource.z * 0.5,
        lightSource.z * 0.5
      );
      lightConeRef.current.rotation.x = Math.PI / 2;
      lightConeRef.current.scale.set(
        lightSource.radius,
        lightSource.z,
        lightSource.radius
      );
    }
  });

  return (
    <>
      <ambientLight intensity={0.1} />
      
      <spotLight
        ref={lightRef}
        position={[lightSource.x, lightSource.y, lightSource.z]}
        angle={lightSource.radius * 0.4}
        penumbra={0.5}
        intensity={5}
        distance={10}
        decay={2}
        color={COLORS.LAMP_GLOW}
        castShadow
      >
        <primitive ref={lightTargetRef} object={new THREE.Object3D()} attach="target" />
      </spotLight>
      
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[MURAL_DIMENSIONS.width, MURAL_DIMENSIONS.height]} />
        <meshStandardMaterial 
          map={muralTexture} 
          side={THREE.DoubleSide}
          roughness={0.8}
          metalness={0.1}
        />
      </mesh>
      
      <mesh ref={lightConeRef} geometry={lightConeGeometry} material={lightConeMaterial} />
      
      <mesh position={[0, -MURAL_DIMENSIONS.height / 2 - 0.5, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 10]} />
        <meshStandardMaterial color={COLORS.GROUND} roughness={0.9} />
      </mesh>
      
      <mesh position={[0, 0, -1]}>
        <boxGeometry args={[20, 15, 0.1]} />
        <meshStandardMaterial color={COLORS.CAVE_BG} roughness={1} />
      </mesh>
    </>
  );
}
