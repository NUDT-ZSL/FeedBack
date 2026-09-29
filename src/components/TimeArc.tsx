import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

interface TimeArcProps {
  currentHour: number;
  radius: number;
}

export const TimeArc: React.FC<TimeArcProps> = ({ currentHour, radius }) => {
  const groupRef = useRef<THREE.Group>(null);
  const angle = (currentHour / 72) * Math.PI * 2;
  const arcRadius = radius * 1.05;

  const fullCirclePoints = useMemo(() => {
    const points: [number, number, number][] = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      points.push([
        arcRadius * Math.cos(theta),
        0,
        arcRadius * Math.sin(theta),
      ] as [number, number, number]);
    }
    return points;
  }, [arcRadius]);

  const markerPoints = useMemo(() => {
    const points: [number, number, number][] = [];
    const markerLength = 0.15;
    for (let i = 0; i <= 20; i++) {
      const theta = -markerLength / 2 + (i / 20) * markerLength;
      points.push([
        arcRadius * Math.cos(theta),
        0,
        arcRadius * Math.sin(theta),
      ] as [number, number, number]);
    }
    return points;
  }, [arcRadius]);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = angle;
    }
  });

  return (
    <group>
      <Line
        points={fullCirclePoints}
        color="#ffffff"
        opacity={0.2}
        transparent
        lineWidth={1}
      />
      <group ref={groupRef}>
        <Line
          points={markerPoints}
          color="#ffffff"
          opacity={0.5}
          transparent
          lineWidth={2}
        />
        <mesh position={[arcRadius, 0, 0]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#60A5FA" />
        </mesh>
      </group>
    </group>
  );
};
