import { useRef, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Room } from './Room';
import { SoundSource } from './SoundSource';
import { Rays } from './Rays';
import { Particles } from './Particles';
import {
  RoomConfig,
  SoundSourceConfig,
  RayData,
  HitDetail,
  WallType,
} from '@/types';

interface ScenePanelProps {
  room: RoomConfig;
  source: SoundSourceConfig;
  rays: RayData[];
  reverbEnabled: boolean;
  particleCount: number;
  selectedWall: WallType | null;
  onWallSelect: (wall: WallType | null) => void;
  onSourcePositionChange: (pos: [number, number, number]) => void;
  onSourceClick: () => void;
  onHitClick: (detail: HitDetail) => void;
}

function SceneContent({
  room,
  source,
  rays,
  reverbEnabled,
  particleCount,
  selectedWall,
  onWallSelect,
  onSourcePositionChange,
  onSourceClick,
  onHitClick,
}: ScenePanelProps) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
      <directionalLight position={[-5, 3, -3]} intensity={0.3} />

      <Room
        config={room}
        selectedWall={selectedWall}
        onWallSelect={onWallSelect}
      />

      <SoundSource
        config={source}
        onPositionChange={onSourcePositionChange}
        onClick={onSourceClick}
      />

      <Rays
        rays={rays}
        active={source.active}
        onHitClick={onHitClick}
      />

      <Particles
        count={particleCount}
        room={room}
        enabled={reverbEnabled && source.active}
      />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={3}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2 + 0.1}
      />
    </>
  );
}

export function ScenePanel(props: ScenePanelProps) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [8, 6, 10], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#1a1a2e' }}
      >
        <color attach="background" args={['#1a1a2e']} />
        <fog attach="fog" args={['#1a1a2e', 15, 40]} />
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
}
