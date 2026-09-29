import { useState, useEffect } from 'react';
import { MdDirectionsBike } from 'react-icons/md';
import type { RideRecord } from '../types';

interface RideCardProps {
  ride: RideRecord;
}

function getDurationHours(duration: string): number {
  const parts = duration.split(':').map(Number);
  return parts[0] + parts[1] / 60 + (parts[2] || 0) / 3600;
}

function getCardGradient(duration: string): string {
  const hours = getDurationHours(duration);
  if (hours < 1) return 'linear-gradient(135deg, #E0F7FA, #B2EBF2)';
  if (hours < 2) return 'linear-gradient(135deg, #FFECB3, #FFE082)';
  return 'linear-gradient(135deg, #FFCCBC, #FFAB91)';
}

export default function RideCard({ ride }: RideCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => setAnimated(true), 50);
      return () => clearTimeout(t);
    }
    setAnimated(false);
  }, [expanded]);

  const maxElev = Math.max(...ride.elevationProfile.map(p => p.elevation), 1);
  const maxSpeed = Math.max(...ride.speedProfile.map(p => p.speed), 1);

  const elevBars = ride.elevationProfile.filter((_, i) => i % Math.max(1, Math.floor(ride.elevationProfile.length / 24)) === 0);
  const speedBars = ride.speedProfile.filter((_, i) => i % Math.max(1, Math.floor(ride.speedProfile.length / 20)) === 0);

  return (
    <div
      className="ride-card"
      style={{ background: getCardGradient(ride.duration) }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="ride-card-header">
        <div className="ride-card-icon">
          <MdDirectionsBike size={20} />
        </div>
        <div className="ride-card-date">{ride.date}</div>
      </div>
      <div className="ride-card-name">{ride.name}</div>
      <div className="ride-card-stats">
        <div className="ride-card-stat">
          <div className="ride-card-stat-value">{ride.distance}<span className="ride-card-stat-label"> km</span></div>
          <div className="ride-card-stat-label">总距离</div>
        </div>
        <div className="ride-card-stat">
          <div className="ride-card-stat-value" style={{ fontSize: '18px' }}>{ride.duration}</div>
          <div className="ride-card-stat-label">用时</div>
        </div>
      </div>

      {expanded && (
        <div className="ride-card-details" onClick={e => e.stopPropagation()}>
          <div className="detail-grid">
            <div className="detail-item">❤️ <strong>{ride.avgHeartRate}</strong> bpm</div>
            <div className="detail-item">⛰️ <strong>{ride.elevationGain}</strong> m</div>
          </div>
          <div className="waypoints-list">
            {ride.waypoints.map((wp, i) => (
              <span key={i} className="waypoint-tag">📍 {wp.name}</span>
            ))}
          </div>
          <div className="chart-section-title">海拔剖面</div>
          <div className="bar-chart">
            {elevBars.map((p, i) => (
              <div
                key={i}
                className="bar"
                style={{ height: animated ? `${(p.elevation / maxElev) * 100}%` : '0%' }}
              />
            ))}
          </div>
          <div className="chart-section-title">速度分析</div>
          <div className="bar-chart speed">
            {speedBars.map((p, i) => (
              <div
                key={i}
                className="bar"
                style={{ height: animated ? `${(p.speed / maxSpeed) * 100}%` : '0%' }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
