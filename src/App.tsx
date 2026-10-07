import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { StarProvider } from './context/StarContext';
import Astrolabe from './components/Astrolabe';
import StarChart from './components/StarChart';
import ObservatoryGround from './components/ObservatoryGround';
import ObservationPanel from './components/ObservationPanel';
import ShichenController from './components/ShichenController';
import ControlButtons from './components/ControlButtons';
import StarInfoPanel from './components/StarInfoPanel';
import StarParticles from './components/StarParticles';
import Toast from './components/Toast';
import { useStar } from './context/StarContext';

const SceneContent: React.FC = () => {
  const { setSelectedStar } = useStar();

  const handleCanvasClick = () => {
    setSelectedStar(null);
  };

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={0.5} color="#ffffff" />
      <pointLight position={[-10, 5, -10]} intensity={0.3} color="#4488ff" />

      <StarChart />
      <Astrolabe />
      <ObservatoryGround />

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={30}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI * 0.75}
        target={[0, 2, 0]}
      />

      <mesh onClick={handleCanvasClick} position={[0, 0, -100]} visible={false}>
        <sphereGeometry args={[1, 1, 1]} />
        <meshBasicMaterial />
      </mesh>
    </>
  );
};

const AppContent: React.FC = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      background: 'linear-gradient(180deg, #0d0221 0%, #1a1a4e 50%, #0d0221 100%)',
    }}>
      <StarParticles />

      <Canvas
        camera={{ position: [0, 5, 12], fov: 60 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color('#0d0221'), 0);
        }}
      >
        <SceneContent />
      </Canvas>

      {!isMobile && <ShichenController />}
      <ControlButtons />
      <StarInfoPanel />
      <ObservationPanel isMobile={isMobile} />
      <Toast />

      <div style={{
        position: 'fixed',
        top: '20px',
        left: '30px',
        color: '#ffd700',
        fontFamily: "'Noto Serif SC', serif",
        zIndex: 50,
      }}>
        <h1 style={{
          fontSize: '28px',
          margin: 0,
          textShadow: '0 0 20px rgba(255, 215, 0, 0.5)',
          fontWeight: 700,
        }}>
          观星台
        </h1>
        <p style={{
          fontSize: '12px',
          color: '#c0a060',
          marginTop: '4px',
          margin: 0,
        }}>
          拖拽浑天仪调节经纬 · 点击星体查看详情
        </p>
      </div>

      {!isMobile && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '280px',
          fontSize: '11px',
          color: 'rgba(192, 160, 96, 0.6)',
          fontFamily: "'Noto Serif SC', serif",
          zIndex: 10,
        }}>
          鼠标滚轮缩放 · 右键拖拽旋转视角
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <StarProvider>
      <AppContent />
    </StarProvider>
  );
};

export default App;
