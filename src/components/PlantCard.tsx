import React, { useState } from 'react';
import { Plant } from '../utils/chartHelper';

interface PlantCardProps {
  plant: Plant;
  onClick: () => void;
  onNameChange: (name: string) => void;
  isNew?: boolean;
}

function getPlantStatus(plant: Plant): 'needs-water' | 'healthy' | 'wilted' {
  const now = new Date();
  const waterLogs = plant.logs.filter((l) => l.activityType === 'water');
  if (waterLogs.length === 0) return 'wilted';
  const lastWater = new Date(waterLogs[0].date);
  const diffDays = Math.floor((now.getTime() - lastWater.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 7) return 'wilted';
  if (diffDays >= 4) return 'needs-water';
  return 'healthy';
}

const PlantCard: React.FC<PlantCardProps> = ({ plant, onClick, onNameChange, isNew }) => {
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState(plant.name);
  const status = getPlantStatus(plant);

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
    setTempName(plant.name);
  };

  const handleNameBlur = () => {
    setEditing(false);
    if (tempName.trim()) {
      onNameChange(tempName.trim());
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNameBlur();
    if (e.key === 'Escape') {
      setTempName(plant.name);
      setEditing(false);
    }
  };

  return (
    <div
      className={`plant-card ${isNew ? 'plant-card-enter' : ''}`}
      onClick={onClick}
    >
      <div className="plant-avatar">
        {plant.name.charAt(0).toUpperCase()}
      </div>
      <div className="plant-card-name">
        {editing ? (
          <input
            className="plant-name-input"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span onClick={handleNameClick} className="plant-name-text">
            {plant.name}
          </span>
        )}
      </div>
      <div className={`plant-status plant-status-${status}`}>
        {status === 'needs-water' && (
          <span className="status-icon blinking" title="需要浇水">💧</span>
        )}
        {status === 'healthy' && (
          <span className="status-icon" title="健康">🍃</span>
        )}
        {status === 'wilted' && (
          <span className="status-icon" title="缺水">🥀</span>
        )}
        <span className="status-label">
          {status === 'needs-water' ? '需浇水' : status === 'healthy' ? '健康' : '缺水'}
        </span>
      </div>
      <div className="plant-species">{plant.species}</div>
    </div>
  );
};

export default PlantCard;
