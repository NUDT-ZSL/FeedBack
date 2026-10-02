import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useStore from '../store';
import { interpolatePosition, getStationIndex } from '../utils';
import StationPopup from './StationPopup';
import type { MovingHorse, Particle } from '../types';

const MapView = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredRoad, setHoveredRoad] = useState<number | null>(null);
  const [flashRoad, setFlashRoad] = useState<number | null>(null);
  const lastParticleTime = useRef<number>(0);

  const {
    stations,
    movingHorses,
    particles,
    selectedStation,
    selectStation,
    addParticle,
  } = useStore(state => ({
    stations: state.stations,
    movingHorses: state.movingHorses,
    particles: state.particles,
    selectedStation: state.selectedStation,
    selectStation: state.selectStation,
    addParticle: state.addParticle,
  }));

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastParticleTime.current > 150) {
        movingHorses.forEach(mh => {
          const fromStation = stations.find(s => s.id === mh.fromStation);
          const toStation = stations.find(s => s.id === mh.toStation);
          if (fromStation && toStation) {
            const pos = interpolatePosition(
              fromStation.position,
              toStation.position,
              mh.progress
            );
            const fromIdx = getStationIndex(mh.fromStation);
            const toIdx = getStationIndex(mh.toStation);
            const roadIndex = Math.min(fromIdx, toIdx);
            setFlashRoad(roadIndex);
            setTimeout(() => setFlashRoad(null), 300);

            const particleCount = 5 + Math.floor(Math.random() * 4);
            for (let i = 0; i < particleCount; i++) {
              setTimeout(() => {
                addParticle(
                  pos.x + (Math.random() - 0.5) * 10,
                  pos.y + (Math.random() - 0.5) * 10,
                  Date.now()
                );
              }, i * 20);
            }
          }
        });
        lastParticleTime.current = now;
      }
    }, 150);

    return () => clearInterval(interval);
  }, [movingHorses, stations, addParticle]);

  const renderRoads = () => {
    const roads = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const from = stations[i].position;
      const to = stations[i + 1].position;
      const isFlashing = flashRoad === i;
      const isHovered = hoveredRoad === i;

      roads.push(
        <g key={`road-${i}`}>
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#8b5a2b"
            strokeWidth="3"
            strokeDasharray="8,4"
            style={{
              filter: isFlashing ? 'brightness(1.5) drop-shadow(0 0 6px #d4a574)' : 'none',
              transition: 'filter 0.3s ease',
            }}
            onMouseEnter={() => setHoveredRoad(i)}
            onMouseLeave={() => setHoveredRoad(null)}
          />
          {isHovered && (
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#d4a574"
              strokeWidth="5"
              strokeDasharray="8,4"
              opacity="0.5"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </g>
      );
    }
    return roads;
  };

  const renderStations = () => {
    return stations.map(station => {
      const isSelected = selectedStation === station.id;
      const pendingDocs = station.documents.filter(d => d.status === 'pending').length;

      return (
        <g key={station.id}>
          <motion.g
            whileHover={{ scale: 1.2 }}
            style={{ transformOrigin: `${station.position.x}px ${station.position.y}px` }}
            transition={{ duration: 0.2 }}
            onClick={() => selectStation(isSelected ? null : station.id)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={station.position.x - 35}
              y={station.position.y - 25}
              width="70"
              height="50"
              rx="4"
              fill="#8b5a2b"
              stroke="#5c3d1e"
              strokeWidth="2"
              style={{
                filter: isSelected
                  ? 'drop-shadow(0 0 10px rgba(139, 90, 43, 0.8))'
                  : 'drop-shadow(2px 2px 4px rgba(0,0,0,0.3))',
                transition: 'filter 0.2s ease',
              }}
            />
            <rect
              x={station.position.x - 30}
              y={station.position.y - 20}
              width="60"
              height="40"
              rx="2"
              fill="none"
              stroke="#d4a574"
              strokeWidth="1"
              opacity="0.6"
            />
            <text
              x={station.position.x}
              y={station.position.y - 2}
              textAnchor="middle"
              fill="#f5ecd7"
              fontSize="12"
              fontWeight="600"
              style={{ fontFamily: "'Noto Serif SC', serif" }}
            >
              {station.name.slice(0, 2)}
            </text>
            <text
              x={station.position.x}
              y={station.position.y + 14}
              textAnchor="middle"
              fill="#d4a574"
              fontSize="10"
              style={{ fontFamily: "'Noto Serif SC', serif" }}
            >
              {station.name.slice(2)}
            </text>
            {pendingDocs > 0 && (
              <motion.circle
                cx={station.position.x + 30}
                cy={station.position.y - 25}
                r="10"
                fill="#ef4444"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                <title>{pendingDocs}份待发文书</title>
              </motion.circle>
            )}
            {pendingDocs > 0 && (
              <text
                x={station.position.x + 30}
                y={station.position.y - 21}
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                fontWeight="700"
                style={{ pointerEvents: 'none' }}
              >
                {pendingDocs}
              </text>
            )}
          </motion.g>
        </g>
      );
    });
  };

  const renderMovingHorses = () => {
    return movingHorses.map((mh: MovingHorse) => {
      const fromStation = stations.find(s => s.id === mh.fromStation);
      const toStation = stations.find(s => s.id === mh.toStation);
      if (!fromStation || !toStation) return null;

      const pos = interpolatePosition(
        fromStation.position,
        toStation.position,
        mh.progress
      );

      return (
        <g key={mh.id} style={{ willChange: 'transform' }}>
          <text
            x={pos.x}
            y={pos.y + 6}
            textAnchor="middle"
            fontSize="28"
            style={{
              filter: 'drop-shadow(2px 2px 2px rgba(0,0,0,0.3))',
            }}
          >
            🐎
          </text>
        </g>
      );
    });
  };

  const renderParticles = () => {
    return particles.map((p: Particle) => {
      const age = Date.now() - p.createdAt;
      const opacity = Math.max(0, 1 - age / p.duration);
      const size = 4 + Math.random() * 2;

      return (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.y}
          r={size}
          fill="#8b7355"
          opacity={opacity * 0.6}
          style={{ pointerEvents: 'none' }}
        />
      );
    });
  };

  const selectedStationData = stations.find(s => s.id === selectedStation);

  return (
    <div className="map-container">
      <div className="panel map-panel">
        <div className="panel-header">
          <h2 className="panel-title">🗺️ 驿道分布图</h2>
        </div>
        <div className="panel-body map-body">
          <svg
            ref={svgRef}
            viewBox="0 0 1000 400"
            className="map-svg"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern id="paperTexture" patternUnits="userSpaceOnUse" width="100" height="100">
                <rect width="100" height="100" fill="#e8dcc0" />
                <circle cx="25" cy="25" r="1" fill="#c9b896" opacity="0.3" />
                <circle cx="75" cy="75" r="1" fill="#c9b896" opacity="0.3" />
                <circle cx="50" cy="10" r="0.5" fill="#c9b896" opacity="0.2" />
              </pattern>
            </defs>
            <rect width="1000" height="400" fill="url(#paperTexture)" rx="4" />
            
            <text x="50" y="50" fill="#8b5a2b" fontSize="14" fontWeight="600">
              ☀ 京师方向
            </text>
            <text x="900" y="50" fill="#8b5a2b" fontSize="14" fontWeight="600" textAnchor="end">
              边关方向 ⚔
            </text>
            
            <text x="500" y="380" fill="#6b4423" fontSize="12" textAnchor="middle">
              ━━━ 大明驿道 · 七百里加急 ━━━
            </text>

            {renderRoads()}
            {renderStations()}
            {renderParticles()}
            {renderMovingHorses()}
          </svg>
        </div>
      </div>

      <AnimatePresence>
        {selectedStationData && (
          <StationPopup
            station={selectedStationData}
            onClose={() => selectStation(null)}
          />
        )}
      </AnimatePresence>

      <style>{`
        .map-container {
          flex: 0 0 65%;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .map-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .map-body {
          flex: 1;
          padding: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .map-svg {
          width: 100%;
          height: 100%;
          max-height: 600px;
        }

        @media (max-width: 800px) {
          .map-container {
            flex: 0 0 auto;
            order: 1;
          }

          .map-svg {
            height: 400px;
          }
        }
      `}</style>
    </div>
  );
};

export default MapView;
