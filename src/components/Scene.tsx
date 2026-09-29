import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { Earth } from './Earth';
import { WeatherParticles } from './WeatherParticles';
import { TimeArc } from './TimeArc';
import { WeatherDataPoint, WeatherFilters } from '@/data/weatherData';

interface SceneProps {
  data: WeatherDataPoint[];
  filters: WeatherFilters;
  currentHour: number;
  isRotating: boolean;
  onParticleHover: (point: WeatherDataPoint | null, x: number, y: number) => void;
}

const CameraController: React.FC = () => {
  const { camera } = useThree();

  useEffect(() => {
    const handleResize = () => {
      const aspect = window.innerWidth / window.innerHeight;
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [camera]);

  return null;
};

const SceneContent: React.FC<SceneProps> = ({
  data,
  filters,
  currentHour,
  isRotating,
  onParticleHover,
}) => {
  const earthRadius = 2;

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 3, 5]} intensity={1} />
      <pointLight position={[-5, -3, -5]} intensity={0.3} color="#4A90D9" />

      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={0.5} />

      <group position={[0, -0.3, 0]}>
        <Earth isRotating={isRotating} radius={earthRadius} />
        <WeatherParticles
          data={data}
          filters={filters}
          earthRadius={earthRadius}
          currentHour={currentHour}
          onParticleHover={onParticleHover}
        />
        <TimeArc currentHour={currentHour} radius={earthRadius} />
      </group>

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={0.6}
        maxDistance={6}
        rotateSpeed={0.05}
        zoomSpeed={0.8}
        enableDamping
        dampingFactor={0.05}
      />

      <CameraController />
    </>
  );
};

export const Scene: React.FC<SceneProps> = (props) => {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{ background: 'transparent' }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
};
