import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomConfig, MATERIAL_PROPS, WallType, WALL_LABELS } from '@/types';

interface RoomProps {
  config: RoomConfig;
  selectedWall: WallType | null;
  onWallSelect: (wall: WallType | null) => void;
}

interface WallMeshProps {
  wallType: WallType;
  position: [number, number, number];
  rotation?: [number, number, number];
  size: [number, number];
  material: string;
  selected: boolean;
  onClick: (e: any) => void;
  onPointerOver: (e: any) => void;
  onPointerOut: (e: any) => void;
}

function WallMesh({
  wallType,
  position,
  rotation = [0, 0, 0],
  size,
  material,
  selected,
  onClick,
  onPointerOver,
  onPointerOut,
}: WallMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const glowOpacity = useRef(0);

  const materialProps = MATERIAL_PROPS[material as keyof typeof MATERIAL_PROPS];
  const isGlass = material === 'glass';

  useFrame((_, delta) => {
    const targetOpacity = selected ? 0.8 : 0;
    glowOpacity.current += (targetOpacity - glowOpacity.current) * delta * 5;

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = glowOpacity.current;
    }
  });

  const wallMaterial = useMemo(() => {
    if (isGlass) {
      return new THREE.MeshPhysicalMaterial({
        color: materialProps.color,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.9,
        thickness: 0.5,
        side: THREE.DoubleSide,
      });
    }
    return new THREE.MeshStandardMaterial({
      color: materialProps.color,
      roughness: material === 'metal' ? 0.2 : 0.7,
      metalness: material === 'metal' ? 0.9 : 0.1,
      side: THREE.DoubleSide,
    });
  }, [material, isGlass, materialProps.color, materialProps.roughness]);

  const glowMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: '#e94560',
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
    });
  }, []);

  return (
    <group position={position} rotation={rotation as any}>
      <mesh
        ref={meshRef}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <planeGeometry args={size} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>
      {selected && (
        <mesh ref={glowRef} scale={1.05}>
          <planeGeometry args={size} />
          <primitive object={glowMaterial} attach="material" />
        </mesh>
      )}
    </group>
  );
}

export function Room({ config, selectedWall, onWallSelect }: RoomProps) {
  const hw = config.width / 2;
  const hh = config.height / 2;
  const hd = config.depth / 2;

  const handleWallClick = (wall: WallType) => (e: any) => {
    e.stopPropagation();
    onWallSelect(selectedWall === wall ? null : wall);
  };

  const handlePointerOver = (wall: WallType) => (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = () => {
    document.body.style.cursor = 'default';
  };

  const walls: Array<{
    type: WallType;
    position: [number, number, number];
    rotation: [number, number, number];
    size: [number, number];
  }> = [
    {
      type: 'back',
      position: [0, 0, -hd],
      rotation: [0, 0, 0],
      size: [config.width, config.height],
    },
    {
      type: 'left',
      position: [-hw, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      size: [config.depth, config.height],
    },
    {
      type: 'right',
      position: [hw, 0, 0],
      rotation: [0, -Math.PI / 2, 0],
      size: [config.depth, config.height],
    },
    {
      type: 'floor',
      position: [0, -hh, 0],
      rotation: [-Math.PI / 2, 0, 0],
      size: [config.width, config.depth],
    },
    {
      type: 'ceiling',
      position: [0, hh, 0],
      rotation: [Math.PI / 2, 0, 0],
      size: [config.width, config.depth],
    },
  ];

  return (
    <group>
      {walls.map((wall) => (
        <WallMesh
          key={wall.type}
          wallType={wall.type}
          position={wall.position}
          rotation={wall.rotation}
          size={wall.size}
          material={config.walls[wall.type]}
          selected={selectedWall === wall.type}
          onClick={handleWallClick(wall.type)}
          onPointerOver={handlePointerOver(wall.type)}
          onPointerOut={handlePointerOut}
        />
      ))}
      <lineSegments>
        <edgesGeometry
          args={[
            new THREE.BoxGeometry(config.width, config.height, config.depth),
          ]}
        />
        <lineBasicMaterial color="#0f3460" transparent opacity={0.5} />
      </lineSegments>
    </group>
  );
}
