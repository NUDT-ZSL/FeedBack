import { Star } from './types';
import { SPECTRAL_MAP } from './StarData';
import { X, Thermometer, Maximize2, Star as StarIcon } from 'lucide-react';
import './StarInfoCard.css';

interface StarInfoCardProps {
  star: Star | null;
  onClose: () => void;
}

export default function StarInfoCard({ star, onClose }: StarInfoCardProps) {
  if (!star) return null;

  const spectralInfo = SPECTRAL_MAP[star.spectralType];

  return (
    <div className="star-info-card">
      <div className="card-header">
        <div className="card-title-row">
          <div 
            className="star-color-indicator"
            style={{ backgroundColor: spectralInfo.color }}
          />
          <h3 className="star-name">{star.name}</h3>
        </div>
        <button className="close-btn" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="card-content">
        <div className="info-row">
          <div className="info-icon">
            <StarIcon size={16} />
          </div>
          <div className="info-label">光谱型</div>
          <div className="info-value">{star.spectralType}型</div>
        </div>

        <div className="info-row">
          <div className="info-icon">
            <Maximize2 size={16} />
          </div>
          <div className="info-label">视星等</div>
          <div className="info-value">{star.apparentMagnitude.toFixed(2)} mag</div>
        </div>

        <div className="info-row">
          <div className="info-icon distance-icon">
            <span className="distance-symbol">⟷</span>
          </div>
          <div className="info-label">距离</div>
          <div className="info-value">{star.distance.toFixed(0)} 光年</div>
        </div>

        <div className="info-row">
          <div className="info-icon">
            <Thermometer size={16} />
          </div>
          <div className="info-label">表面温度</div>
          <div className="info-value">{star.temperature.toLocaleString()} K</div>
        </div>

        <div className="spectral-bar-container">
          <div className="spectral-bar">
            <div 
              className="spectral-bar-fill"
              style={{ 
                background: `linear-gradient(to right, ${spectralInfo.color}, ${spectralInfo.color}88)`,
                width: `${((star.temperature - 2400) / 47600) * 100}%`
              }}
            />
          </div>
          <div className="spectral-bar-labels">
            <span>M</span>
            <span>K</span>
            <span>G</span>
            <span>F</span>
            <span>A</span>
            <span>B</span>
            <span>O</span>
          </div>
        </div>
      </div>
    </div>
  );
}
