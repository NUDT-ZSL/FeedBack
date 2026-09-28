import React, { useState, useCallback } from 'react';
import type { MaterialType, ModelType } from './types';
import { MATERIAL_CONFIGS } from './types';
import Scene from './components/Scene';
import ControlPanel from './components/ControlPanel';

const App: React.FC = () => {
  const [modelType, setModelType] = useState<ModelType>('tshirt');
  const [materialType, setMaterialType] = useState<MaterialType>('cotton');
  const [wrinkleIntensity, setWrinkleIntensity] = useState(50);
  const [ambientIntensity, setAmbientIntensity] = useState(0.8);
  const [lightAngle, setLightAngle] = useState(45);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleModelChange = useCallback((newModel: ModelType) => {
    if (newModel === modelType) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setModelType(newModel);
      setTimeout(() => {
        setIsTransitioning(false);
      }, 50);
    }, 300);
  }, [modelType]);

  const handleMaterialChange = useCallback((newMaterial: MaterialType) => {
    setMaterialType(newMaterial);
    const materialName = MATERIAL_CONFIGS[newMaterial].name;
    setToastMessage(`材质已切换为${materialName}`);
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  }, []);

  const handleScreenshot = useCallback(() => {
    const win = window as unknown as { __takeScreenshot?: () => void };
    if (typeof win.__takeScreenshot === 'function') {
      win.__takeScreenshot();
    }
  }, []);

  const sunPosition = {
    left: `${50 - Math.cos((lightAngle * Math.PI) / 180) * 50}%`,
    bottom: `${Math.sin((lightAngle * Math.PI) / 180) * 100}%`
  };

  return (
    <div className="app-container">
      <nav className="navbar">
        <h1>织物布料褶皱与光影模拟器</h1>
      </nav>

      <div className="main-content">
        <div className="scene-container">
          <div className="sun-indicator">
            <div className="sun-orbit">
              <div className="sun-icon" style={sunPosition} />
            </div>
          </div>

          <Scene
            modelType={modelType}
            materialType={materialType}
            wrinkleIntensity={wrinkleIntensity}
            ambientIntensity={ambientIntensity}
            lightAngle={lightAngle}
            isTransitioning={isTransitioning}
          />
        </div>

        <ControlPanel
          modelType={modelType}
          materialType={materialType}
          wrinkleIntensity={wrinkleIntensity}
          ambientIntensity={ambientIntensity}
          lightAngle={lightAngle}
          onModelChange={handleModelChange}
          onMaterialChange={handleMaterialChange}
          onWrinkleChange={setWrinkleIntensity}
          onAmbientChange={setAmbientIntensity}
          onLightAngleChange={setLightAngle}
          onScreenshot={handleScreenshot}
        />
      </div>

      <div className={`material-toast ${toastMessage ? 'show' : ''}`}>
        {toastMessage}
      </div>
    </div>
  );
};

export default App;
