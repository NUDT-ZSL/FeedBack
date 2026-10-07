import { useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RepairRegion, ToolType } from '@/types';

interface RepairWorkshopProps {
  regions: RepairRegion[];
  selectedTool: ToolType | null;
  isDragging: boolean;
  onRepairComplete: (regionId: string, toolType: ToolType) => void;
}

interface RegionAnimation {
  type: 'patina' | 'engraving' | 'glow' | 'error' | null;
  progress: number;
  startTime: number;
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'in-progress': return '#f59e0b';
    default: return '#ef4444';
  }
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
  animations: Map<string, RegionAnimation>;
}

const BronzeDing = ({ animations }: BronzeDingProps) => {
  const bodyRef = useRef<THREE.Mesh>(null);
  const patinaMaterialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    animations.forEach((anim) => {
      if (anim.type === 'patina' && patinaMaterialRef.current) {
        const progress = Math.min(anim.progress / 0.8, 1);
        const color = new THREE.Color().lerpColors(
          new THREE.Color('#4a7c59'),
          new THREE.Color('#b87333'),
          progress
        );
        patinaMaterialRef.current.color = color;
      }
    });
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
  selectedTool: ToolType | null;
  isDragging: boolean;
  onRegionPointerDown: (regionId: string) => void;
  onRegionPointerUp: (regionId: string) => void;
  animState: RegionAnimation | undefined;
}

const RepairRegionSphere = ({
  region,
  selectedTool,
  isDragging,
  onRegionPointerDown,
  onRegionPointerUp,
  animState,
}: RepairRegionSphereProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const engravingRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;

    const color = getStatusColor(region.status);
    const material = meshRef.current.material as THREE.MeshBasicMaterial;

    if (animState) {
      if (animState.type === 'error') {
        const elapsed = (Date.now() - animState.startTime) / 1000;
        const flashCount = Math.floor(elapsed / 0.3);
        if (flashCount < 6) {
          material.opacity = flashCount % 2 === 0 ? 0.8 : 0.1;
          material.color.set('#dc2626');
        } else {
          material.opacity = 0.3;
          material.color.set(color);
        }
      }

      if (animState.type === 'glow' && glowRef.current) {
        const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
        const progress = Math.min(animState.progress / 1.0, 1);
        glowRef.current.scale.setScalar(1 + progress * 0.6);
        glowMat.opacity = (1 - progress) * 0.6;
      }

      if (animState.type === 'engraving' && engravingRef.current) {
        const engMat = engravingRef.current.material as THREE.MeshBasicMaterial;
        const progress = Math.min(animState.progress / 0.5, 1);
        engravingRef.current.scale.setScalar(progress);
        engMat.opacity = progress * 0.8;
      }
    } else {
      material.opacity = 0.3;
      material.color.set(color);
    }

    if (isDragging && selectedTool) {
      material.opacity = 0.5;
    }
  });

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (region.status !== 'completed' && selectedTool && isDragging) {
      onRegionPointerDown(region.id);
    }
  }, [region.id, region.status, selectedTool, isDragging, onRegionPointerDown]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (region.status !== 'completed' && selectedTool && isDragging) {
      onRegionPointerUp(region.id);
    }
  }, [region.id, region.status, selectedTool, isDragging, onRegionPointerUp]);

  return (
    <group position={region.position}>
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[region.radius, 32, 32]} />
        <meshBasicMaterial
          color={getStatusColor(region.status)}
          transparent
          opacity={0.3}
        />
      </mesh>

      <mesh ref={glowRef} scale={1} visible={!!(animState?.type === 'glow')}>
        <sphereGeometry args={[region.radius, 32, 32]} />
        <meshBasicMaterial
          color="#ffd700"
          transparent
          opacity={0.6}
          side={THREE.BackSide}
        />
      </mesh>

      <mesh ref={engravingRef} scale={0} visible={!!(animState?.type === 'engraving')}>
        <sphereGeometry args={[region.radius * 0.9, 32, 32]} />
        <meshBasicMaterial
          color="#5c3a21"
          transparent
          opacity={0}
          wireframe
        />
      </mesh>
    </group>
  );
};

