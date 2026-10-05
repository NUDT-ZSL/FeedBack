/**
 * 浑仪部件渲染：三层嵌套环体 + 内球。
 * 点击选中高亮；向外拖拽一段距离即发起拆卸（结果由状态机裁决）；
 * 点击已拆下的部件发起装回。位置用阻尼插值平滑过渡。
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, Vector3 } from 'three';
import { useAssemblyStore } from '../store.ts';
import { PART_VISUALS, rackPosition } from '../types.ts';
import type { PartId } from '../types.ts';

const BRONZE = '#8b5e3c';
const GOLD = '#ffd700';
const HINT = '#f1c40f';
const DRAG_THRESHOLD_PX = 40;

function Part({ id }: { id: PartId }) {
  const visual = PART_VISUALS[id];
  const installed = useAssemblyStore((s) => s.session.installed[id] !== false);
  const selected = useAssemblyStore((s) => s.selected === id);
  const hinted = useAssemblyStore((s) => s.hinted === id);
  const detach = useAssemblyStore((s) => s.detach);
  const attach = useAssemblyStore((s) => s.attach);
  const select = useAssemblyStore((s) => s.select);

  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const target = useRef(new Vector3(0, 0, 0));
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const clock = useRef(0);

  target.current.set(...(installed ? [0, 0, 0] : rackPosition(visual.rackIndex)) as [
    number,
    number,
    number,
  ]);

  useFrame((_, delta) => {
    clock.current += delta;
    group.current?.position.lerp(target.current, Math.min(1, delta * 6));
    const material = (mesh.current?.material as { emissive?: { set: (c: string) => void }; emissiveIntensity?: number }) ?? {};
    if (hinted) {
      const blink = Math.sin(clock.current * Math.PI * 2 * 1.6) > 0;
      material.emissive?.set(blink ? HINT : BRONZE);
      if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.9;
    } else if (selected) {
      material.emissive?.set(GOLD);
      if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.7;
    } else {
      material.emissive?.set(BRONZE);
      if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.15;
    }
  });

  return (
    <group ref={group} rotation={visual.rotation}>
      <mesh
        ref={mesh}
        onClick={(e) => {
          e.stopPropagation();
          if (installed) {
            select(id);
          } else {
            attach(id);
          }
        }}
        onPointerDown={(e) => {
          pointerDown.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const start = pointerDown.current;
          pointerDown.current = null;
          if (!start || !installed) return;
          const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
          if (dist > DRAG_THRESHOLD_PX) {
            e.stopPropagation();
            detach(id);
          }
        }}
      >
        {visual.isSphere ? (
          <sphereGeometry args={[visual.radius, 48, 32]} />
        ) : (
          <torusGeometry args={[visual.radius, visual.tube, 24, 96]} />
        )}
        <meshStandardMaterial
          color={BRONZE}
          metalness={0.85}
          roughness={0.35}
          transparent={!installed}
          opacity={installed ? 1 : 0.7}
        />
      </mesh>
    </group>
  );
}

export default function Sphere() {
  const partIds = useAssemblyStore((s) => s.session.config.parts.map((p) => p.id));
  return (
    <group>
      {partIds.map((id) => (
        <Part key={id} id={id} />
      ))}
    </group>
  );
}
