import React from 'react';
import type { MaterialType, ModelType } from '../types';
import { MATERIAL_CONFIGS, MODEL_NAMES } from '../types';

interface ControlPanelProps {
  modelType: ModelType;
  materialType: MaterialType;
  wrinkleIntensity: number;
  ambientIntensity: number;
  lightAngle: number;
  onModelChange: (model: ModelType) => void;
  onMaterialChange: (material: MaterialType) => void;
  onWrinkleChange: (value: number) => void;
  onAmbientChange: (value: number) => void;
  onLightAngleChange: (value: number) => void;
  onScreenshot: () => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  modelType,
  materialType,
  wrinkleIntensity,
  ambientIntensity,
  lightAngle,
  onModelChange,
  onMaterialChange,
  onWrinkleChange,
  onAmbientChange,
  onLightAngleChange,
  onScreenshot
}) => {
  const models: ModelType[] = ['tshirt', 'skirt', 'scarf'];
  const materials: MaterialType[] = ['cotton', 'silk', 'denim', 'wool'];

  return (
    <div className="control-panel">
      <div className="control-group">
        <label className="control-label">服装版型</label>
        <div className="model-buttons">
          {models.map((model) => (
            <button
              key={model}
              className={`model-button ${modelType === model ? 'active' : ''}`}
              onClick={() => onModelChange(model)}
            >
              {MODEL_NAMES[model]}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label className="control-label">布料材质</label>
        <select
          className="select-control"
          value={materialType}
          onChange={(e) => onMaterialChange(e.target.value as MaterialType)}
        >
          {materials.map((mat) => (
            <option key={mat} value={mat}>
              {MATERIAL_CONFIGS[mat].name}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label className="control-label">
          褶皱强度
          <span className="slider-value">{wrinkleIntensity}</span>
        </label>
        <input
          type="range"
          className="slider-control"
          min={0}
          max={100}
          value={wrinkleIntensity}
          onChange={(e) => onWrinkleChange(Number(e.target.value))}
        />
      </div>

      <div className="control-group">
        <label className="control-label">
          环境光强度
          <span className="slider-value">{ambientIntensity.toFixed(2)}</span>
        </label>
        <input
          type="range"
          className="slider-control"
          min={0}
          max={2}
          step={0.01}
          value={ambientIntensity}
          onChange={(e) => onAmbientChange(Number(e.target.value))}
        />
      </div>

      <div className="control-group">
        <label className="control-label">
          光源高度角
          <span className="slider-value">{lightAngle}°</span>
        </label>
        <div className="knob-container">
          <div
            className="knob"
            style={{
              transform: `rotate(${lightAngle - 90}deg)`,
              background: `conic-gradient(from -90deg, #1a237e 0deg, #7b1fa2 ${lightAngle * 2}deg, #4a5568 ${lightAngle * 2}deg, #4a5568 360deg)`
            }}
          />
          <input
            type="range"
            className="slider-control"
            min={0}
            max={90}
            value={lightAngle}
            onChange={(e) => onLightAngleChange(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="control-group">
        <button className="button" onClick={onScreenshot}>
          <span className="button-icon">📷</span>
          保存截图
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;
