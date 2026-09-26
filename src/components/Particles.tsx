import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomConfig } from '@/types';
import { generateParticleData } from '@/utils/reverb';

interface ParticlesProps {
  count: number;
  room: RoomConfig;
  enabled: boolean;
}

export function Particles({ count, room, enabled }: ParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const time = useRef(0);

  const particleData = useMemo(() => {
    return generateParticleData(count, room);
  }, [count, room]);

  const positionsRef = useRef<Float32Array>(particleData.positions);
  const velocitiesRef = useRef<Float32Array>(particleData.velocities);
  const lifetimesRef = useRef<Float32Array>(particleData.lifetimes);
  const alphasRef = useRef<Float32Array>(particleData.alphas);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positionsRef.current, 3));
    geom.setAttribute('alpha', new THREE.BufferAttribute(alphasRef.current, 1));
    return geom;
  }, []);

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      color: '#00d4ff',
      size: 0.05,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
  }, []);

  useFrame((_, delta) => {
    if (!enabled || !pointsRef.current) return;

    time.current += delta;
    const positions = positionsRef.current;
    const velocities = velocitiesRef.current;
    const lifetimes = lifetimesRef.current;
    const alphas = alphasRef.current;

    const hw = room.width / 2;
    const hh = room.height / 2;
    const hd = room.depth / 2;

    for (let i = 0; i < count; i++) {
      lifetimes[i] -= delta * 0.3;

      if (lifetimes[i] <= 0) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 1;
        positions[i * 3 + 2] = 0;

        const speed = 0.3 + Math.random() * 1.2;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        velocities[i * 3] = speed * Math.sin(phi) * Math.cos(theta);
        velocities[i * 3 + 1] = speed * Math.abs(Math.sin(phi) * Math.sin(theta));
        velocities[i * 3 + 2] = speed * Math.cos(phi);

        lifetimes[i] = 1 + Math.random() * 2;
        alphas[i] = 0.1 + Math.random() * 0.2;
      }

      const decay = 0.98;
      velocities[i * 3] *= decay;
      velocities[i * 3 + 1] *= decay;
      velocities[i * 3 + 2] *= decay;

      positions[i * 3] += velocities[i * 3] * delta;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;

      if (positions[i * 3] > hw) { positions[i * 3] = hw; velocities[i * 3] *= -0.5; }
      if (positions[i * 3] < -hw) { positions[i * 3] = -hw; velocities[i * 3] *= -0.5; }
      if (positions[i * 3 + 1] > hh) { positions[i * 3 + 1] = hh; velocities[i * 3 + 1] *= -0.5; }
      if (positions[i * 3 + 1] < -hh) { positions[i * 3 + 1] = -hh; velocities[i * 3 + 1] *= -0.5; }
      if (positions[i * 3 + 2] > hd) { positions[i * 3 + 2] = hd; velocities[i * 3 + 2] *= -0.5; }
      if (positions[i * 3 + 2] < -hd) { positions[i * 3 + 2] = -hd; velocities[i * 3 + 2] *= -0.5; }

      const alphaLife = Math.min(1, lifetimes[i]);
      alphas[i] = (0.1 + Math.random() * 0.2) * alphaLife;
    }

    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
  });

  if (!enabled || count === 0) return null;

  return (
    <points ref={pointsRef} geometry={geometry} material={material} />
  );
}
