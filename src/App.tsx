import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import Observatory from './components/Observatory';
import TalismanPanel from './components/TalismanPanel';
import { DivinationKernel } from './kernel/divinationKernel';
import type { DivinationState, KernelEvent } from './kernel/divinationKernel';

export default function App() {
  const kernelRef = useRef<DivinationKernel | null>(null);
  if (kernelRef.current === null) {
    kernelRef.current = new DivinationKernel();
  }
  const kernel = kernelRef.current;

  const [state, setState] = useState<DivinationState>(() => kernel.getState());
  const lastMousePos = useRef<[number, number]>([0, 0]);

  useEffect(() => kernel.subscribe(setState), [kernel]);

  useEffect(() => {
    const nextExpiryAt = kernel.getNextExpiryAt();
    if (nextExpiryAt === null) return undefined;
    const timer = setTimeout(() => {
      kernel.dispatch({ type: 'tick' });
    }, Math.max(0, nextExpiryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [kernel, state]);

  const dispatch = useCallback((event: KernelEvent) => {
    kernel.dispatch(event);
  }, [kernel]);

  const handleSphereMouseDown = useCallback((e: React.MouseEvent) => {
    lastMousePos.current = [e.clientX, e.clientY];
    dispatch({ type: 'sphereDragStart' });
  }, [dispatch]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!kernel.getState().isDraggingSphere) return;
    const deltaX = e.clientX - lastMousePos.current[0];
    const deltaY = e.clientY - lastMousePos.current[1];
    dispatch({ type: 'sphereDragMove', deltaX, deltaY });
    lastMousePos.current = [e.clientX, e.clientY];
  }, [dispatch, kernel]);

  const handleMouseUp = useCallback(() => {
    dispatch({ type: 'sphereDragEnd' });
  }, [dispatch]);

  const handleTalismanDragStart = useCallback((talismanName: string) => {
    dispatch({ type: 'talismanDragStart', talisman: talismanName });
  }, [dispatch]);

  const handleTalismanDragEnd = useCallback((talismanName: string) => {
    dispatch({ type: 'talismanDragEnd', talisman: talismanName });
  }, [dispatch]);

  const handleBaguaDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dispatch({ type: 'baguaDragOver' });
  }, [dispatch]);

  const handleBaguaDragLeave = useCallback(() => {
    dispatch({ type: 'baguaDragLeave' });
  }, [dispatch]);

  const handleBaguaDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const direction: [number, number] = [
      e.clientX - rect.left - rect.width / 2,
      -(e.clientY - rect.top - rect.height / 2),
    ];
    dispatch({ type: 'baguaDrop', direction });
  }, [dispatch]);

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
            rotation={state.rotation}
            onSphereMouseDown={handleSphereMouseDown}
            isDraggingSphere={state.isDraggingSphere}
            lightBeam={state.lightBeam}
          />
        </Canvas>
      </div>

      <div
        className={`bagua-drop-zone ${state.isDragOverBagua ? 'drag-over' : ''} ${state.baguaError ? 'error' : ''}`}
        onDragOver={handleBaguaDragOver}
        onDragLeave={handleBaguaDragLeave}
        onDrop={handleBaguaDrop}
      />

      <TalismanPanel
        onDragStart={handleTalismanDragStart}
        onDragEnd={handleTalismanDragEnd}
        draggedTalisman={state.draggedTalisman}
      />
    </div>
  );
}
