/** 主场景：Canvas、光照与轨道控制器。 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Sphere from './Sphere.tsx';

export default function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [9, 8, 9], fov: 50 }}
      style={{ background: '#bdc3c7' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={0.8} castShadow />
      <pointLight position={[0, 10, 0]} intensity={0.3} />
      <Sphere />
      <OrbitControls
        enableDamping
        dampingFactor={0.15}
        rotateSpeed={0.85}
        minDistance={5}
        maxDistance={30}
        panSpeed={0.5}
        target={[0, 3.5, 0]}
      />
    </Canvas>
  );
}
