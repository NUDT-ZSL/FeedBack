import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MapView from './components/MapView';
import DispatchPanel from './components/DispatchPanel';
import LogBook from './components/LogBook';
import AlertBanner from './components/AlertBanner';
import useStore from './store';
import './App.css';

function App() {
  const {
    updateMovingHorses,
    cleanupParticles,
    checkTimeouts,
    updateSoldierRest,
  } = useStore();

  useEffect(() => {
    let animationId: number;
    let lastParticleTime = 0;
    let lastCheckTime = 0;

    const gameLoop = (timestamp: number) => {
      const currentTime = Date.now();
      
      updateMovingHorses(currentTime);
      updateSoldierRest(currentTime);
      
      if (currentTime - lastCheckTime > 500) {
        checkTimeouts(currentTime);
        lastCheckTime = currentTime;
      }
      
      if (currentTime - lastParticleTime > 100) {
        cleanupParticles(currentTime);
        lastParticleTime = currentTime;
      }

      animationId = requestAnimationFrame(gameLoop);
    };

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [updateMovingHorses, cleanupParticles, checkTimeouts, updateSoldierRest]);

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <div className="app-container">
              <header className="app-header">
                <h1 className="app-title">🏇 兵部车驾司 · 驿馆调度台</h1>
                <p className="app-subtitle">大明王朝驿马接力文书传递系统</p>
              </header>
              <AlertBanner />
              <main className="app-main">
                <DispatchPanel />
                <MapView />
                <LogBook />
              </main>
            </div>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
