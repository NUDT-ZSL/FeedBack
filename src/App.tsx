import React, { useState, useEffect, useCallback, useRef } from 'react';
import OceanScene from './modules/visualization/OceanScene';
import UserControls from './modules/controls/UserControls';
import { OceanRegion, OceanStats, PlanktonData } from './modules/data/OceanDataService';

const App: React.FC = () => {
  const [region, setRegion] = useState<OceanRegion>('northAtlantic');
  const [depthRange, setDepthRange] = useState<[number, number]>([0, 200]);
  const [particleDensity, setParticleDensity] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [stats, setStats] = useState<OceanStats>({
    averageSpeed: 0.6,
    surfaceTemperature: 12,
    planktonDensity: 850,
    salinity: 35.5,
  });
  const [displayStats, setDisplayStats] = useState<OceanStats>({
    averageSpeed: 0.6,
    surfaceTemperature: 12,
    planktonDensity: 850,
    salinity: 35.5,
  });
  const [selectedPlankton, setSelectedPlankton] = useState<PlanktonData | null>(null);
  const statsRef = useRef<OceanStats>(stats);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    const animate = () => {
      setDisplayStats(prev => {
        const target = statsRef.current;
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        return {
          averageSpeed: lerp(prev.averageSpeed, target.averageSpeed, 0.1),
          surfaceTemperature: lerp(prev.surfaceTemperature, target.surfaceTemperature, 0.1),
          planktonDensity: Math.round(lerp(prev.planktonDensity, target.planktonDensity, 0.1)),
          salinity: lerp(prev.salinity, target.salinity, 0.1),
        };
      });
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const handleStatsUpdate = useCallback((newStats: OceanStats) => {
    setStats(newStats);
  }, []);

  const handleRegionChange = useCallback((newRegion: OceanRegion) => {
    setRegion(newRegion);
  }, []);

  const handleDepthRangeChange = useCallback((range: [number, number]) => {
    setDepthRange(range);
  }, []);

  const handleParticleDensityChange = useCallback((density: number) => {
    setParticleDensity(density);
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handlePlanktonClick = useCallback((plankton: PlanktonData | null) => {
    setSelectedPlankton(plankton);
  }, []);

  const statItems = [
    { label: '平均流速', value: displayStats.averageSpeed.toFixed(2), unit: 'm/s' },
    { label: '表面温度', value: displayStats.surfaceTemperature.toFixed(1), unit: '°C' },
    { label: '浮游生物密度', value: displayStats.planktonDensity.toString(), unit: '个/m³' },
    { label: '盐度', value: displayStats.salinity.toFixed(2), unit: 'PSU' },
  ];

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#0d1b2a',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: '50px',
        right: '300px',
        bottom: '100px',
      }}>
        <OceanScene
          region={region}
          depthRange={depthRange}
          isPlaying={isPlaying}
          particleDensity={particleDensity}
          onStatsUpdate={handleStatsUpdate}
          onPlanktonClick={handlePlanktonClick}
        />
      </div>

      <div style={{
        position: 'absolute',
        top: '20px',
        left: '70px',
        zIndex: 50,
        pointerEvents: 'none',
      }}>
        <h1 style={{
          color: '#00b894',
          fontSize: '22px',
          fontWeight: 700,
          margin: 0,
          textShadow: '0 2px 10px rgba(0, 184, 148, 0.3)',
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap',
        }}>
          🌊 海洋洋流与浮游生物分布
        </h1>
        <p style={{
          color: '#557799',
          fontSize: '12px',
          margin: '4px 0 0 0',
        }}>
          3D 动态模拟系统
        </p>
      </div>

      <UserControls
        region={region}
        depthRange={depthRange}
        particleDensity={particleDensity}
        isPlaying={isPlaying}
        onRegionChange={handleRegionChange}
        onDepthRangeChange={handleDepthRangeChange}
        onParticleDensityChange={handleParticleDensityChange}
        onPlayPause={handlePlayPause}
      />

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: '50px',
        right: '300px',
        height: '100px',
        background: 'linear-gradient(to top, #0d1b2a 60%, transparent)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-around',
        padding: '0 30px 20px 30px',
        zIndex: 50,
        pointerEvents: 'none',
      }}>
        {statItems.map((item, index) => (
          <React.Fragment key={item.label}>
            {index > 0 && (
              <div style={{
                width: '1px',
                height: '40px',
                background: 'rgba(255, 255, 255, 0.08)',
                marginBottom: '5px',
              }} />
            )}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '100px',
            }}>
              <span style={{
                color: '#557799',
                fontSize: '11px',
                marginBottom: '6px',
                whiteSpace: 'nowrap',
              }}>
                {item.label}
              </span>
              <span style={{
                color: '#00b894',
                fontSize: '20px',
                fontWeight: 700,
                fontFamily: 'monospace',
                textShadow: '0 0 15px rgba(0, 184, 148, 0.4)',
                whiteSpace: 'nowrap',
              }}>
                {item.value}
                <span style={{
                  fontSize: '11px',
                  fontWeight: 400,
                  marginLeft: '3px',
                  opacity: 0.6,
                }}>
                  {item.unit}
                </span>
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>

      <div style={{
        position: 'absolute',
        bottom: '110px',
        left: '70px',
        display: 'flex',
        gap: '16px',
        zIndex: 60,
        pointerEvents: 'none',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#00ff88',
            boxShadow: '0 0 8px rgba(0, 255, 136, 0.5)',
          }} />
          <span style={{
            color: '#6688aa',
            fontSize: '11px',
          }}>
            藻类 (0-200m)
          </span>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            width: '12px',
            height: '4px',
            borderRadius: '2px',
            background: '#ff8c42',
            boxShadow: '0 0 8px rgba(255, 140, 66, 0.5)',
          }} />
          <span style={{
            color: '#6688aa',
            fontSize: '11px',
          }}>
            磷虾 (200-500m)
          </span>
        </div>
      </div>
    </div>
  );
};

export default App;
