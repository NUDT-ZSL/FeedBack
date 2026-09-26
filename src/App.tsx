import { useState, useEffect, useCallback, useMemo } from 'react';
import { ScenePanel } from '@/components/ScenePanel';
import { ControlPanel } from '@/components/ControlPanel';
import { InfoPanel } from '@/components/InfoPanel';
import {
  RoomConfig,
  SoundSourceConfig,
  RayData,
  SimulationStats,
  HitDetail,
  MaterialType,
  WallType,
  DEFAULT_ROOM,
  DEFAULT_SOURCE,
} from '@/types';
import { traceRays } from '@/utils/raytracer';
import { calculateRT60, calculateParticleCount } from '@/utils/reverb';

function App() {
  const [room, setRoom] = useState<RoomConfig>(DEFAULT_ROOM);
  const [source, setSource] = useState<SoundSourceConfig>(DEFAULT_SOURCE);
  const [rays, setRays] = useState<RayData[]>([]);
  const [stats, setStats] = useState<SimulationStats>({
    totalRays: 0,
    averageBounces: 0,
    wallHitCounts: {
      front: 0, back: 0, left: 0, right: 0, floor: 0, ceiling: 0,
    },
    materialHitCounts: {
      glass: 0, metal: 0, wood: 0, fabric: 0,
    },
  });
  const [selectedWall, setSelectedWall] = useState<WallType | null>(null);
  const [reverbEnabled, setReverbEnabled] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hitDetail, setHitDetail] = useState<HitDetail | null>(null);

  const rt60 = useMemo(() => calculateRT60(room), [room]);
  const particleCount = useMemo(() => calculateParticleCount(rt60), [rt60]);

  useEffect(() => {
    const checkWidth = () => {
      setIsMobile(window.innerWidth < 1200);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const runSimulation = useCallback(() => {
    const startTime = performance.now();
    const { rays: newRays, stats: newStats } = traceRays(room, source);
    const elapsed = performance.now() - startTime;
    console.log(`Ray tracing completed in ${elapsed.toFixed(2)}ms`);
    setRays(newRays);
    setStats(newStats);
  }, [room, source]);

  const handleToggleSimulation = useCallback(() => {
    if (source.active) {
      setSource((prev) => ({ ...prev, active: false }));
      setRays([]);
      setStats({
        totalRays: 0,
        averageBounces: 0,
        wallHitCounts: {
          front: 0, back: 0, left: 0, right: 0, floor: 0, ceiling: 0,
        },
        materialHitCounts: {
          glass: 0, metal: 0, wood: 0, fabric: 0,
        },
      });
    } else {
      setSource((prev) => ({ ...prev, active: true }));
      runSimulation();
    }
  }, [source.active, runSimulation]);

  useEffect(() => {
    if (source.active) {
      runSimulation();
    }
  }, [room, source.position, source.active, runSimulation]);

  const handleWallMaterialChange = useCallback((wall: WallType, material: MaterialType) => {
    setRoom((prev) => ({
      ...prev,
      walls: { ...prev.walls, [wall]: material },
    }));
  }, []);

  const handleSourcePositionChange = useCallback((pos: [number, number, number]) => {
    setSource((prev) => ({ ...prev, position: pos }));
  }, []);

  const handleRoomSizeChange = useCallback((
    dim: 'width' | 'height' | 'depth',
    value: number,
  ) => {
    setRoom((prev) => ({ ...prev, [dim]: value }));
  }, []);

  const handleSourceClick = useCallback(() => {
    handleToggleSimulation();
  }, [handleToggleSimulation]);

  const handleHitClick = useCallback((detail: HitDetail) => {
    setHitDetail(detail);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setHitDetail(null);
  }, []);

  const layoutStyle: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    overflow: 'hidden',
    background: '#1a1a2e',
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  };

  const sceneStyle: React.CSSProperties = {
    flex: isCollapsed ? 1 : undefined,
    width: isMobile ? '100%' : undefined,
    height: isMobile ? '60%' : '100%',
    position: 'relative',
  };

  const controlStyle: React.CSSProperties = isMobile
    ? {
        width: '100%',
        height: '40%',
        borderTop: '1px solid #0f3460',
        borderLeft: 'none',
      }
    : {
        width: isCollapsed ? 40 : '30%',
        minWidth: isCollapsed ? 40 : 320,
        maxWidth: isCollapsed ? 40 : 480,
        transition: 'width 0.4s ease-in-out',
        overflow: 'hidden',
      };

  const infoOverlayStyle: React.CSSProperties = isMobile
    ? { display: 'none' }
    : {
        position: 'absolute',
        top: 16,
        right: isCollapsed ? 56 : 'calc(30% + 16px)',
        width: 280,
        maxHeight: 'calc(100% - 32px)',
        background: 'rgba(22, 33, 62, 0.95)',
        backdropFilter: 'blur(10px)',
        borderRadius: 12,
        border: '1px solid #0f3460',
        overflow: 'hidden',
        zIndex: 100,
        transition: 'right 0.4s ease-in-out',
      };

  return (
    <div style={layoutStyle}>
      {!isMobile && (
        <div style={{ flex: 1, position: 'relative' }}>
          <ScenePanel
            room={room}
            source={source}
            rays={rays}
            reverbEnabled={reverbEnabled}
            particleCount={particleCount}
            selectedWall={selectedWall}
            onWallSelect={setSelectedWall}
            onSourcePositionChange={handleSourcePositionChange}
            onSourceClick={handleSourceClick}
            onHitClick={handleHitClick}
          />
          <div style={infoOverlayStyle}>
            <InfoPanel
              stats={stats}
              active={source.active}
              hitDetail={hitDetail}
              onCloseDetail={handleCloseDetail}
            />
          </div>
        </div>
      )}

      {isMobile && (
        <div style={sceneStyle}>
          <ScenePanel
            room={room}
            source={source}
            rays={rays}
            reverbEnabled={reverbEnabled}
            particleCount={particleCount}
            selectedWall={selectedWall}
            onWallSelect={setSelectedWall}
            onSourcePositionChange={handleSourcePositionChange}
            onSourceClick={handleSourceClick}
            onHitClick={handleHitClick}
          />
        </div>
      )}

      <div style={controlStyle}>
        <ControlPanel
          room={room}
          source={source}
          reverbEnabled={reverbEnabled}
          rt60={rt60}
          selectedWall={selectedWall}
          isCollapsed={isCollapsed && !isMobile}
          isMobile={isMobile}
          onWallMaterialChange={handleWallMaterialChange}
          onSourcePositionChange={handleSourcePositionChange}
          onToggleSimulation={handleToggleSimulation}
          onToggleReverb={() => setReverbEnabled((p) => !p)}
          onToggleCollapse={() => setIsCollapsed((p) => !p)}
          onRoomSizeChange={handleRoomSizeChange}
        />
      </div>
    </div>
  );
}

export default App;
