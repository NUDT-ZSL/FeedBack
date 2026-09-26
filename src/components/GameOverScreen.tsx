import { useGameStore } from '../store/useGameStore';

function GameOverScreen() {
  const { elapsedTime, collectedFragments, startGame } = useGameStore();

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}分${secs}秒`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        animation: 'fadeIn 0.5s ease-out',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1A0F3D 0%, #0D0D0D 100%)',
          borderRadius: '20px',
          padding: '48px 64px',
          textAlign: 'center',
          boxShadow: '0 0 40px rgba(255, 0, 0, 0.2)',
          border: '2px solid #666',
        }}
      >
        <h2
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: '#FF4444',
            textShadow: '0 0 20px rgba(255, 0, 0, 0.6)',
            margin: '0 0 32px 0',
          }}
        >
          时空失稳，游戏结束
        </h2>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            marginBottom: '40px',
          }}
        >
          <div style={{ fontSize: '20px', color: '#E0E0E0' }}>
            存活时间:{' '}
            <span
              style={{
                color: '#00FFFF',
                textShadow: '0 0 10px #00FFFF',
                fontWeight: 600,
              }}
            >
              {formatTime(elapsedTime)}
            </span>
          </div>
          <div style={{ fontSize: '20px', color: '#E0E0E0' }}>
            收集碎片:{' '}
            <span
              style={{
                color: '#FFD700',
                textShadow: '0 0 10px #FFD700',
                fontWeight: 600,
              }}
            >
              {collectedFragments} 个
            </span>
          </div>
          <div style={{ fontSize: '20px', color: '#E0E0E0' }}>
            得分:{' '}
            <span
              style={{
                color: '#9B59B6',
                textShadow: '0 0 10px #9B59B6',
                fontWeight: 600,
              }}
            >
              {Math.round(elapsedTime * 10 + collectedFragments * 100)}
            </span>
          </div>
        </div>

        <button
          onClick={startGame}
          style={{
            padding: '14px 48px',
            fontSize: '20px',
            fontWeight: 600,
            color: 'white',
            background: 'linear-gradient(135deg, #6A0DAD 0%, #9B59B6 100%)',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            boxShadow: '0 0 20px rgba(106, 13, 173, 0.5)',
            transition: 'all 200ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow =
              '0 0 30px rgba(155, 89, 182, 0.7)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow =
              '0 0 20px rgba(106, 13, 173, 0.5)';
          }}
        >
          重新开始
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default GameOverScreen;
