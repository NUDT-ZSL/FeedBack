import { useState, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import Observatory from './components/Observatory';
import TalismanPanel from './components/TalismanPanel';
import { baguaMatchRules, Trigram } from './lib/starData';

export interface LightBeamData {
  position: [number, number, number];
  visible: boolean;
  timestamp: number;
}

export default function App() {
  const [rotation, setRotation] = useState<[number, number]>([0, 0]);
  const [isDraggingSphere, setIsDraggingSphere] = useState(false);
  const [draggedTalisman, setDraggedTalisman] = useState<string | null>(null);
  const [lightBeam, setLightBeam] = useState<LightBeamData | null>(null);
  const [baguaError, setBaguaError] = useState(false);
  const [isDragOverBagua, setIsDragOverBagua] = useState(false);
  const lastMousePos = useRef<[number, number]>([0, 0]);

  const handleSphereMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDraggingSphere(true);
    lastMousePos.current = [e.clientX, e.clientY];
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingSphere) return;
    const deltaX = e.clientX - lastMousePos.current[0];
    const deltaY = e.clientY - lastMousePos.current[1];
    setRotation(prev => {
      const newRotX = (prev[0] + deltaY * 0.5) % 360;
      const newRotY = (prev[1] + deltaX * 0.5) % 360;
      return [newRotX < 0 ? newRotX + 360 : newRotX, newRotY < 0 ? newRotY + 360 : newRotY];
    });
    lastMousePos.current = [e.clientX, e.clientY];
  }, [isDraggingSphere]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingSphere(false);
  }, []);

  const handleTalismanDragStart = useCallback((talismanName: string) => {
    setDraggedTalisman(talismanName);
  }, []);

  const handleTalismanDragEnd = useCallback(() => {
    setDraggedTalisman(null);
    setIsDragOverBagua(false);
  }, []);

  const handleBaguaDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverBagua(true);
  }, []);

  const handleBaguaDragLeave = useCallback(() => {
    setIsDragOverBagua(false);
  }, []);

  const handleBaguaDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverBagua(false);
    
    if (!draggedTalisman) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = -(e.clientY - rect.top - rect.height / 2);
    const angle = Math.atan2(y, x);
    let position = Math.round(((angle * 180 / Math.PI) + 360 + 90) % 360 / 45) % 8;
    
    const expectedPosition = baguaMatchRules[draggedTalisman];
    
    if (position === expectedPosition) {
      const angleRad = (position * 45 - 90) * Math.PI / 180;
      const beamX = Math.cos(angleRad) * 1.5;
      const beamZ = Math.sin(angleRad) * 1.5;
      
      setLightBeam({
        position: [beamX, -3, beamZ],
        visible: true,
        timestamp: Date.now()
      });
      
      setTimeout(() => {
        setLightBeam(null);
      }, 2000);
    } else {
      setBaguaError(true);
      setTimeout(() => {
        setBaguaError(false);
      }, 400);
    }
    
    setDraggedTalisman(null);
  }, [draggedTalisman]);

  return (
    <div 
      className="app-container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="info-panel">
        <div className="info-title">观星台</div>
        <div className="info-subtitle">监天司占星推演系统</div>
      </div>
      
      <div className="hint-text">
        拖拽浑天仪旋转 · 拖拽符咒至八卦阵图
      </div>

      <div className="canvas-container">
        <Canvas
          camera={{ position: [0, 8, 20], fov: 60 }}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={['#0d0d1a']} />
          <fog attach="fog" args={['#0d0d1a', 30, 60]} />
          
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 20, 10]} intensity={0.8} color="#fff8e1" />
          <pointLight position={[0, 0, 0]} intensity={1} color="#0099cc" distance={20} />
          
          <Observatory
            rotation={rotation}
            onSphereMouseDown={handleSphereMouseDown}
            isDraggingSphere={isDraggingSphere}
            lightBeam={lightBeam}
          />
        </Canvas>
      </div>

      <div
        className={`bagua-drop-zone ${isDragOverBagua ? 'drag-over' : ''} ${baguaError ? 'error' : ''}`}
        onDragOver={handleBaguaDragOver}
        onDragLeave={handleBaguaDragLeave}
        onDrop={handleBaguaDrop}
      />

      <TalismanPanel
        onDragStart={handleTalismanDragStart}
        onDragEnd={handleTalismanDragEnd}
        draggedTalisman={draggedTalisman}
      />
    </div>
  );
}
