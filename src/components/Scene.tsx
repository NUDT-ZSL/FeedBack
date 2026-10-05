/**
 * 主场景：青铜浑仪 + 深绿方台 + 四根铜柱、灯光与 OrbitControls。
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Sphere from './Sphere.tsx';

function Pedestal() {
  const pillars: [number, number][] = [
    [-2.2, -2.2],
    [2.2, -2.2],
    [-2.2, 2.2],
    [2.2, 2.2],
  ];
  return (
    <group position={[0, -4.4, 0]}>
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <boxGeometry args={[8, 0.6, 8]} />
        <meshStandardMaterial color="#2d5a27" metalness={0.3} roughness={0.7} />
      </mesh>
      {pillars.map(([x, z], i) => (
        <mesh key={i} position={[x, 1.6, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 3.2, 16]} />
          <meshStandardMaterial color="#8b5e3c" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export default function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [14, 12, 14], fov: 45 }}
      dpr={[1, 2]}
      onPointerMissed={() => undefined}
    >
      <color attach="background" args={['#bdc3c7']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={0.8} castShadow />
      <pointLight position={[0, 10, 0]} intensity={0.3} />
      <Sphere />
      <Pedestal />
      <OrbitControls
        enableDamping
        dampingFactor={0.15}
        minDistance={5}
        maxDistance={30}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
