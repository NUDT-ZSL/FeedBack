import { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneSetup } from '@/scene/SceneSetup';
import { LightController } from '@/components/LightController';
import { ColorPalette } from '@/components/ColorPalette';
import { ReferencePanel } from '@/components/ReferencePanel';
import { DrawCanvas } from '@/components/DrawCanvas';
import { StatusBar } from '@/components/StatusBar';
import { COLORS } from '@/types';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [muralRect, setMuralRect] = useState<DOMRect | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const updateMuralRect = () => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      setContainerHeight(containerRect.height);
      
      const width = containerRect.width * 0.6;
      const height = width * (2 / 3);
      const left = (containerRect.width - width) / 2;
      const top = (containerRect.height - height) / 2;
      
      setMuralRect({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      });
    };

    updateMuralRect();
    window.addEventListener('resize', updateMuralRect);
    
    return () => window.removeEventListener('resize', updateMuralRect);
  }, []);

  const cameraPosition: [number, number, number] = [0, 0, 3];

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ backgroundColor: COLORS.CAVE_BG }}
    >
      <Canvas
        camera={{
          position: cameraPosition,
          fov: 50,
          near: 0.1,
          far: 100,
        }}
        gl={{
          antialias: true,
          alpha: true,
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      >
        <color attach="background" args={[COLORS.CAVE_BG]} />
        <fog attach="fog" args={[COLORS.CAVE_BG, 5, 20]} />
        <SceneSetup />
        <LightController />
      </Canvas>

      <ColorPalette />
      <ReferencePanel muralRect={muralRect} />
      <DrawCanvas muralRect={muralRect} />
      <StatusBar containerHeight={containerHeight} />

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 text-center pointer-events-none">
        <h1 
          className="text-lg font-medium opacity-60"
          style={{ color: COLORS.LAMP_GLOW }}
        >
          敦煌石窟壁画补绘
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          移动鼠标控制油灯 · 滚轮调节光锥 · 赭石描线 · 颜料填色
        </p>
      </div>
    </div>
  );
}

export default App;
