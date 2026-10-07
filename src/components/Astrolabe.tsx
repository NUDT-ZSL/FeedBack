import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStar } from '../context/StarContext';
import { degToRad, clamp, lerp } from '../utils';

const RADIUS = 3;
const TUBE_RADIUS = 0.05;

const ScaleMark: React.FC<{
  position: [number, number, number];
  rotation: [number, number, number];
  highlighted: boolean;
}> = ({ position, rotation, highlighted }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (meshRef.current) {
      const scale = highlighted ? 0.05 : 0.02;
      meshRef.current.scale.y = lerp(meshRef.current.scale.y, scale, 0.2);
      const material = meshRef.current.material as THREE.MeshStandardMaterial;
      const targetColor = highlighted ? '#ffd700' : '#c0a060';
      material.color.lerp(new THREE.Color(targetColor), 0.2);
    }
  });

  return (
    <mesh ref={meshRef} position={position} rotation={rotation}>
      <boxGeometry args={[0.01, 0.02, 0.08]} />
      <meshStandardMaterial color="#c0a060" metalness={0.8} roughness={0.3} />
    </mesh>
  );
};

const AstrolabeRings: React.FC = () => {
  const { ra, dec, setRa, setDec } = useStar();
  const [isDragging, setIsDragging] = useState(false);
  const [dragAxis, setDragAxis] = useState<'ra' | 'dec' | null>(null);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [highlightedRa, setHighlightedRa] = useState<number | null>(null);
  const [highlightedDec, setHighlightedDec] = useState<number | null>(null);
  const ringGroupRef = useRef<THREE.Group>(null);
  const targetRotation = useRef({ x: 0, y: 0 });

  useEffect(() => {
    targetRotation.current = { x: degToRad(-dec), y: degToRad(ra) };
  }, [ra, dec]);

  useFrame((_, delta) => {
    if (ringGroupRef.current) {
      ringGroupRef.current.rotation.x = lerp(
        ringGroupRef.current.rotation.x,
        targetRotation.current.x,
        delta * 5
      );
      ringGroupRef.current.rotation.y = lerp(
        ringGroupRef.current.rotation.y,
        targetRotation.current.y,
        delta * 5
      );
    }
  });

  const handlePointerDown = (axis: 'ra' | 'dec') => (e: React.PointerEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragAxis(axis);
    setLastPos({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragAxis) return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;

    if (dragAxis === 'ra') {
      const delta = Math.round(dx * 0.5);
      if (Math.abs(delta) >= 1) {
        const newRa = ((ra + delta) % 360 + 360) % 360;
        setRa(newRa);
        setHighlightedRa(Math.round(newRa / 10) * 10);
        setTimeout(() => setHighlightedRa(null), 500);
        setLastPos({ x: e.clientX, y: e.clientY });
      }
    } else {
      const delta = Math.round(dy * 0.5);
      if (Math.abs(delta) >= 1) {
        const newDec = clamp(dec + delta, -90, 90);
        setDec(newDec);
        setHighlightedDec(Math.round(newDec / 10) * 10);
        setTimeout(() => setHighlightedDec(null), 500);
        setLastPos({ x: e.clientX, y: e.clientY });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    setDragAxis(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const raScaleMarks = useMemo(() => {
    const marks: { position: [number, number, number]; rotation: [number, number, number]; highlighted: boolean }[] = [];
    for (let angle = 0; angle < 360; angle += 10) {
      const rad = degToRad(angle);
      const x = RADIUS * Math.cos(rad);
      const z = RADIUS * Math.sin(rad);
      const highlighted = highlightedRa !== null && angle === highlightedRa;
      marks.push({
        position: [x, 0, z],
        rotation: [0, -rad, Math.PI / 2],
        highlighted,
      });
    }
    return marks;
  }, [highlightedRa]);

  const decScaleMarks = useMemo(() => {
    const marks: { position: [number, number, number]; rotation: [number, number, number]; highlighted: boolean }[] = [];
    for (let angle = -80; angle <= 80; angle += 10) {
      const rad = degToRad(angle);
      const y = RADIUS * Math.sin(rad);
      const r = RADIUS * Math.cos(rad);
      const highlighted = highlightedDec !== null && angle === highlightedDec;
      marks.push({
        position: [r, y, 0],
        rotation: [0, 0, degToRad(90 - angle)],
        highlighted,
      });
    }
    return marks;
  }, [highlightedDec]);

  return (
    <group ref={ringGroupRef}>
      <mesh
        onPointerDown={handlePointerDown('ra')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <torusGeometry args={[RADIUS, TUBE_RADIUS, 16, 64]} />
        <meshStandardMaterial
          color="#8b6914"
          metalness={0.9}
          roughness={0.25}
          emissive="#2a1f05"
          emissiveIntensity={0.2}
        />
      </mesh>

      <mesh
        onPointerDown={handlePointerDown('dec')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <torusGeometry args={[RADIUS, TUBE_RADIUS, 16, 64]} />
        <meshStandardMaterial
          color="#8b6914"
          metalness={0.9}
          roughness={0.25}
          emissive="#2a1f05"
          emissiveIntensity={0.2}
        />
        <rotation x={Math.PI / 2} />
      </mesh>

      <mesh
        onPointerDown={handlePointerDown('dec')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <torusGeometry args={[RADIUS, TUBE_RADIUS, 16, 64]} />
        <meshStandardMaterial
          color="#8b6914"
          metalness={0.9}
          roughness={0.25}
          emissive="#2a1f05"
          emissiveIntensity={0.2}
        />
        <rotation x={Math.PI / 2} z={Math.PI / 4} />
      </mesh>

      <mesh
        onPointerDown={handlePointerDown('dec')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <torusGeometry args={[RADIUS, TUBE_RADIUS, 16, 64]} />
        <meshStandardMaterial
          color="#8b6914"
          metalness={0.9}
          roughness={0.25}
          emissive="#2a1f05"
          emissiveIntensity={0.2}
        />
        <rotation x={Math.PI / 2} z={-Math.PI / 4} />
      </mesh>

      {raScaleMarks.map((mark, i) => (
        <ScaleMark key={`ra-${i}`} {...mark} />
      ))}

      {decScaleMarks.map((mark, i) => (
        <ScaleMark key={`dec-${i}`} {...mark} />
      ))}

      <mesh>
        <sphereGeometry args={[0.6, 32, 32]} />
        <meshStandardMaterial
          color="#ffe066"
          emissive="#ffd700"
          emissiveIntensity={0.8}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>

      <pointLight color="#ffd700" intensity={2} distance={10} />
    </group>
  );
};

const Astrolabe: React.FC = () => {
  return (
    <group position={[0, 2, 0]}>
      <AstrolabeRings />
    </group>
  );
};

export default Astrolabe;
