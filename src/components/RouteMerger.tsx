import { useState, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { getAllRides, mergeRoutes } from '../data/rides';
import type { RideRecord, RouteSegment, MergedRoute } from '../types';

export default function RouteMerger() {
  const [rides] = useState<RideRecord[]>(getAllRides());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [merged, setMerged] = useState<MergedRoute | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const handleMerge = () => {
    const segments: RouteSegment[] = selectedIds.map(id => {
      const ride = rides.find(r => r.id === id)!;
      return { rideId: id, segmentName: ride.name, startKm: 0, endKm: ride.distance };
    });
    setMerged(mergeRoutes(segments));
  };

  const elevChartData = useMemo(() => {
    if (!merged) return [];
    return merged.mergedElevation.map((p, i, arr) => ({
      ...p,
      gradient: i > 0
        ? Math.round(((p.elevation - arr[i - 1].elevation) / Math.max(0.001, p.distance - arr[i - 1].distance) / 10) * 10) / 10
        : 0,
    }));
  }, [merged]);

  const maxSpeedPoint = useMemo(() => {
    if (!merged || merged.mergedSpeed.length === 0) return null;
    return merged.mergedSpeed.reduce((max, p) => p.speed > max.speed ? p : max, merged.mergedSpeed[0]);
  }, [merged]);

  const ElevTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="elevation-tooltip">
        <p>距离: {d.distance} km</p>
        <p>海拔: {d.elevation} m</p>
        <p>坡度: {d.gradient}%</p>
      </div>
    );
  };

  const SpdTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="speed-tooltip">
        <p>{d.km} km · {d.speed} km/h</p>
      </div>
    );
  };

  const SpeedDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (maxSpeedPoint && payload.km === maxSpeedPoint.km && payload.speed === maxSpeedPoint.speed) {
      return <circle cx={cx} cy={cy} r={6} fill="#FFD700" stroke="#fff" strokeWidth={2} />;
    }
    return <circle cx={cx} cy={cy} r={0} />;
  };

  const selectedRides = rides.filter(r => selectedIds.includes(r.id));

  return (
    <div>
      <h1 className="page-title">路线拼接</h1>
      <div className="merger-layout">
        <div className="segment-selector">
          <h3>选取路段（最多5段）</h3>
          {rides.map(ride => (
            <div
              key={ride.id}
              className={`segment-item ${selectedIds.includes(ride.id) ? 'selected' : ''}`}
              onClick={() => toggleSelect(ride.id)}
            >
              <input type="checkbox" checked={selectedIds.includes(ride.id)} readOnly />
              <div className="segment-item-info">
                <div className="segment-item-name">{ride.name}</div>
                <div className="segment-item-meta">{ride.distance}km · {ride.date}</div>
              </div>
            </div>
          ))}
          <div className="segment-count">已选 {selectedIds.length}/5 段</div>
          <button className="merge-btn" onClick={handleMerge} disabled={selectedIds.length < 2}>
            拼接路线
          </button>
        </div>

        <div className="merger-result">
          {selectedRides.length > 1 && !merged && (
            <div className="connection-nodes" style={{ marginBottom: 12 }}>
              {selectedRides.map((ride, i) => (
                <div key={ride.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{ride.name}</span>
                  {i < selectedRides.length - 1 && (
                    <div className="connection-node">
                      <div className="node-dot" />
                      <div className="node-tooltip">
                        {rides[i + 1]?.waypoints[0]?.name || '连接点'}<br />
                        ({(rides[i + 1]?.waypoints[0]?.lat || 0).toFixed(4)}, {(rides[i + 1]?.waypoints[0]?.lng || 0).toFixed(4)})
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {merged && (
            <>
              {merged.connectionNodes.length > 0 && (
                <div className="connection-nodes">
                  {merged.connectionNodes.map((node, i) => (
                    <div key={i} className="connection-node">
                      <div className="node-dot" />
                      <div className="node-tooltip">
                        {node.name}<br />({node.lat.toFixed(4)}, {node.lng.toFixed(4)})
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="chart-card">
                <h4>海拔剖面图</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={elevChartData}>
                    <defs>
                      <linearGradient id="elevGrad" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="#4CAF50" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#F44336" stopOpacity={0.85} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                    <XAxis dataKey="distance" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<ElevTooltip />} />
                    <Area type="monotone" dataKey="elevation" fill="url(#elevGrad)" stroke="#4CAF50" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h4>速度分析图</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={merged.mergedSpeed}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                    <XAxis dataKey="km" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<SpdTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="speed"
                      stroke="#42A5F5"
                      strokeWidth={2}
                      dot={SpeedDot}
                      activeDot={{ r: 5, fill: '#42A5F5' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {!merged && (
            <div className="no-data">请在左侧选择至少2段路段进行拼接</div>
          )}
        </div>
      </div>
    </div>
  );
}
