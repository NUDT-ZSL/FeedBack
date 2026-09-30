import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WeatherDataPoint, WeatherFilters } from '@/data/weatherData';
import { weatherSystem } from '@/engine/useWeatherSystem';

interface WeatherParticlesProps {
  data: WeatherDataPoint[];
  filters: WeatherFilters;
  onParticleHover: (point: WeatherDataPoint | null, x: number, y: number) => void;
}

interface ParticleMeshProps {
  point: WeatherDataPoint;
  filters: WeatherFilters;
  onHover: (point: WeatherDataPoint | null, x: number, y: number) => void;
}

const ParticleMesh: React.FC<ParticleMeshProps> = ({ point, filters, onHover }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const appearance = useMemo(
    () => weatherSystem.getParticleAppearance(point),
    [point, filters]
  );

  useFrame(() => {
    if (!meshRef.current) return;

    weatherSystem.getParticlePosition(point, targetPosition);
    meshRef.current.position.copy(targetPosition);
  });

  return (
    <mesh
      ref={meshRef}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(point, event.clientX, event.clientY);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        onHover(null, 0, 0);
      }}
      scale={[appearance.size, appearance.size, appearance.size]}
    >
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial
        color={appearance.color}
        emissive={appearance.color}
        emissiveIntensity={0.2}
        transparent
        opacity={appearance.opacity}
        depthWrite={false}
      />
    </mesh>
  );
};

export const WeatherParticles: React.FC<WeatherParticlesProps> = ({
  data,
  filters,
  onParticleHover,
}) => (
  <group>
    {data.map((point) => (
      <ParticleMesh
        key={point.id}
        point={point}
        filters={filters}
        onHover={onParticleHover}
      />
    ))}
  </group>
);