interface SceneContentProps {
  regions: RepairRegion[];
  selectedTool: ToolType | null;
  isDragging: boolean;
  onRepairComplete: (regionId: string, toolType: ToolType) => void;
  animations: Map<string, RegionAnimation>;
  setAnimations: React.Dispatch<React.SetStateAction<Map<string, RegionAnimation>>>;
  activeRegions: Set<string>;
}

const SceneContent = ({
  regions,
  selectedTool,
  isDragging,
  onRepairComplete,
  animations,
  setAnimations,
  activeRegions,
}: SceneContentProps) => {
  const handleRegionPointerDown = useCallback((regionId: string) => {
    if (!selectedTool || !isDragging) return;
    const region = regions.find(r => r.id === regionId);
    if (!region || region.status === 'completed') return;

    setAnimations(prev => {
      const next = new Map(prev);
      next.set(regionId, {
        type: region.type as 'patina' | 'engraving',
        progress: 0,
        startTime: Date.now(),
      });
      return next;
    });
  }, [selectedTool, isDragging, regions, setAnimations]);

  const handleRegionPointerUp = useCallback((regionId: string) => {
    if (!selectedTool || !isDragging) return;
    const region = regions.find(r => r.id === regionId);
    if (!region || region.status === 'completed') return;

    if (region.requiredTool === selectedTool) {
      setTimeout(() => {
        setAnimations(prev => {
          const next = new Map(prev);
          next.set(regionId, {
            type: 'glow',
            progress: 0,
            startTime: Date.now(),
          });
          return next;
        });

        setTimeout(() => {
          onRepairComplete(regionId, selectedTool);
          setAnimations(prev => {
            const next = new Map(prev);
            next.delete(regionId);
            return next;
          });
        }, 1000);
      }, 800);
    } else {
      setAnimations(prev => {
        const next = new Map(prev);
        next.set(regionId, {
          type: 'error',
          progress: 0,
          startTime: Date.now(),
        });
        return next;
      });

      setTimeout(() => {
        setAnimations(prev => {
          const next = new Map(prev);
          next.delete(regionId);
          return next;
        });
      }, 1800);
    }
  }, [selectedTool, isDragging, regions, onRepairComplete, setAnimations]);

  useFrame((_, delta) => {
    setAnimations(prev => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((anim, key) => {
        const newProgress = anim.progress + delta;
        const duration = anim.type === 'patina' ? 0.8 :
                        anim.type === 'engraving' ? 0.5 :
                        anim.type === 'glow' ? 1.0 : 1.8;
        if (newProgress <= duration) {
          next.set(key, { ...anim, progress: newProgress });
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  });

  return (
    <>
      <Lighting />
      <RepairTable />
      <BronzeDing animations={animations} />
      {regions.map(region => (
        <RepairRegionSphere
          key={region.id}
          region={region}
          selectedTool={selectedTool}
          isDragging={isDragging}
          onRegionPointerDown={handleRegionPointerDown}
          onRegionPointerUp={handleRegionPointerUp}
          animState={animations.get(region.id)}
        />
      ))}
      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={12}
        minPolarAngle={Math.PI / 12}
        maxPolarAngle={Math.PI * 5 / 12}
        autoRotate={!isDragging && activeRegions.size === 0}
        autoRotateSpeed={0.5}
      />
    </>
  );
};

export const RepairWorkshop = ({
  regions,
  selectedTool,
  isDragging,
  onRepairComplete,
}: RepairWorkshopProps) => {
  const [animations, setAnimations] = useState<Map<string, RegionAnimation>>(new Map());
  const [activeRegions, setActiveRegions] = useState<Set<string>>(new Set());

  useEffect(() => {
    const active = new Set<string>();
    animations.forEach((_, key) => active.add(key));
    setActiveRegions(active);
  }, [animations]);

  return (
    <div className="w-full h-full">
      <Canvas
        shadows
        camera={{ position: [5, 3, 5], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#1a1a2e']} />
        <fog attach="fog" args={['#1a1a2e', 8, 20]} />
        <SceneContent
          regions={regions}
          selectedTool={selectedTool}
          isDragging={isDragging}
          onRepairComplete={onRepairComplete}
          animations={animations}
          setAnimations={setAnimations}
          activeRegions={activeRegions}
        />
      </Canvas>
    </div>
  );
};

export default RepairWorkshop;
