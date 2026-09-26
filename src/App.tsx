import React, { useEffect, useRef, useState } from 'react';
import { Scene3D, type ProductConfig } from '@/scene/Scene3D';
import { ControlPanel } from '@/ui/ControlPanel';

export default function App() {
  const sceneContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const [config, setConfig] = useState<ProductConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/product-config')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch config');
        return res.json();
      })
      .then((data: ProductConfig) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!config || !sceneContainerRef.current || sceneRef.current) return;

    sceneRef.current = new Scene3D(sceneContainerRef.current, config);

    return () => {
      if (sceneRef.current) {
        sceneRef.current.dispose();
        sceneRef.current = null;
      }
    };
  }, [config]);

  return (
    <div className="app-root">
      <nav className="navbar">
        <span className="navbar-title">Explorer</span>
      </nav>
      <div className="main-content">
        <div className="scene-container" ref={sceneContainerRef}>
          {loading && (
            <div className="loading-overlay">
              <div className="loading-pulse" />
              <span>加载产品配置...</span>
            </div>
          )}
          {error && (
            <div className="loading-overlay">
              <span className="error-text">加载失败: {error}</span>
            </div>
          )}
        </div>
        {config && <ControlPanel config={config} />}
      </div>
    </div>
  );
}
