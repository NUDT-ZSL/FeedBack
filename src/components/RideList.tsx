import { useState, useMemo, useCallback } from 'react';
import { MdSort, MdAdd, MdArrowUpward, MdArrowDownward } from 'react-icons/md';
import { getAllRides, createRide, getMonthlyStats } from '../data/rides';
import type { RideRecord, Waypoint } from '../types';
import RideCard from './RideCard';

function formatChange(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

interface CreateFormState {
  date: string;
  name: string;
  distance: string;
  duration: string;
  avgHeartRate: string;
  elevationGain: string;
}

const emptyForm: CreateFormState = {
  date: new Date().toISOString().split('T')[0],
  name: '',
  distance: '',
  duration: '',
  avgHeartRate: '',
  elevationGain: '',
};

export default function RideList() {
  const [rides, setRides] = useState<RideRecord[]>(getAllRides());
  const [monthMin, setMonthMin] = useState(1);
  const [monthMax, setMonthMax] = useState(12);
  const [sortAsc, setSortAsc] = useState(true);
  const [sortVer, setSortVer] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(emptyForm);
  const [markers, setMarkers] = useState<{ x: number; y: number; name: string }[]>([]);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const stats = useMemo(() => getMonthlyStats(year, month), [rides, year, month]);

  const filtered = useMemo(() => {
    let result = rides.filter(r => {
      const m = parseInt(r.date.split('-')[1], 10);
      return m >= monthMin && m <= monthMax;
    });
    result = [...result].sort((a, b) => sortAsc ? a.distance - b.distance : b.distance - a.distance);
    return result;
  }, [rides, monthMin, monthMax, sortAsc]);

  const toggleSort = useCallback(() => {
    setSortAsc(v => !v);
    setSortVer(v => v + 1);
  }, []);

  const handleMapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (markers.length >= 6) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const name = markers.length === 0 ? '起点' : `途经${markers.length}`;
    setMarkers(prev => [...prev, { x, y, name }]);
  }, [markers.length]);

  const handleSubmit = useCallback(() => {
    if (!form.name || !form.distance || !form.duration || markers.length < 3) return;
    const waypoints: Waypoint[] = markers.map((m, i) => ({
      name: m.name || `点${i + 1}`,
      lat: 39.9 + (m.y - 50) * 0.01,
      lng: 116.4 + (m.x - 50) * 0.01,
    }));
    const newRide = createRide({
      date: form.date,
      name: form.name,
      distance: parseFloat(form.distance),
      duration: form.duration,
      avgHeartRate: parseInt(form.avgHeartRate, 10) || 130,
      elevationGain: parseInt(form.elevationGain, 10) || 100,
      waypoints,
    });
    setRides(getAllRides());
    setShowCreate(false);
    setForm(emptyForm);
    setMarkers([]);
  }, [form, markers]);

  const closeCreate = useCallback(() => {
    setShowCreate(false);
    setForm(emptyForm);
    setMarkers([]);
  }, []);

  const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>骑行日志</h1>
        <button className="create-btn" onClick={() => setShowCreate(true)}>
          <MdAdd size={18} /> 新建骑行
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🚀</div>
          <div className="stat-value">{stats.totalDistance}<span className="stat-unit">km</span></div>
          <div className={`stat-change ${stats.distanceChangePercent >= 0 ? 'up' : 'down'}`}>
            {stats.distanceChangePercent >= 0 ? '↑' : '↓'} {formatChange(Math.abs(stats.distanceChangePercent))}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">{stats.avgSpeed}<span className="stat-unit">km/h</span></div>
          <div className={`stat-change ${stats.speedChangePercent >= 0 ? 'up' : 'down'}`}>
            {stats.speedChangePercent >= 0 ? '↑' : '↓'} {formatChange(Math.abs(stats.speedChangePercent))}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏔️</div>
          <div className="stat-value">{stats.totalElevation}<span className="stat-unit">m</span></div>
          <div className={`stat-change ${stats.elevationChangePercent >= 0 ? 'up' : 'down'}`}>
            {stats.elevationChangePercent >= 0 ? '↑' : '↓'} {formatChange(Math.abs(stats.elevationChangePercent))}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-value">{stats.rideCount}<span className="stat-unit">次</span></div>
          <div className={`stat-change ${stats.countChangePercent >= 0 ? 'up' : 'down'}`}>
            {stats.countChangePercent >= 0 ? '↑' : '↓'} {formatChange(Math.abs(stats.countChangePercent))}
          </div>
        </div>
      </div>

      <div className="filters-row">
        <span className="filter-label">日期范围</span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="dual-slider">
            <div className="dual-slider-track" />
            <div
              className="dual-slider-fill"
              style={{
                left: `${((monthMin - 1) / 11) * 100}%`,
                width: `${((monthMax - monthMin) / 11) * 100}%`,
              }}
            />
            <input
              type="range" min={1} max={12} value={monthMin}
              onChange={e => setMonthMin(Math.min(Number(e.target.value), monthMax))}
            />
            <input
              type="range" min={1} max={12} value={monthMax}
              onChange={e => setMonthMax(Math.max(Number(e.target.value), monthMin))}
            />
          </div>
          <div className="slider-labels">
            <span>{MONTHS[monthMin - 1]}</span>
            <span>{MONTHS[monthMax - 1]}</span>
          </div>
        </div>

        <span className="filter-label" style={{ marginLeft: 16 }}>距离排序</span>
        <button className="sort-btn" onClick={toggleSort}>
          {sortAsc ? <MdArrowUpward size={16} /> : <MdArrowDownward size={16} />}
          {sortAsc ? '升序' : '降序'}
        </button>
      </div>

      <div className="ride-grid">
        {filtered.map((ride, idx) => (
          <div
            key={`${ride.id}-${sortVer}`}
            className="stagger-item"
            style={{ animationDelay: `${idx * 0.05}s` }}
          >
            <RideCard ride={ride} />
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="no-data">暂无符合条件的骑行记录</div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={closeCreate}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>新建骑行记录</h2>
            <div className="form-row">
              <div className="form-group">
                <label>日期</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>骑行名称</label>
                <input type="text" placeholder="例: 晨骑奥森" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>总距离 (km)</label>
                <input type="number" step="0.1" placeholder="0.0" value={form.distance} onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>用时 (h:mm:ss)</label>
                <input type="text" placeholder="0:30:00" value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>平均心率 (bpm)</label>
                <input type="number" placeholder="130" value={form.avgHeartRate} onChange={e => setForm(f => ({ ...f, avgHeartRate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>海拔爬升 (m)</label>
                <input type="number" placeholder="100" value={form.elevationGain} onChange={e => setForm(f => ({ ...f, elevationGain: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label>途经地点标注</label>
              <div className="simple-map" onClick={handleMapClick}>
                {markers.map((m, i) => (
                  <div
                    key={i}
                    className="map-marker"
                    style={{ left: `${m.x}%`, top: `${m.y}%` }}
                  >
                    <span className="map-marker-label">{m.name}</span>
                  </div>
                ))}
              </div>
              <div className="map-hint">点击地图添加标记（至少3个），已标记 {markers.length} 个</div>
            </div>

            <div className="form-actions">
              <button className="btn-secondary" onClick={closeCreate}>取消</button>
              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={!form.name || !form.distance || !form.duration || markers.length < 3}
                style={{ opacity: (!form.name || !form.distance || !form.duration || markers.length < 3) ? 0.5 : 1 }}
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
