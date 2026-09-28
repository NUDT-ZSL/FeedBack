import React, { useState } from 'react';
import { Plant } from '../utils/types';
import {
  getPlantStatus,
  PLANT_STATUS_PRESENTATION,
} from '../utils/plantStatus';

interface PlantCardProps {
  plant: Plant;
  onClick: () => void;
  onNameChange: (name: string) => void;
  isNew?: boolean;
}

const PlantCard: React.FC<PlantCardProps> = ({ plant, onClick, onNameChange, isNew }) => {
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState(plant.name);
  const status = getPlantStatus(plant);
  const statusPresentation = PLANT_STATUS_PRESENTATION[status];

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
        <span
          className={`status-icon${status === 'needs-water' ? ' blinking' : ''}`}
          title={statusPresentation.title}
        >
          {statusPresentation.icon}
        </span>
        <span className="status-label">{statusPresentation.label}</span>
      </div>
      <div className="plant-species">{plant.species}</div>
    </div>
  );
};

export default PlantCard;
