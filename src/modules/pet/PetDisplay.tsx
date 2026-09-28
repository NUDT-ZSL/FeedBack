import React, { useEffect, useState } from 'react';
import { usePet } from './PetProvider';
import { PetAnimationState, PetType } from './types';
import { PIXEL_ART, PET_COLORS } from '../../mockService';

function getPixelGrid(type: PetType) {
  return PIXEL_ART[type] || PIXEL_ART.cat;
}

function getAnimationStyle(animation: PetAnimationState): React.CSSProperties {
  switch (animation) {
    case 'jump':
      return {
        transform: 'translateY(-16px)',
        transition: 'transform 0.3s ease-out',
      };
    case 'spin':
      return {
        transform: 'rotate(360deg)',
        transition: 'transform 0.3s ease-out',
      };
    case 'collapsed':
      return {};
    case 'dying':
      return {
        opacity: 0,
        transition: 'opacity 1.5s ease-out',
      };
    case 'dead':
      return {
        opacity: 0,
      };
    default:
      return {
        transform: 'translateY(0)',
        transition: 'transform 0.3s ease-out',
      };
  }
}

function PixelPet({ type, animation }: { type: PetType; animation: PetAnimationState }) {
  const grid = getPixelGrid(type);
  const colors = PET_COLORS[type];
  const [breathScale, setBreathScale] = useState(1.0);

  useEffect(() => {
    if (animation === 'collapsed') {
      let growing = false;
      const interval = setInterval(() => {
        growing = !growing;
        setBreathScale(growing ? 1.0 : 0.95);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setBreathScale(1.0);
    }
  }, [animation]);

  const animStyle = getAnimationStyle(animation);

  const pixelSize = 12;

  const colorMap: Record<string, string> = {
    '.': colors.primary,
    'o': colors.eye,
    '=': colors.secondary,
    'w': colors.accent,
    'a': colors.primary,
    'e': colors.accent,
  };

  return (
    <div
      style={{
        display: 'inline-block',
        ...animStyle,
        transform: `${animStyle.transform || ''} scale(${breathScale})`,
        imageRendering: 'pixelated',
      }}
    >
      <div style={{ lineHeight: 0 }}>
        {grid.map((row, y) => (
          <div key={y} style={{ height: pixelSize, display: 'flex', justifyContent: 'center' }}>
            {row.split('').map((char, x) => {
              if (char === ' ') return <div key={x} style={{ width: pixelSize, height: pixelSize }} />;
              return (
                <div
                  key={x}
                  style={{
                    width: pixelSize,
                    height: pixelSize,
                    backgroundColor: colorMap[char] || colors.primary,
                    borderRadius: char === 'o' ? '50%' : '1px',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FarewellAnimation() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        animation: 'fadeOut 1.5s ease-out forwards',
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16 }}>💔</div>
      <div style={{ fontSize: 16, color: '#999', fontFamily: "'Nunito', sans-serif" }}>
        宠物已经离开了...
      </div>
      <style>{`
        @keyframes fadeOut {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
          100% { opacity: 0; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}

export default function PetDisplay() {
  const { state } = usePet();
  const { pet, animation } = state;

  if (!pet) return null;

  if (animation === 'dead') {
    return <FarewellAnimation />;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 260,
        background: 'radial-gradient(circle at 50% 80%, #FFE0B2 0%, transparent 70%)',
        borderRadius: 16,
        padding: 24,
        position: 'relative',
      }}
    >
      <PixelPet type={pet.type} animation={animation} />
      <div
        style={{
          marginTop: 16,
          fontSize: 20,
          fontWeight: 800,
          fontFamily: "'Press Start 2P', cursive",
          color: '#FF8C42',
          letterSpacing: 1,
        }}
      >
        {pet.name}
      </div>
      {pet.isCollapsed && !pet.isDead && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: '#E53935',
            fontWeight: 700,
            fontFamily: "'Nunito', sans-serif",
            animation: 'blink 0.5s infinite',
          }}
        >
          ⚠️ 状态危急，快去照顾它！
        </div>
      )}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
