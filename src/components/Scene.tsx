import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import {
  degToRad,
  type DeductionSnapshot,
  type RingConfig,
  type RingType
} from '../engine';
import { RING_COLORS } from '../types';

interface SceneProps {
  rings: RingConfig[];
  snapshot: DeductionSnapshot;
  onRingInclination(type: RingType, inclinationDeg: number): void;
  onMainStarClick(): void;
  onCameraChange(position: [number, number, number]): void;
}

function Platform() {
  const bandRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (bandRef.current) {
      bandRef.current.rotation.y += (delta * Math.PI * 2) / 60;
    }
  });
  return (
    <group position={[0, -2.8, 0]}>
      <mesh>
        <cylinderGeometry args={[6, 6.4, 0.5, 64]} />
        <meshStandardMaterial color="#2a2a3e" roughness={0.9} />
      </mesh>
      <group ref={bandRef} position={[0, 0.28, 0]}>
        {Array.from({ length: 12 }, (_, i) => {
          const angle = (i / 12) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * 5.2, 0, Math.sin(angle) * 5.2]}
              rotation={[0, -angle, 0]}
            >
              <boxGeometry args={[0.5, 0.06, 0.8]} />
              <meshStandardMaterial
                color="#8a6d3b"
                emissive="#ffd700"
                emissiveIntensity={0.15}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function ArmillarySphere() {
  return (
    <mesh>
      <sphereGeometry args={[5, 24, 16]} />
      <meshBasicMaterial color="#2e5a6b" wireframe transparent opacity={0.3} />
    </mesh>
  );
}

interface RingProps {
  config: RingConfig;
  onInclinationChange(type: RingType, inclinationDeg: number): void;
  onDragState(dragging: boolean): void;
}

/**
 * 三条环带。环的摆放严格复刻引擎 ringPointToWorld 的变换顺序：
 * 外层绕 Y 轴（升交点），内层绕 X 轴（倾角），环面位于 XZ 平面。
 * 本组件只摆放环，不计算任何星体角度。
 */
function Ring({ config, onInclinationChange, onDragState }: RingProps) {
  const dragRef = useRef<{ startY: number; startInclination: number } | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const next = drag.startInclination + (event.clientY - drag.startY) * 0.3;
      const clamped = Math.max(0, Math.min(90, next));
      if (clamped !== configRef.current.inclinationDeg) {
        onInclinationChange(configRef.current.type, clamped);
      }
    };
    const handleUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        onDragState(false);
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [onInclinationChange, onDragState]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    dragRef.current = {
      startY: event.clientY,
      startInclination: config.inclinationDeg
    };
    onDragState(true);
  };

  const color = RING_COLORS[config.type];
  return (
    <group rotation={[0, degToRad(config.nodeAngleDeg), 0]}>
      <group rotation={[degToRad(config.inclinationDeg), 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[config.radius, 0.05, 16, 128]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.45}
          />
        </mesh>
        <mesh position={[config.radius, 0, 0]} onPointerDown={handlePointerDown}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function MainStar({ onClick }: { onClick(): void }) {
  const glowRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const scale = 1 + 0.18 * Math.sin((clock.elapsedTime * Math.PI * 2) / 2);
    glowRef.current?.scale.setScalar(scale);
  });
  return (
    <group>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial
          color="#ffd700"
          emissive="#ffee88"
          emissiveIntensity={1.2}
        />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.8, 32, 32]} />
        <meshBasicMaterial color="#ffee88" transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

function CameraTracker({
  onChange
}: {
  onChange(position: [number, number, number]): void;
}) {
  const camera = useThree((state) => state.camera);
  const lastRef = useRef<[number, number, number]>([0, 0, 0]);
  useFrame(() => {
    const p = camera.position;
    if (
      Math.abs(p.x - lastRef.current[0]) > 0.04 ||
      Math.abs(p.y - lastRef.current[1]) > 0.04 ||
      Math.abs(p.z - lastRef.current[2]) > 0.04
    ) {
      lastRef.current = [p.x, p.y, p.z];
      onChange([p.x, p.y, p.z]);
    }
  });
  return null;
}

export default function Scene(props: SceneProps) {
  const [draggingRing, setDraggingRing] = useState(false);
  return (
    <Canvas camera={{ position: [0, 4, 14], fov: 50 }} style={{ background: '#1a1a2e' }}>
      <ambientLight intensity={0.55} />
      <pointLight position={[12, 12, 12]} intensity={1.1} />
      <pointLight position={[-10, -6, -8]} intensity={0.35} />
      <Platform />
      <ArmillarySphere />
      {props.rings.map((config) => (
        <Ring
          key={config.type}
          config={config}
          onInclinationChange={props.onRingInclination}
          onDragState={setDraggingRing}
        />
      ))}
      <MainStar onClick={props.onMainStarClick} />
      {props.snapshot.bodies.map((body) => (
        <mesh key={body.bodyId} position={body.position}>
          <sphereGeometry args={[0.3, 24, 24]} />
          <meshStandardMaterial
            color={RING_COLORS[body.ring]}
            emissive={RING_COLORS[body.ring]}
            emissiveIntensity={body.visible ? 0.55 : 0.05}
            transparent
            opacity={body.visible ? 1 : 0.22}
          />
        </mesh>
      ))}
      <CameraTracker onChange={props.onCameraChange} />
      <OrbitControls makeDefault enabled={!draggingRing} enablePan={false} />
    </Canvas>
  );
}
