import { useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import Observatory from './components/Observatory';
import TalismanPanel from './components/TalismanPanel';
import { useDivinationKernel } from './hooks/useDivinationKernel';

export default function App() {
  const { state, dispatch } = useDivinationKernel();
  const lastMousePos = useRef<[number, number]>([0, 0]);

  const handleSphereMouseDown = useCallback((e: React.MouseEvent) => {
    lastMousePos.current = [e.clientX, e.clientY];
    dispatch({ type: 'sphereDragStart', at: Date.now() });
  }, [dispatch]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const deltaX = e.clientX - lastMousePos.current[0];
    const deltaY = e.clientY - lastMousePos.current[1];
    lastMousePos.current = [e.clientX, e.clientY];
    dispatch({ type: 'sphereRotate', at: Date.now(), deltaX, deltaY });
  }, [dispatch]);

  const handleMouseUp = useCallback(() => {
    dispatch({ type: 'sphereDragEnd', at: Date.now() });
  }, [dispatch]);

  const handleTalismanDragStart = useCallback((talismanName: string) => {
    dispatch({ type: 'talismanDragStart', at: Date.now(), talisman: talismanName });
  }, [dispatch]);

  const handleTalismanDragEnd = useCallback(() => {
    dispatch({ type: 'talismanDragEnd', at: Date.now() });
  }, [dispatch]);

  const handleBaguaDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dispatch({ type: 'baguaDragOver', at: Date.now() });
  }, [dispatch]);

  const handleBaguaDragLeave = useCallback(() => {
    dispatch({ type: 'baguaDragLeave', at: Date.now() });
  }, [dispatch]);

  const handleBaguaDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 页面只负责把屏幕坐标换算成相对阵图中心的方向；
    // 卦位判定、命中结果与状态流转全部在内核中完成
    const rect = e.currentTarget.getBoundingClientRect();
    const direction: [number, number] = [
      e.clientX - (rect.left + rect.width / 2),
      -(e.clientY - (rect.top + rect.height / 2)),
    ];
    const talisman = e.dataTransfer.getData('text/plain') || state.draggedTalisman || '';
    dispatch({ type: 'baguaDrop', at: Date.now(), talisman, direction });
  }, [dispatch, state.draggedTalisman]);

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
            isDraggingSphere={state.isRotating}
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
