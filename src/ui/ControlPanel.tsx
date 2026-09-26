import React, { useState, useCallback, useEffect, useRef } from 'react';
import { eventBus } from '@/utils/EventBus';
import type { ColorOption, MaterialOption, AccessoryOption, ProductConfig } from '@/scene/Scene3D';
import { Undo2 } from 'lucide-react';

interface ControlPanelProps {
  config: ProductConfig;
}

interface ConfigState {
  colorId: string;
  materialId: string;
  accessoryId: string;
}

interface HistoryEntry {
  config: ConfigState;
  type: 'color' | 'material' | 'accessory';
}

const LoadingSpinner: React.FC = () => (
  <span className="loading-spinner" />
);

export const ControlPanel: React.FC<ControlPanelProps> = ({ config }) => {
  const [currentConfig, setCurrentConfig] = useState<ConfigState>({
    colorId: config.defaultConfig.colorId,
    materialId: config.defaultConfig.materialId,
    accessoryId: config.defaultConfig.accessoryId,
  });

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [transitioningType, setTransitioningType] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);

  const historyRef = useRef(history);
  historyRef.current = history;

  const pushHistory = useCallback((type: 'color' | 'material' | 'accessory') => {
    setHistory((prev) => {
      const newHistory = [...prev, { config: { ...currentConfig }, type }];
      return newHistory.slice(-5);
    });
  }, [currentConfig]);

  const handleColorChange = useCallback((color: ColorOption) => {
    if (color.id === currentConfig.colorId || transitioningType) return;
    pushHistory('color');
    setCurrentConfig((prev) => ({ ...prev, colorId: color.id }));
    setTransitioningType('color');
    eventBus.emit('ConfigChange', { type: 'color', id: color.id });
  }, [currentConfig.colorId, transitioningType, pushHistory]);

  const handleMaterialChange = useCallback((material: MaterialOption) => {
    if (material.id === currentConfig.materialId || transitioningType) return;
    pushHistory('material');
    setCurrentConfig((prev) => ({ ...prev, materialId: material.id }));
    setTransitioningType('material');
    eventBus.emit('ConfigChange', { type: 'material', id: material.id });
  }, [currentConfig.materialId, transitioningType, pushHistory]);

  const handleAccessoryChange = useCallback((accessory: AccessoryOption) => {
    if (accessory.id === currentConfig.accessoryId || transitioningType) return;
    pushHistory('accessory');
    setCurrentConfig((prev) => ({ ...prev, accessoryId: accessory.id }));
    setTransitioningType('accessory');
    eventBus.emit('ConfigChange', { type: 'accessory', id: accessory.id });
  }, [currentConfig.accessoryId, transitioningType, pushHistory]);

  const handleUndo = useCallback(() => {
    if (history.length === 0 || transitioningType) return;
    const lastEntry = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setCurrentConfig(lastEntry.config);
    setTransitioningType(lastEntry.type);
    eventBus.emit('ConfigChange', { type: lastEntry.type, id: lastEntry.config[`${lastEntry.type}Id`] as string });
  }, [history, transitioningType]);

  useEffect(() => {
    const handler = () => {
      setTransitioningType(null);
    };
    eventBus.on('TransitionComplete', handler);
    return () => {
      eventBus.off('TransitionComplete', handler);
    };
  }, []);

  const currentColorOption = config.colors.find((c) => c.id === currentConfig.colorId);

  return (
    <div className="control-panel">
      <div className="panel-section">
        <h3 className="section-title">颜色</h3>
        <div className="color-swatches">
          {config.colors.map((color) => (
            <button
              key={color.id}
              className={`color-swatch ${currentConfig.colorId === color.id ? 'active' : ''}`}
              style={{ backgroundColor: color.hex }}
              title={color.name}
              onClick={() => handleColorChange(color)}
              onMouseDown={() => setPressedId(color.id)}
              onMouseUp={() => setPressedId(null)}
              onMouseLeave={() => setPressedId(null)}
              disabled={!!transitioningType}
            >
              {transitioningType === 'color' && currentConfig.colorId === color.id && <LoadingSpinner />}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3 className="section-title">材质</h3>
        <div className="material-buttons">
          {config.materials.map((material) => (
            <button
              key={material.id}
              className={`material-btn ${currentConfig.materialId === material.id ? 'active' : ''} ${pressedId === material.id ? 'pressed' : ''}`}
              onClick={() => handleMaterialChange(material)}
              onMouseDown={() => setPressedId(material.id)}
              onMouseUp={() => setPressedId(null)}
              onMouseLeave={() => setPressedId(null)}
              disabled={!!transitioningType}
            >
              {material.name}
              {transitioningType === 'material' && currentConfig.materialId === material.id && <LoadingSpinner />}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3 className="section-title">配件</h3>
        <div className="accessory-buttons">
          {config.accessories.map((accessory) => (
            <button
              key={accessory.id}
              className={`accessory-btn ${currentConfig.accessoryId === accessory.id ? 'active' : ''} ${pressedId === accessory.id ? 'pressed' : ''}`}
              onClick={() => handleAccessoryChange(accessory)}
              onMouseDown={() => setPressedId(accessory.id)}
              onMouseUp={() => setPressedId(null)}
              onMouseLeave={() => setPressedId(null)}
              disabled={!!transitioningType}
            >
              {accessory.name}
              {transitioningType === 'accessory' && currentConfig.accessoryId === accessory.id && <LoadingSpinner />}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-footer">
        <button
          className="undo-btn"
          onClick={handleUndo}
          disabled={history.length === 0 || !!transitioningType}
          title="撤销"
        >
          <Undo2 size={16} />
        </button>
        {currentColorOption && (
          <span className="current-color-label">{currentColorOption.name}</span>
        )}
      </div>
    </div>
  );
};
