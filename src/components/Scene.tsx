// 渲染层：只消费 SimulationFrame 中的位置与遮挡结论，不计算角度。
import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  DEFAULT_RING_ORIENTATION,
  RING_COLORS,
  RING_KEYS,
  RING_LABELS,
  ringFrame,
  type BodyVisibility,
  type RingKey,
  type SimulationFrame
} from '../engine/index.ts';
import { ZODIAC_SIGNS } from '../types.ts';

const ARM_RADIUS = 5;

function axisQuaternion(inclination: number, azimuth: number): THREE.Quaternion {
  const frame = ringFrame(inclination, azimuth);
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(frame.axis[0], frame.axis[1], frame.axis[2])
  );
}

function zodiacTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#141428';
  ctx.fillRect(0, 0, 1024, 1024);
  const grad = ctx.createRadialGradient(512, 512, 40, 512, 512, 500);
  grad.addColorStop(0, '#1d2340');
  grad.addColorStop(1, '#10101f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = 'rgba(255,215,0,0.25)';
  ctx.lineWidth = 2;
  for (const r of [180, 320, 460]) {
    ctx.beginPath();
    ctx.arc(512, 512, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = '42px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ZODIAC_SIGNS.forEach((z, i) => {
    const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x = 512 + Math.cos(ang) * 390;
    const y = 512 + Math.sin(ang) * 390;
    ctx.fillStyle = 'rgba(255,215,0,0.85)';
    ctx.fillText(z.symbol, x, y - 22);
    ctx.font = '22px "Noto Serif SC", serif';
    ctx.fillStyle = 'rgba(200,190,150,0.8)';
    ctx.fillText(z.name, x, y + 24);
    ctx.font = '42px serif';
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function Platform() {
  const ref = useRef<THREE.Group>(null);
  const texture = useMemo(() => zodiacTexture(), []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += (Math.PI * 2 / 60) * delta;
  });
  return (
    <group ref={ref} position={[0, -5.2, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6, 96]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.3, 0]}>
        <cylinderGeometry args={[6, 6.4, 0.6, 96]} />
        <meshStandardMaterial color="#2a2a3e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.6, 4.75, 96]} />
        <meshBasicMaterial color="#ffd700" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function CentralStar({ onClick }: { onClick: () => void }) {
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (glow.current) {
      const s = 1 + 0.18 * Math.sin((t * Math.PI * 2) / 2);
      glow.current.scale.setScalar(s);
      (glow.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin((t * Math.PI * 2) / 2);
    }
  });
  return (
    <group>
      <mesh ref={glow}>
        <sphereGeometry args={[0.9, 32, 32]} />
        <meshBasicMaterial color="#ffd700" transparent opacity={0.25} />
      </mesh>
      <mesh ref={core} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color="#ffd700" emissive="#b8860b" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

interface RingProps {
  ringKey: RingKey;
  tilt: number;
  dragging: RingKey | null;
  onDragStart: (key: RingKey) => void;
  onDrag: (dy: number) => void;
  onDragEnd: () => void;
}

function StarRing({ ringKey, tilt, dragging, onDragStart, onDrag, onDragEnd }: RingProps) {
  const azimuth = DEFAULT_RING_ORIENTATION[ringKey].azimuth;
  const quaternion = useMemo(() => axisQuaternion(tilt, azimuth), [tilt, azimuth]);
  const frame = useMemo(() => ringFrame(tilt, azimuth), [tilt, azimuth]);
  const handlePos: [number, number, number] = [frame.u[0] * ARM_RADIUS, frame.u[1] * ARM_RADIUS, frame.u[2] * ARM_RADIUS];
  return (
    <group quaternion={quaternion}>
      <mesh>
        <torusGeometry args={[ARM_RADIUS, 0.035, 12, 160]} />
        <meshStandardMaterial
          color={RING_COLORS[ringKey]}
          emissive={RING_COLORS[ringKey]}
          emissiveIntensity={dragging === ringKey ? 0.8 : 0.25}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh
        position={handlePos}
        onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); onDragStart(ringKey); }}
        onPointerMove={(e) => { if (dragging === ringKey && e.nativeEvent.movementY !== 0) onDrag(e.nativeEvent.movementY); }}
        onPointerUp={() => { if (dragging === ringKey) onDragEnd(); }}
        onPointerLeave={() => { if (dragging === ringKey) onDragEnd(); }}
      >
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color={RING_COLORS[ringKey]} emissive={RING_COLORS[ringKey]} emissiveIntensity={1} />
      </mesh>
      <Html position={handlePos} center distanceFactor={18} style={{ pointerEvents: 'none' }}>
        <div className="ring-label" style={{ color: RING_COLORS[ringKey] }}>
          {RING_LABELS[ringKey]} {Math.round(tilt)}°
        </div>
      </Html>
    </group>
  );
}

function Bodies({
  frame,
  visById,
  onPick
}: {
  frame: SimulationFrame;
  visById: Map<string, BodyVisibility>;
  onPick: (id: string) => void;
}) {
  return (
    <group>
      {frame.bodies.map((b) => {
        const vis = visById.get(b.id);
        const occluded = vis?.state === 'occluded';
        const occluding = vis?.state === 'occluding';
        return (
          <group key={b.id} position={[b.position[0], b.position[1], b.position[2]]}>
            <mesh onClick={(e) => { e.stopPropagation(); onPick(b.id); }}>
              <sphereGeometry args={[occluded ? 0.2 : 0.3, 20, 20]} />
              <meshStandardMaterial
                color={occluded ? '#555566' : '#ffffff'}
                emissive={occluded ? '#000000' : occluding ? '#ffd700' : '#888899'}
                emissiveIntensity={occluding ? 0.8 : 0.3}
                transparent
                opacity={occluded ? 0.25 : 1}
              />
            </mesh>
            <Html center distanceFactor={16} position={[0, 0.45, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`body-label ${occluded ? 'is-occluded' : ''}`} style={{ borderColor: occluded ? '#555566' : '#ffd700' }}>
                {b.id.startsWith('body-') ? '' : b.id}
                <span className="body-state">{occluded ? '掩' : occluding ? '掩他' : '见'}</span>
              </div>
            </Html>
          </group>
        );
      })}
      {frame.bodies.map((b) => (
        <Line
          key={`beam-${b.id}`}
          points={[[0, 0, 0], [b.position[0], b.position[1], b.position[2]]]}
          color={visById.get(b.id)?.state === 'occluded' ? '#555566' : '#ffee88'}
          lineWidth={1.5}
          transparent
          opacity={0.45}
        />
      ))}
    </group>
  );
}

function ArmillarySphere() {
  return (
    <mesh>
      <sphereGeometry args={[ARM_RADIUS, 24, 16]} />
      <meshBasicMaterial color="#2e5a6b" wireframe transparent opacity={0.3} />
    </mesh>
  );
}

export interface SceneProps {
  frame: SimulationFrame;
  tilts: Record<RingKey, number>;
  onTiltChange: (tilt: Partial<Record<RingKey, number>>) => void;
  onCentralClick: () => void;
  onBodyPick: (id: string) => void;
}

export function Scene({ frame, tilts, onTiltChange, onCentralClick, onBodyPick }: SceneProps) {
  const [dragging, setDragging] = useState<RingKey | null>(null);
  const visById = useMemo(() => new Map(frame.visibilities.map((v) => [v.id, v])), [frame]);

  const handleDrag = (dy: number) => {
    if (!dragging) return;
    const next = Math.min(90, Math.max(0, tilts[dragging] - dy * 0.25));
    onTiltChange({ [dragging]: Math.round(next * 10) / 10 });
  };

  return (
    <Canvas
      camera={{ position: [0, 4, 16], fov: 50 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onPointerUp={() => setDragging(null)}
    >
      <color attach="background" args={['#10101f']} />
      <ambientLight intensity={0.55} />
      <pointLight position={[10, 12, 10]} intensity={1.2} />
      <pointLight position={[-10, -6, -8]} intensity={0.4} color="#88aaff" />
      <Platform />
      <ArmillarySphere />
      {RING_KEYS.map((key) => (
        <StarRing
          key={key}
          ringKey={key}
          tilt={tilts[key]}
          dragging={dragging}
          onDragStart={setDragging}
          onDrag={handleDrag}
          onDragEnd={() => setDragging(null)}
        />
      ))}
      <CentralStar onClick={onCentralClick} />
      <Bodies frame={frame} visById={visById} onPick={onBodyPick} />
      <OrbitControls enablePan={false} minDistance={9} maxDistance={28} enabled={dragging === null} />
    </Canvas>
  );
}
