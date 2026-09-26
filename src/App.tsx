import { useEffect } from 'react';
import { useGameStore } from './store/useGameStore';
import GameCanvas from './components/GameCanvas';
import StartScreen from './components/StartScreen';
import EnergyBar from './components/EnergyBar';
import VictoryScreen from './components/VictoryScreen';
import GameOverScreen from './components/GameOverScreen';

function App() {
  const { phase, setInput } = useGameStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          setInput({ up: true });
          break;
        case 's':
        case 'arrowdown':
          setInput({ down: true });
          break;
        case 'a':
        case 'arrowleft':
          setInput({ left: true });
          break;
        case 'd':
        case 'arrowright':
          setInput({ right: true });
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          setInput({ up: false });
          break;
        case 's':
        case 'arrowdown':
          setInput({ down: false });
          break;
        case 'a':
        case 'arrowleft':
          setInput({ left: false });
          break;
        case 'd':
        case 'arrowright':
          setInput({ right: false });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setInput]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0D0D0D',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <GameCanvas />
      </div>

      {phase === 'start' && <StartScreen />}

      {phase === 'playing' && <EnergyBar />}

      {phase === 'victory' && <VictoryScreen />}

      {phase === 'gameover' && <GameOverScreen />}
    </div>
  );
}

export default App;
