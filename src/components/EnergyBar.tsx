import { useGameStore } from '../store/useGameStore';

function EnergyBar() {
  const { ship, collectedFragments, elapsedTime } = useGameStore();

  const energyPercent = (ship.energy / ship.maxEnergy) * 100;
  const isLowEnergy = energyPercent < 30;

  const energyColor = (percent: number) => {
    if (percent > 60) return '#00FF00';
    if (percent > 30) return '#FFFF00';
    return '#FF0000';
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        left: '20px',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div>
        <div
          style={{
            fontSize: '14px',
            color: '#00FFFF',
            textShadow: '0 0 8px #00FFFF',
            marginBottom: '6px',
            fontWeight: 600,
          }}
        >
          能量
        </div>
        <div
          style={{
            width: '200px',
            height: '16px',
            backgroundColor: '#1A1A2E',
            border: '2px solid #4A4A5A',
            borderRadius: '4px',
            overflow: 'hidden',
            boxShadow: '0 0 10px rgba(0, 255, 255, 0.2)',
          }}
        >
          <div
            style={{
              width: `${energyPercent}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${energyColor(energyPercent)} 0%, ${energyColor(energyPercent * 0.7)} 100%)`,
              transition: 'width 0.2s ease, background 0.3s ease',
              animation: isLowEnergy
                ? 'energyPulse 0.5s ease-in-out infinite'
                : 'none',
              boxShadow: `0 0 10px ${energyColor(energyPercent)}`,
            }}
          />
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#888',
            marginTop: '4px',
          }}
        >
          {Math.round(ship.energy)} / {ship.maxEnergy}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div
          style={{
            fontSize: '14px',
            color: '#FFD700',
            textShadow: '0 0 8px rgba(255, 215, 0, 0.5)',
          }}
        >
          碎片: {collectedFragments}
        </div>
        <div
          style={{
            fontSize: '14px',
            color: '#9B59B6',
            textShadow: '0 0 8px rgba(155, 89, 182, 0.5)',
          }}
        >
          时间: {formatTime(elapsedTime)}
        </div>
      </div>

      <style>{`
        @keyframes energyPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

export default EnergyBar;
