import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RepairRegion } from '@/types';
import { useRepairStore } from '@/store/useRepairStore';

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'in-progress': return '#f59e0b';
    default: return '#ef4444';
  }
};

const ERROR_FLASH_SECONDS = 1;
const GLOW_SECONDS = 1;

const Lighting = () => {
  return (
    <>
      <ambientLight intensity={0.4} color="#ffffff" />
      <directionalLight
        position={[5, 5, 5]}
        intensity={1.2}
        color="#fff4e6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight
        position={[-5, 3, -5]}
        intensity={0.5}
        color="#87ceeb"
      />
      <pointLight
        position={[0, 4, 0]}
        intensity={0.6}
        color="#ffd700"
      />
    </>
  );
};

const RepairTable = () => {
  return (
    <mesh position={[0, -0.6, 0]} receiveShadow>
      <boxGeometry args={[4, 0.3, 3]} />
      <meshStandardMaterial
        color="#4a4a4a"
        roughness={0.9}
        metalness={0.1}
      />
    </mesh>
  );
};

const patinaGreen = new THREE.Color('#4a7c59');
const bronzeOriginal = new THREE.Color('#b87333');
const patinaTarget = new THREE.Color();

interface BronzeDingProps {
  patinaProgress: number;
}

const BronzeDing = ({ patinaProgress }: BronzeDingProps) => {
  const patinaMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (patinaMaterialRef.current) {
      patinaTarget.lerpColors(patinaGreen, bronzeOriginal, patinaProgress);
      patinaMaterialRef.current.color.copy(patinaTarget);
    }
  });

  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.9, 1.0, 1.0, 32]} />
        <meshStandardMaterial
          ref={patinaMaterialRef}
          color="#4a7c59"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[0.55, 0.9, 0]} castShadow>
        <torusGeometry args={[0.2, 0.06, 16, 32, Math.PI]} />
        <meshStandardMaterial
          color="#8b4513"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[-0.55, 0.9, 0]} castShadow>
        <torusGeometry args={[0.2, 0.06, 16, 32, Math.PI]} />
        <meshStandardMaterial
          color="#8b4513"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[0.55, -0.3, 0]} castShadow rotation={[0, 0, -0.2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.5, 16]} />
        <meshStandardMaterial
          color="#654321"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[-0.275, -0.3, 0.476]} castShadow rotation={[0.1, 0, 0.2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.5, 16]} />
        <meshStandardMaterial
          color="#654321"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[-0.275, -0.3, -0.476]} castShadow rotation={[-0.1, 0, 0.2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.5, 16]} />
        <meshStandardMaterial
          color="#654321"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[0, 0.6, 0.91]} castShadow>
        <boxGeometry args={[0.8, 0.3, 0.02]} />
        <meshStandardMaterial
          color="#5c3a21"
          metalness={0.7}
          roughness={0.6}
        />
      </mesh>
    </group>
  );
};

interface RepairRegionSphereProps {
  region: RepairRegion;
  isError: boolean;
  isGlow: boolean;
}

const RepairRegionSphere = ({ region, isError, isGlow }: RepairRegionSphereProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const errorStartRef = useRef<number | null>(null);
  const glowStartRef = useRef<number | null>(null);

  const pressRegion = useRepairStore(s => s.pressRegion);
  const enterRegion = useRepairStore(s => s.enterRegion);
  const settleRegion = useRepairStore(s => s.settleRegion);
  const advanceRegion = useRepairStore(s => s.advanceRegion);

  useEffect(() => {
    if (isError) errorStartRef.current = Date.now();
  }, [isError]);

  useEffect(() => {
    if (isGlow) glowStartRef.current = Date.now();
  }, [isGlow]);

  useFrame((_, delta) => {
    if (region.status === 'in-progress') {
      advanceRegion(region.id, delta);
    }

    if (!meshRef.current) return;
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    const baseColor = getStatusColor(region.status);

    if (isError && errorStartRef.current !== null) {
      const elapsed = (Date.now() - errorStartRef.current) / 1000;
      if (elapsed < ERROR_FLASH_SECONDS) {
        const flash = Math.floor(elapsed / 0.15);
        material.color.set('#dc2626');
        material.opacity = flash % 2 === 0 ? 0.85 : 0.15;
        return;
      }
    }

    material.color.set(baseColor);
    if (region.status === 'in-progress') {
      material.opacity = 0.35 + region.progress * 0.5;
    } else {
      material.opacity = 0.3;
    }

    if (glowRef.current) {
      if (isGlow && glowStartRef.current !== null) {
        const elapsed = (Date.now() - glowStartRef.current) / 1000;
        const t = Math.min(elapsed / GLOW_SECONDS, 1);
        glowRef.current.visible = true;
        glowRef.current.scale.setScalar(1 + t * 0.6);
        const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
        glowMat.opacity = (1 - t) * 0.6;
      } else {
        glowRef.current.visible = false;
      }
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pressRegion(region.id);
  };

  const handlePointerEnter = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    enterRegion(region.id);
  };

  const handlePointerLeave = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    settleRegion(region.id);
  };

  return (
    <group position={region.position}>
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <sphereGeometry args={[region.radius, 32, 32]} />
        <meshBasicMaterial
          color={getStatusColor(region.status)}
          transparent
          opacity={0.3}
        />
      </mesh>

      <mesh ref={glowRef} visible={false}>
        <sphereGeometry args={[region.radius, 32, 32]} />
        <meshBasicMaterial
          color="#ffd700"
          transparent
          opacity={0.6}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
};

const SceneContent = () => {
  const regions = useRepairStore(s => s.regions);
  const selectedTool = useRepairStore(s => s.selectedTool);
  const errorRegionId = useRepairStore(s => s.errorRegionId);
  const glowRegionId = useRepairStore(s => s.glowRegionId);

  const patinaRegions = regions.filter(r => r.type === 'patina');
  const patinaProgress = patinaRegions.length === 0
    ? 0
    : patinaRegions.reduce((sum, r) => sum + (r.status === 'completed' ? 1 : r.progress), 0) / patinaRegions.length;

  return (
    <>
      <Lighting />
      <RepairTable />
      <BronzeDing patinaProgress={patinaProgress} />
      {regions.map(region => (
        <RepairRegionSphere
          key={region.id}
          region={region}
          isError={errorRegionId === region.id}
          isGlow={glowRegionId === region.id}
        />
      ))}
      <OrbitControls
        enabled={!selectedTool}
        enablePan={false}
        minDistance={3}
        maxDistance={12}
        minPolarAngle={Math.PI / 12}
        maxPolarAngle={Math.PI * 5 / 12}
        autoRotate={!selectedTool}
        autoRotateSpeed={0.5}
      />
    </>
  );
};

const DebugBridge = () => {
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  const controls = useThree(s => s.controls);

  useEffect(() => {
    const w = window as unknown as { __repairDebug?: unknown };
    w.__repairDebug = {
      camera,
      controls,
      project: (p: [number, number, number]) => {
        const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
    };
    return () => {
      delete w.__repairDebug;
    };
  }, [camera, size, controls]);

  return null;
};

export const RepairWorkshop = () => {
  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        camera={{ position: [5, 3, 5], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#1a1a2e']} />
        <fog attach="fog" args={['#1a1a2e', 8, 20]} />
        <SceneContent />
        <DebugBridge />
      </Canvas>
    </div>
  );
};

export default RepairWorkshop;
