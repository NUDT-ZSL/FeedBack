import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RayData, HitDetail } from '@/types';

interface RaysProps {
  rays: RayData[];
  active: boolean;
  onHitClick: (detail: HitDetail) => void;
}

export function Rays({ rays, active, onHitClick }: RaysProps) {
  const linesRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Group>(null);
  const hitPointsRef = useRef<THREE.Group>(null);
  const animTime = useRef(0);

  const { lineGroup, hitPointGroup } = useMemo(() => {
    const group = new THREE.Group();
    const hitsGroup = new THREE.Group();

    rays.forEach((ray, rayIndex) => {
      const points = ray.path.map((p) => new THREE.Vector3(...p));

      for (let i = 0; i < points.length - 1; i++) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          points[i],
          points[i + 1],
        ]);

        const energy = ray.energies[i + 1] || ray.energies[i];
        const lineWidth = Math.max(0.5, 3 - i * 0.5);
        const opacity = Math.max(0.1, energy * 0.9);

        const material = new THREE.LineBasicMaterial({
          color: new THREE.Color('#ffdd57'),
          transparent: true,
          opacity: opacity,
        });

        const line = new THREE.Line(geometry, material);
        line.userData = {
          rayId: ray.id,
          segmentIndex: i,
          energy: energy,
        };
        group.add(line);
      }

      ray.bounces.forEach((bounce, bounceIndex) => {
        const hitGeom = new THREE.SphereGeometry(0.08, 16, 16);
        const hitMat = new THREE.MeshBasicMaterial({
          color: '#ff6600',
          transparent: true,
          opacity: bounce.energyRemaining,
        });
        const hitMesh = new THREE.Mesh(hitGeom, hitMat);
        hitMesh.position.set(...bounce.position);
        hitMesh.userData = {
          type: 'bounce',
          rayId: ray.id,
          bounceIndex,
          ...bounce,
        };
        hitsGroup.add(hitMesh);
      });
    });

    return { lineGroup: group, hitPointGroup: hitsGroup };
  }, [rays]);

  useFrame((_, delta) => {
    if (!active) return;
    animTime.current += delta;

    if (hitPointsRef.current) {
      hitPointsRef.current.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        const pulse = 1 + Math.sin(animTime.current * 4 + mesh.userData.rayId) * 0.3;
        mesh.scale.setScalar(pulse);
      });
    }
  });

  const handleRayClick = (e: any) => {
    e.stopPropagation();
    const userData = e.object.userData;
    if (userData.type === 'bounce') {
      onHitClick({
        type: 'bounce',
        rayId: userData.rayId,
        bounceIndex: userData.bounceIndex,
        position: userData.position,
        incidentAngle: userData.incidentAngle,
        reflectAngle: userData.reflectAngle,
        energyRemaining: userData.energyRemaining,
        material: userData.material,
        wall: userData.wall,
      });
    } else {
      onHitClick({
        type: 'ray',
        rayId: userData.rayId,
        position: [e.point.x, e.point.y, e.point.z],
      });
    }
  };

  const handlePointerOver = (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = () => {
    document.body.style.cursor = 'default';
  };

  if (!active || rays.length === 0) return null;

  return (
    <group>
      <primitive
        object={lineGroup}
        ref={linesRef as any}
        onClick={handleRayClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      />
      <primitive
        object={hitPointGroup}
        ref={hitPointsRef as any}
        onClick={handleRayClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      />
    </group>
  );
}
