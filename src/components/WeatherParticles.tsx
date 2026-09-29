import React, { useRef, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WeatherDataPoint, WeatherFilters } from '@/data/weatherData';
import { latLonToVector3, temperatureToColor, pressureToSize } from '@/data/weatherData';

interface WeatherParticlesProps {
  data: WeatherDataPoint[];
  filters: WeatherFilters;
  earthRadius: number;
  currentHour: number;
  onParticleHover: (point: WeatherDataPoint | null, x: number, y: number) => void;
}

interface ParticleMeshProps {
  point: WeatherDataPoint;
  basePos: THREE.Vector3;
  baseScale: number;
  floatAmplitude: number;
  floatFrequency: number;
  timeRef: React.MutableRefObject<number>;
  onHover: (point: WeatherDataPoint | null, x: number, y: number) => void;
}

const ParticleMesh: React.FC<ParticleMeshProps> = ({
  point,
  basePos,
  baseScale,
  floatAmplitude,
  floatFrequency,
  timeRef,
  onHover,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!meshRef.current) return;

    const floatOffset =
      Math.sin(timeRef.current * floatFrequency * Math.PI * 2 + point.phase) * floatAmplitude;

    tmpVec.copy(basePos).normalize().multiplyScalar(baseScale * 0.8 + floatOffset);
    meshRef.current.position.copy(basePos).add(tmpVec);
  });

  const pressureFactor = pressureToSize(point.pressure);
  const scale = pressureFactor * baseScale;
  const color = temperatureToColor(point.temperature);

  return (
    <mesh
      ref={meshRef}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(point, e.clientX, e.clientY);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(null, 0, 0);
      }}
      scale={[scale, scale, scale]}
    >
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.2}
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </mesh>
  );
};

export const WeatherParticles: React.FC<WeatherParticlesProps> = ({
  data,
  filters,
  earthRadius,
  currentHour,
  onParticleHover,
}) => {
  const time = useRef(0);
  const baseScale = 0.05;
  const floatAmplitude = 0.025;
  const floatFrequency = 0.3;

  const basePositions = useMemo(() => {
    return data.map((point) => {
      const v = latLonToVector3(point.lat, point.lon, earthRadius);
      return new THREE.Vector3(v.x, v.y, v.z);
    });
  }, [data, earthRadius]);

  useFrame((_, delta) => {
    time.current += delta;
  });

  const getOpacity = useCallback(() => {
    const allVisible = filters.showTemperature && filters.showPressure && filters.showHumidity;
    if (allVisible) return 0.85;

    const visibleCount =
      (filters.showTemperature ? 1 : 0) +
      (filters.showPressure ? 1 : 0) +
      (filters.showHumidity ? 1 : 0);

    if (visibleCount === 0) return 0.1;
    return 0.2 + (visibleCount / 3) * 0.65;
  }, [filters]);

  const opacity = getOpacity();

  return (
    <group>
      {data.map((point, i) => (
        <ParticleMesh
          key={point.id}
          point={point}
          basePos={basePositions[i]}
          baseScale={baseScale}
          floatAmplitude={floatAmplitude}
          floatFrequency={floatFrequency}
          timeRef={time}
          onHover={onParticleHover}
        />
      ))}
    </group>
  );
};
