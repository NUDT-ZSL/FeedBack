import { useRef, useState, useCallback, useEffect, MutableRefObject } from 'react';
import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RepairRegion, ToolType } from '@/types';
import { useRepairStore } from '@/store/useRepairStore';

interface RegionAnimation {
  type: 'glow' | 'error';
  progress: number;
  startTime: number;
}

const PENDING_COLOR = '#ef4444';
const PROGRESS_START_COLOR = '#f59e0b';
const COMPLETED_COLOR = '#22c55e';
const ERROR_COLOR = '#dc2626';

const getRegionTargetColor = (region: RepairRegion): THREE.Color => {
  if (region.status === 'completed') return new THREE.Color(COMPLETED_COLOR);
  if (region.status === 'in-progress') {
    return new THREE.Color().lerpColors(
      new THREE.Color(PROGRESS_START_COLOR),
      new THREE.Color(COMPLETED_COLOR),
      Math.min(region.progress, 1),
    );
  }
  return new THREE.Color(PENDING_COLOR);
};

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

interface BronzeDingProps {
  patinaProgress: number;
}

const BronzeDing = ({ patinaProgress }: BronzeDingProps) => {
  const bodyRef = useRef<THREE.Mesh>(null);
  const patinaMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (!patinaMaterialRef.current) return;
    const target = new THREE.Color().lerpColors(
      new THREE.Color('#4a7c59'),
      new THREE.Color('#b87333'),
      Math.min(patinaProgress, 1),
    );
    patinaMaterialRef.current.color = target;
  });

  return (
    <group>
      <mesh ref={bodyRef} position={[0, 0.3, 0]} castShadow>
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
  isDragging: boolean;
  onRegionEnter: (regionId: string) => void;
  onRegionLeave: (regionId: string) => void;
  animState: RegionAnimation | undefined;
}

const RepairRegionSphere = ({
  region,
  isDragging,
  onRegionEnter,
  onRegionLeave,
  animState,
}: RepairRegionSphereProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;

    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    const target = getRegionTargetColor(region);

    if (animState?.type === 'error') {
      const elapsed = (Date.now() - animState.startTime) / 1000;
      const flashCount = Math.floor(elapsed / 0.3);
      if (flashCount < 6) {
        material.opacity = flashCount % 2 === 0 ? 0.8 : 0.1;
        material.color.set(ERROR_COLOR);
      } else {
        material.color.copy(target);
        material.opacity = 0.3;
      }
    } else {
      material.color.copy(target);
      material.opacity =
        region.status === 'in-progress' ? 0.3 + region.progress * 0.4 : 0.3;
      if (isDragging) material.opacity = Math.max(material.opacity, 0.5);
    }

    if (glowRef.current) {
      const glowMaterial = glowRef.current.material as THREE.MeshBasicMaterial;
      if (animState?.type === 'glow') {
        const progress = Math.min(animState.progress / 1.0, 1);
        glowRef.current.visible = true;
        glowRef.current.scale.setScalar(1 + progress * 0.6);
        glowMaterial.opacity = (1 - progress) * 0.6;
      } else {
        glowRef.current.visible = false;
      }
    }
  });

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onRegionEnter(region.id);
  }, [region.id, onRegionEnter]);

  const handlePointerOut = useCallback(() => {
    onRegionLeave(region.id);
  }, [region.id, onRegionLeave]);

  return (
    <group position={region.position}>
      <mesh
        ref={meshRef}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[region.radius, 32, 32]} />
        <meshBasicMaterial
          color={PENDING_COLOR}
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

interface SceneContentProps {
  animations: Map<string, RegionAnimation>;
  setAnimations: React.Dispatch<React.SetStateAction<Map<string, RegionAnimation>>>;
  hoveredRegionsRef: MutableRefObject<Set<string>>;
  activeToolRef: MutableRefObject<ToolType | null>;
}

