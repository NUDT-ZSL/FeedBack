import { usePet } from './PetProvider';
import { PetStatus, STATUS_KEYS, getStatusLabel, getHealthScore } from './types';

function StatusBars({ status }: { status: PetStatus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {STATUS_KEYS.map(key => {
        const value = status[key];
        const pct = Math.max(0, Math.min(100, value));
        const isLow = pct < 30;
        return (
          <div key={key}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 4,
                fontFamily: "'Nunito', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                color: '#5D4037',
              }}
            >
              <span>{getStatusLabel(key)}</span>
              <span>{Math.round(pct)}%</span>
            </div>
            <div
              style={{
                width: '100%',
                height: 14,
                backgroundColor: '#EFEBE9',
                borderRadius: 7,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 7,
                  background: `linear-gradient(90deg, #E53935 ${0}%, #FFB300 ${50}%, #43A047 ${100}%)`,
                  backgroundSize: '200% 100%',
                  backgroundPosition: `${100 - pct}% 0`,
                  transition: 'width 0.3s ease-out',
                  animation: isLow ? 'statusBlink 0.5s infinite' : 'none',
                }}
              />
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes statusBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

function HealthStars({ status }: { status: PetStatus }) {
  const score = getHealthScore(status);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
      }}
    >
      <span
        style={{
          fontFamily: "'Nunito', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          color: '#5D4037',
          marginRight: 6,
        }}
      >
        综合健康:
      </span>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          style={{
            fontSize: 20,
            opacity: i < score ? 1 : 0.2,
            transition: 'opacity 0.3s ease-out',
            filter: i < score ? 'drop-shadow(0 1px 2px rgba(255,193,7,0.5))' : 'none',
          }}
        >
          ⭐
        </span>
      ))}
    </div>
  );
}

export default function PetActions() {
  const { state, dispatch } = usePet();
  const { pet } = state;

  if (!pet) return null;

  const isDisabled = pet.isDead;
  const isCollapsed = pet.isCollapsed && !pet.isDead;

  const handleAction = (actionType: 'FEED' | 'PLAY' | 'CLEAN') => {
    if (isCollapsed) {
      dispatch({ type: 'REVIVE' });
      setTimeout(() => dispatch({ type: actionType }), 50);
    } else {
      dispatch({ type: actionType });
    }
  };

  const buttons = [
    { action: 'FEED' as const, label: '🍖 喂食', color: '#FF8C42' },
    { action: 'PLAY' as const, label: '🎾 玩耍', color: '#F4D03F' },
    { action: 'CLEAN' as const, label: '🛁 清洁', color: '#4FC3F7' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <StatusBars status={pet.status} />
      <HealthStars status={pet.status} />

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        {buttons.map(btn => (
          <button
            key={btn.action}
            onClick={() => handleAction(btn.action)}
            disabled={isDisabled}
            style={{
              flex: 1,
              padding: '12px 8px',
              border: 'none',
              borderRadius: 12,
              backgroundColor: isDisabled ? '#D7CCC8' : btn.color,
              color: isDisabled ? '#9E9E9E' : '#FFF',
              fontSize: 14,
              fontWeight: 800,
              fontFamily: "'Nunito', sans-serif",
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              boxShadow: isDisabled
                ? 'none'
                : `0 4px 12px ${btn.color}55`,
              transition: 'all 0.3s ease-out',
              minHeight: 44,
            }}
            onMouseEnter={e => {
              if (!isDisabled) {
                (e.target as HTMLElement).style.transform = 'translateY(-2px)';
                (e.target as HTMLElement).style.boxShadow = `0 6px 16px ${btn.color}77`;
              }
            }}
            onMouseLeave={e => {
              (e.target as HTMLElement).style.transform = 'translateY(0)';
              (e.target as HTMLElement).style.boxShadow = isDisabled
                ? 'none'
                : `0 4px 12px ${btn.color}55`;
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
