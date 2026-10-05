/**
 * 浑仪三维模型：底座、蟠龙柱、七个可拆部件。
 * 部件的位置/高亮完全由状态机快照驱动：本组件只负责把
 * mountStates 映射到三维目标位姿并做平滑过渡，不在此处判断拆装规则。
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAssemblyStore } from '../store.ts';
import { PART_VISUALS, type PartVisual } from '../types.ts';
import type { MountState } from '../assembly/types.ts';

const GOLD = '#ffd700';
const HINT_FLASH = '#f1c40f';

function PartMesh({ visual, state }: { visual: PartVisual; state: MountState }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const highlightId = useAssemblyStore((s) => s.highlightId);
  const disassemble = useAssemblyStore((s) => s.disassemble);

  const target = useMemo(() => {
    if (state === 'installed') return new THREE.Vector3(0, 4.5, 0);
    if (state === 'removed') return new THREE.Vector3(...visual.removedPosition);
    return new THREE.Vector3(0, 4.5, 0);
  }, [state, visual]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // 300ms 左右的 ease-out 平滑过渡
    mesh.position.lerp(target, Math.min(1, delta * 6));
    if (state === 'removed') mesh.rotation.y += delta * 0.3;
  });

  const highlighted = highlightId === visual.id;
  const emissive = highlighted ? HINT_FLASH : hovered ? GOLD : '#000000';
  const emissiveIntensity = highlighted ? 0.9 : hovered ? 0.6 : 0;

  return (
    <mesh
      ref={meshRef}
      position={[0, 4.5, 0]}
      rotation={visual.rotation}
      onClick={(event) => {
        event.stopPropagation();
        if (state === 'installed') disassemble(visual.id);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {visual.kind === 'ring' ? (
        <torusGeometry args={[visual.radius, visual.tube ?? 0.1, 16, 96]} />
      ) : (
        <sphereGeometry args={[visual.radius, 48, 32]} />
      )}
      <meshStandardMaterial
        color={visual.color}
        metalness={0.85}
        roughness={0.3}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        transparent={state === 'removed'}
        opacity={state === 'removed' ? 0.85 : 1}
      />
    </mesh>
  );
}

function LedStrip({ lit, complete }: { lit: number; complete: boolean }) {
  const leds = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const angle = (index / 7) * Math.PI * 2;
        return [Math.cos(angle) * 3.4, 0.35, Math.sin(angle) * 3.4] as [number, number, number];
      }),
    [],
  );
  return (
    <group>
      {leds.map((position, index) => (
        <mesh key={index} position={position}>
          <sphereGeometry args={[0.14, 12, 12]} />
          <meshStandardMaterial
            color={complete ? GOLD : index < lit ? '#fff3cd' : '#555555'}
            emissive={complete ? GOLD : index < lit ? '#fff3cd' : '#000000'}
            emissiveIntensity={complete ? 1 : index < lit ? 0.7 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function Sphere() {
  const snapshot = useAssemblyStore((s) => s.snapshot);
  const progress = snapshot.progress;
  const spinRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    // 全部装回后整体缓慢自转（约 30 秒一圈）
    if (progress.complete && spinRef.current) {
      spinRef.current.rotation.y += delta * ((Math.PI * 2) / 30);
    }
  });

  return (
    <group>
      {/* 方台底座 */}
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[7, 1, 7]} />
        <meshStandardMaterial color="#2d5a27" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[5.5, 0.4, 5.5]} />
        <meshStandardMaterial color="#2d5a27" roughness={0.8} />
      </mesh>
      {/* 四根蟠龙铜柱 */}
      {[
        [2.2, 0, 2.2],
        [-2.2, 0, 2.2],
        [2.2, 0, -2.2],
        [-2.2, 0, -2.2],
      ].map(([x, , z], index) => (
        <mesh key={index} position={[x, 2.2, z]}>
          <cylinderGeometry args={[0.22, 0.3, 4.2, 12]} />
          <meshStandardMaterial color="#8b5e3c" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}
      <LedStrip lit={progress.assembled} complete={progress.complete} />
      {/* 七个可拆部件 */}
      <group ref={spinRef}>
        {PART_VISUALS.map((visual) => (
          <PartMesh
            key={visual.id}
            visual={visual}
            state={snapshot.mountStates[visual.id] ?? 'installed'}
          />
        ))}
      </group>
    </group>
  );
}
