import { useState, useEffect } from 'react';
import type { Plant, WateringRecord } from '../types';
import { initialPlants, plantSpecies, plantImages, initialWateringRecords } from '../data';
import { v4 as uuidv4 } from 'uuid';
import './Home.scss';

export default function Home() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set());
  const [wateringMap, setWateringMap] = useState<Record<string, WateringRecord[]>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlant, setNewPlant] = useState({ name: '', species: plantSpecies[0].name });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setPlants(initialPlants);
      const map: Record<string, WateringRecord[]> = {};
      initialPlants.forEach(p => {
        map[p.id] = initialWateringRecords
          .filter(r => r.plantId === p.id)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 3);
      });
      setWateringMap(map);
      setLoaded(true);
    }, 100);
  }, []);

  const toggleFlip = (id: string) => {
    setFlippedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddPlant = () => {
    if (!newPlant.name.trim()) return;
    const species = plantSpecies.find(s => s.name === newPlant.species) || plantSpecies[0];
    const plant: Plant = {
      id: uuidv4(),
      name: newPlant.name,
      species: species.name,
      icon: species.icon,
      image: plantImages[Math.floor(Math.random() * plantImages.length)],
      status: 'watered',
      addedAt: new Date().toISOString(),
      lastWateredAt: null,
    };
    setPlants([...plants, plant]);
    setWateringMap({ ...wateringMap, [plant.id]: [] });
    setNewPlant({ name: '', species: plantSpecies[0].name });
    setShowAddModal(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlants(plants.filter(p => p.id !== id));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="home-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">我的植物墙</h1>
          <p className="page-subtitle">共 {plants.length} 株植物，一起茁壮成长吧 🌱</p>
        </div>
        <button className="btn" onClick={() => setShowAddModal(true)}>
          <span style={{ marginRight: 6 }}>➕</span> 添加植物
        </button>
      </div>

      <div className="plant-grid">
        {plants.map((plant, idx) => (
          <div
            key={plant.id}
            className={`plant-card-wrapper ${loaded ? 'visible' : ''}`}
            style={{ animationDelay: `${idx * 200}ms` }}
          >
            <div
              className={`plant-card ${flippedCards.has(plant.id) ? 'flipped' : ''}`}
              onClick={() => toggleFlip(plant.id)}
            >
              <div className="plant-card-face plant-card-front">
                <div className="plant-image-wrap">
                  <img src={plant.image} alt={plant.name} className="plant-image" />
                  <button className="delete-btn" onClick={(e) => handleDelete(plant.id, e)}>✕</button>
                </div>
                <div className="plant-info">
                  <h3 className="plant-name">{plant.name}</h3>
                  <p className="plant-species">{plant.icon} {plant.species}</p>
                </div>
                <div className="plant-status">
                  <span className="status-icon">{plant.icon}</span>
                  {plant.status === 'needs_water' ? (
                    <span className="status-badge needs-water">
                      <span className="water-drop">💧</span>
                      需要浇水
                    </span>
                  ) : (
                    <span className="status-badge watered">
                      <span className="check-icon">✓</span>
                      已浇水
                    </span>
                  )}
                </div>
              </div>

              <div className="plant-card-face plant-card-back">
                <h3 className="back-title">💧 最近浇水记录</h3>
                <div className="watering-list">
                  {(wateringMap[plant.id] || []).length === 0 ? (
                    <p className="empty-hint">暂无浇水记录</p>
                  ) : (
                    (wateringMap[plant.id] || []).map(record => (
                      <div key={record.id} className="watering-item">
                        <div className="watering-header">
                          <span className={`watering-type type-${record.type}`}>
                            {record.type === 'water' ? '💧 浇水' : record.type === 'fertilize' ? '🌿 施肥' : '🪴 换盆'}
                          </span>
                          <span className="watering-operator">{record.operatorName}</span>
                        </div>
                        <div className="watering-time">{formatDate(record.timestamp)}</div>
                        {record.note && <div className="watering-note">{record.note}</div>}
                      </div>
                    ))
                  )}
                </div>
                <p className="flip-hint">点击卡片翻回</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content card" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">添加新植物 🌱</h2>
            <div className="form-group">
              <label>植物昵称</label>
              <input
                type="text"
                className="form-input"
                placeholder="给它起个名字吧"
                value={newPlant.name}
                onChange={e => setNewPlant({ ...newPlant, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>品种</label>
              <select
                className="form-input"
                value={newPlant.species}
                onChange={e => setNewPlant({ ...newPlant, species: e.target.value })}
              >
                {plantSpecies.map(s => (
                  <option key={s.name} value={s.name}>{s.icon} {s.name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>取消</button>
              <button className="btn" onClick={handleAddPlant}>确认添加</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