const SceneContent = ({
  animations,
  setAnimations,
  hoveredRegionsRef,
  activeToolRef,
}: SceneContentProps) => {
  const regions = useRepairStore(state => state.regions);
  const selectedTool = useRepairStore(state => state.selectedTool);
  const isDragging = useRepairStore(state => state.isDragging);
  const beginRegionRepair = useRepairStore(state => state.beginRegionRepair);
  const advanceRegionRepair = useRepairStore(state => state.advanceRegionRepair);

  const handleRegionEnter = useCallback((regionId: string) => {
    hoveredRegionsRef.current.add(regionId);
    const tool = activeToolRef.current;
    if (!tool) return;

    const region = useRepairStore.getState().regions.find(r => r.id === regionId);
    if (!region || region.status === 'completed') return;

    if (region.requiredTool === tool) {
      beginRegionRepair(regionId, tool);
      return;
    }

    setAnimations(prev => {
      const next = new Map(prev);
      next.set(regionId, {
        type: 'error',
        progress: 0,
        startTime: Date.now(),
      });
      return next;
    });
  }, [beginRegionRepair, hoveredRegionsRef, activeToolRef, setAnimations]);

  const handleRegionLeave = useCallback((regionId: string) => {
    hoveredRegionsRef.current.delete(regionId);
  }, [hoveredRegionsRef]);

  useFrame((_, delta) => {
    if (useRepairStore.getState().isDragging) {
      hoveredRegionsRef.current.forEach(regionId => {
        advanceRegionRepair(regionId, delta);
      });
    }

    setAnimations(prev => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((anim, key) => {
        const duration = anim.type === 'glow' ? 1.0 : 1.8;
        const newProgress = anim.progress + delta;
        if (newProgress > duration) {
          next.delete(key);
        } else {
          next.set(key, { ...anim, progress: newProgress });
        }
        changed = true;
      });
      return changed ? next : prev;
    });
  });

  const patinaRegions = regions.filter(region => region.type === 'patina');
  const patinaProgress = patinaRegions.length === 0 ? 0 :
    patinaRegions.reduce(
      (sum, region) => sum + (region.status === 'completed' ? 1 : region.progress),
      0,
    ) / patinaRegions.length;

  return (
    <>
      <Lighting />
      <RepairTable />
      <BronzeDing patinaProgress={patinaProgress} />
      {regions.map(region => (
        <RepairRegionSphere
          key={region.id}
          region={region}
          isDragging={isDragging}
          onRegionEnter={handleRegionEnter}
          onRegionLeave={handleRegionLeave}
          animState={animations.get(region.id)}
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

export const RepairWorkshop = () => {
  const selectedTool = useRepairStore(state => state.selectedTool);
  const setIsDragging = useRepairStore(state => state.setIsDragging);
  const setDragPosition = useRepairStore(state => state.setDragPosition);
  const settleAllRegions = useRepairStore(state => state.settleAllRegions);

  const [animations, setAnimations] = useState<Map<string, RegionAnimation>>(new Map());
  const hoveredRegionsRef = useRef<Set<string>>(new Set());
  const activeToolRef = useRef<ToolType | null>(null);
  const draggingRef = useRef(false);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;

    const tool = activeToolRef.current;
    activeToolRef.current = null;
    hoveredRegionsRef.current.clear();

    if (tool) {
      const completedRegionIds = settleAllRegions(tool);
      if (completedRegionIds.length > 0) {
        setAnimations(prev => {
          const next = new Map(prev);
          completedRegionIds.forEach(regionId => {
            next.set(regionId, {
              type: 'glow',
              progress: 0,
              startTime: Date.now(),
            });
          });
          return next;
        });
      }
    }

    setIsDragging(false);
    setDragPosition(null);
  }, [settleAllRegions, setIsDragging, setDragPosition]);

  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [endDrag]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedTool || e.button !== 0) return;
    activeToolRef.current = selectedTool;
    draggingRef.current = true;
    setIsDragging(true);
    setDragPosition({ x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setDragPosition({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className="w-full h-full"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <Canvas
        shadows
        camera={{ position: [5, 3, 5], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#1a1a2e']} />
        <fog attach="fog" args={['#1a1a2e', 8, 20]} />
        <SceneContent
          animations={animations}
          setAnimations={setAnimations}
          hoveredRegionsRef={hoveredRegionsRef}
          activeToolRef={activeToolRef}
        />
      </Canvas>
    </div>
  );
};

export default RepairWorkshop;
