import React, { useMemo } from 'react';
import * as THREE from 'three';

const ObservatoryGround: React.FC = () => {
  const circleGeometries = useMemo(() => {
    const geoms: THREE.RingGeometry[] = [];
    for (let i = 1; i <= 10; i++) {
      geoms.push(new THREE.RingGeometry(i - 0.005, i + 0.005, 64));
    }
    return geoms;
  }, []);

  return (
    <group position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh receiveShadow>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial
          color="#d4c9b3"
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>

      {circleGeometries.map((geom, i) => (
        <mesh key={i} geometry={geom}>
          <meshBasicMaterial color="#888888" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}

      <mesh rotation={[0, 0, 0]}>
        <ringGeometry args={[11.5, 11.6, 64]} />
        <meshBasicMaterial color="#8b6914" />
      </mesh>
    </group>
  );
};

export default ObservatoryGround;
