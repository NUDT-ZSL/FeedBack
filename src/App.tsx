import React, { useState, useCallback } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import PlantCard from './components/PlantCard';
import LogForm from './components/LogForm';
import {
  Plant,
  CareLog,
  generateWaterTrendData,
  waterTrendOptions,
  generateFertilizeBarData,
  fertilizeBarOptions,
} from './utils/chartHelper';

const SPECIES_OPTIONS = ['多肉', '绿萝', '仙人掌', '蕨类', '其他'];

const INITIAL_PLANTS: Plant[] = [
  {
    id: '1',
    name: '绿萝',
    species: '绿萝',
    logs: [
      { id: 'l1', date: '2026-06-19', activityType: 'water', notes: '浇水充足' },
      { id: 'l2', date: '2026-06-16', activityType: 'fertilize', notes: '施氮肥' },
      { id: 'l3', date: '2026-06-14', activityType: 'water', notes: '正常浇水' },
      { id: 'l4', date: '2026-06-10', activityType: 'prune', notes: '修剪黄叶' },
      { id: 'l5', date: '2026-06-08', activityType: 'water', notes: '浇水' },
      { id: 'l6', date: '2026-06-05', activityType: 'water', notes: '少量浇水' },
    ],
    createdAt: '2026-05-01',
  },
  {
    id: '2',
    name: '仙人掌',
    species: '仙人掌',
    logs: [
      { id: 'l7', date: '2026-06-12', activityType: 'water', notes: '少量浇水' },
      { id: 'l8', date: '2026-06-01', activityType: 'fertilize', notes: '施磷钾肥' },
    ],
    createdAt: '2026-04-15',
  },
  {
    id: '3',
    name: '多肉',
    species: '多肉',
    logs: [
      { id: 'l9', date: '2026-06-18', activityType: 'water', notes: '浸盆法浇水' },
      { id: 'l10', date: '2026-06-11', activityType: 'water', notes: '浇水' },
    ],
    createdAt: '2026-03-20',
  },
  {
    id: '4',
    name: '蕨类',
    species: '蕨类',
    logs: [],
    createdAt: '2026-06-01',
  },
];

const PAGE_SIZE = 12;

const App: React.FC = () => {
  const [plants, setPlants] = useState<Plant[]>(INITIAL_PLANTS);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [showLogForm, setShowLogForm] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [newPlantName, setNewPlantName] = useState('');
  const [newPlantSpecies, setNewPlantSpecies] = useState('多肉');
  const [newPlantPhoto, setNewPlantPhoto] = useState('');
  const [newPlantAdded, setNewPlantAdded] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  const totalPages = Math.ceil(plants.length / PAGE_SIZE);
  const pagedPlants = plants.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSelectPlant = useCallback((plant: Plant) => {
    setSelectedPlant(plant);
    setFabOpen(false);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedPlant(null);
    setShowLogForm(false);
    setFabOpen(false);
  }, []);

  const handleAddLog = useCallback(
    (log: Omit<CareLog, 'id'>) => {
      if (!selectedPlant) return;
      const newLog: CareLog = { ...log, id: `l${Date.now()}` };
      setPlants((prev) =>
        prev.map((p) =>
          p.id === selectedPlant.id
            ? { ...p, logs: [newLog, ...p.logs] }
            : p
        )
      );
      setSelectedPlant((prev) =>
        prev ? { ...prev, logs: [newLog, ...prev.logs] } : null
      );
      setShowLogForm(false);
    },
    [selectedPlant]
  );

  const handleNameChange = useCallback(
    (plantId: string, name: string) => {
      setPlants((prev) =>
        prev.map((p) => (p.id === plantId ? { ...p, name } : p))
      );
      setSelectedPlant((prev) =>
        prev && prev.id === plantId ? { ...prev, name } : prev
      );
    },
    []
  );

  const handleAddPlant = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!newPlantName.trim()) return;
      const newPlant: Plant = {
        id: `p${Date.now()}`,
        name: newPlantName.trim(),
        species: newPlantSpecies,
        photoFileName: newPlantPhoto || undefined,
        logs: [],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setPlants((prev) => [newPlant, ...prev]);
      setNewPlantAdded(newPlant.id);
      setNewPlantName('');
      setNewPlantSpecies('多肉');
      setNewPlantPhoto('');
      setShowAddForm(false);
      setCurrentPage(1);
      setTimeout(() => setNewPlantAdded(null), 600);
    },
    [newPlantName, newPlantSpecies, newPlantPhoto]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setNewPlantPhoto(file.name);
  };

  const activityIcon = (type: CareLog['activityType']) => {
    if (type === 'water') return <span className="log-icon water">💧</span>;
    if (type === 'fertilize') return <span className="log-icon fertilize">🧪</span>;
    return <span className="log-icon prune">✂️</span>;
  };

  const sortedLogs = selectedPlant
    ? [...selectedPlant.logs].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )
    : [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>🌱 植物养护日志</h1>
        <p className="app-subtitle">记录每一次呵护，见证每一寸生长</p>
      </header>

      <div className="plant-grid">
        <div className="plant-card add-card" onClick={() => setShowAddForm(true)}>
          <div className="add-icon">＋</div>
          <div className="add-label">添加植物</div>
        </div>
        {pagedPlants.map((plant) => (
          <PlantCard
            key={plant.id}
            plant={plant}
            onClick={() => handleSelectPlant(plant)}
            onNameChange={(name) => handleNameChange(plant.id, name)}
            isNew={plant.id === newPlantAdded}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="page-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            ‹ 上一页
          </button>
          <span className="page-info">
            {currentPage} / {totalPages}
          </span>
          <button
            className="page-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            下一页 ›
          </button>
        </div>
      )}

      {selectedPlant && (
        <div className="detail-overlay" onClick={handleClosePanel}>
          <div
            className="detail-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close-btn" onClick={handleClosePanel}>
              ✕
            </button>
            <div className="detail-header">
              <div className="detail-avatar">
                {selectedPlant.name.charAt(0).toUpperCase()}
              </div>
              <div className="detail-info">
                <h2>{selectedPlant.name}</h2>
                <span className="detail-species">{selectedPlant.species}</span>
              </div>
            </div>

            <div className="chart-section">
              <h3>水分摄入趋势（近30天）</h3>
              <div className="chart-container">
                <Line
                  data={generateWaterTrendData(selectedPlant.logs)}
                  options={waterTrendOptions() as never}
                />
              </div>
            </div>

            <div className="chart-section">
              <h3>施肥频率（近6个月）</h3>
              <div className="chart-container">
                <Bar
                  data={generateFertilizeBarData(selectedPlant.logs)}
                  options={fertilizeBarOptions() as never}
                />
              </div>
            </div>

            <div className="log-section">
              <h3>养护记录</h3>
              {sortedLogs.length === 0 ? (
                <p className="no-logs">暂无养护记录</p>
              ) : (
                <div className="log-list">
                  {sortedLogs.map((log) => (
                    <div key={log.id} className="log-item">
                      <div className="log-item-left">
                        {activityIcon(log.activityType)}
                        <div className="log-item-content">
                          <span className="log-activity-label">
                            {log.activityType === 'water'
                              ? '浇水'
                              : log.activityType === 'fertilize'
                              ? '施肥'
                              : '修剪'}
                          </span>
                          <span className="log-notes">{log.notes}</span>
                        </div>
                      </div>
                      <span className="log-date">{log.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              className={`fab ${fabOpen ? 'fab-open' : ''}`}
              onClick={() => {
                setFabOpen(!fabOpen);
                setShowLogForm(!showLogForm);
              }}
            >
              {fabOpen ? '✕' : '＋'}
            </button>
          </div>
        </div>
      )}

      {showLogForm && selectedPlant && (
        <LogForm
          onSubmit={handleAddLog}
          onCancel={() => {
            setShowLogForm(false);
            setFabOpen(false);
          }}
        />
      )}

      {showAddForm && (
        <div className="log-form-overlay" onClick={() => setShowAddForm(false)}>
          <div className="log-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="log-form-title">添加新植物</h3>
            <form onSubmit={handleAddPlant}>
              <div className="form-group">
                <label>植物名称</label>
                <input
                  type="text"
                  value={newPlantName}
                  onChange={(e) => setNewPlantName(e.target.value)}
                  className="form-input"
                  placeholder="输入植物名称..."
                  required
                />
              </div>
              <div className="form-group">
                <label>上传照片</label>
                <div className="file-upload-wrapper">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="file-input"
                    id="photo-upload"
                  />
                  <label htmlFor="photo-upload" className="file-upload-btn">
                    选择图片
                  </label>
                  {newPlantPhoto && (
                    <span className="file-name">{newPlantPhoto}</span>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>植物种类</label>
                <select
                  value={newPlantSpecies}
                  onChange={(e) => setNewPlantSpecies(e.target.value)}
                  className="form-input"
                >
                  {SPECIES_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-cancel"
                  onClick={() => setShowAddForm(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-submit">
                  添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
