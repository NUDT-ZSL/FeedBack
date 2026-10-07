import { memo } from 'react';
import type { Perfume } from '../types';

interface IncenseProductProps {
  perfume: Perfume;
  size?: 'small' | 'large';
}

export const IncenseProduct = memo(function IncenseProduct({
  perfume,
  size = 'large',
}: IncenseProductProps) {
  const scale = size === 'small' ? 0.5 : 1;

  const renderIncense = () => {
    switch (perfume.type) {
      case '线香':
        return <IncenseStick scale={scale} ingredients={perfume.ingredients} />;
      case '香丸':
        return <IncensePill scale={scale} ingredients={perfume.ingredients} />;
      case '香饼':
        return <IncenseCake scale={scale} />;
      default:
        return null;
    }
  };

  return (
    <div className="incense-product-wrapper">
      {renderIncense()}
      <style>{`
        .incense-product-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: ${120 * scale}px;
          position: relative;
        }
      `}</style>
    </div>
  );
});

function IncenseStick({
  scale,
  ingredients,
}: {
  scale: number;
  ingredients: { spiceId: string; percentage: number }[];
}) {
  const particles = ingredients.slice(0, 3);
  return (
    <div
      className="incense-stick"
      style={{ transform: `scale(${scale})` }}
    >
      <div className="stick-body">
        {particles.map((_, i) => (
          <div
            key={i}
            className="stick-particle"
            style={{
              top: `${20 + i * 25}%`,
              left: `${30 + (i % 2) * 30}%`,
            }}
          />
        ))}
      </div>
      <div className="stick-tip" />
      <div className="stick-glow" />
      <style>{`
        .incense-stick {
          position: relative;
          display: flex;
          align-items: center;
          transform-origin: center;
        }

        .stick-body {
          width: 8px;
          height: 160px;
          background: linear-gradient(
            180deg,
            #8b6914 0%,
            #5c4a0a 30%,
            #3d2817 70%,
            #2a1810 100%
          );
          border-radius: 4px;
          position: relative;
          box-shadow:
            inset 2px 0 4px rgba(0, 0, 0, 0.3),
            0 4px 8px rgba(0, 0, 0, 0.3);
        }

        .stick-body::before {
          content: '';
          position: absolute;
          left: 1px;
          top: 4px;
          width: 2px;
          height: calc(100% - 8px);
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.15) 0%,
            transparent 100%
          );
          border-radius: 1px;
        }

        .stick-particle {
          position: absolute;
          width: 3px;
          height: 3px;
          background: #c9a94e;
          border-radius: 50%;
          opacity: 0.6;
        }

        .stick-tip {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 12px;
          height: 12px;
          background: radial-gradient(
            circle,
            #ff6b35 0%,
            #e85d04 40%,
            #8b4513 100%
          );
          border-radius: 50%;
          box-shadow:
            0 0 10px #ff6b35,
            0 0 20px rgba(255, 107, 53, 0.5);
          animation: ember-glow 2s ease-in-out infinite;
        }

        .stick-glow {
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          width: 30px;
          height: 30px;
          background: radial-gradient(
            circle,
            rgba(255, 200, 100, 0.3) 0%,
            transparent 70%
          );
          border-radius: 50%;
          animation: ember-pulse 2s ease-in-out infinite;
        }

        @keyframes ember-glow {
          0%, 100% {
            box-shadow:
              0 0 10px #ff6b35,
              0 0 20px rgba(255, 107, 53, 0.5);
          }
          50% {
            box-shadow:
              0 0 15px #ff6b35,
              0 0 30px rgba(255, 107, 53, 0.7);
          }
        }

        @keyframes ember-pulse {
          0%, 100% {
            opacity: 0.5;
            transform: translateX(-50%) scale(1);
          }
          50% {
            opacity: 0.8;
            transform: translateX(-50%) scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}

function IncensePill({
  scale,
  ingredients,
}: {
  scale: number;
  ingredients: { spiceId: string; percentage: number }[];
}) {
  const veins = ingredients.slice(0, 4);
  return (
    <div
      className="incense-pill"
      style={{ transform: `scale(${scale})` }}
    >
      <div className="pill-shading" />
      <div className="pill-highlight" />
      {veins.map((_, i) => (
        <div
          key={i}
          className={`pill-vein vein-${i + 1}`}
        />
      ))}
      <style>{`
        .incense-pill {
          position: relative;
          width: 60px;
          height: 60px;
          background: radial-gradient(
            ellipse at 30% 30%,
            #8b6914 0%,
            #5c4a0a 40%,
            #3d2817 70%,
            #2a1810 100%
          );
          border-radius: 50%;
          box-shadow:
            inset -8px -8px 20px rgba(0, 0, 0, 0.5),
            0 8px 16px rgba(0, 0, 0, 0.4);
        }

        .pill-shading {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(
            ellipse at 60% 70%,
            transparent 40%,
            rgba(0, 0, 0, 0.3) 100%
          );
        }

        .pill-highlight {
          position: absolute;
          top: 8px;
          left: 12px;
          width: 15px;
          height: 10px;
          background: radial-gradient(
            ellipse,
            rgba(255, 255, 255, 0.25) 0%,
            transparent 70%
          );
          border-radius: 50%;
          transform: rotate(-20deg);
        }

        .pill-vein {
          position: absolute;
          background: rgba(42, 24, 16, 0.4);
          border-radius: 2px;
        }

        .vein-1 {
          width: 20px;
          height: 3px;
          top: 20px;
          left: 15px;
          transform: rotate(15deg);
        }

        .vein-2 {
          width: 15px;
          height: 2px;
          top: 30px;
          left: 25px;
          transform: rotate(-10deg);
        }

        .vein-3 {
          width: 18px;
          height: 2px;
          top: 40px;
          left: 20px;
          transform: rotate(25deg);
        }

        .vein-4 {
          width: 12px;
          height: 3px;
          top: 25px;
          left: 35px;
          transform: rotate(-25deg);
        }
      `}</style>
    </div>
  );
}

function IncenseCake({ scale }: { scale: number }) {
  return (
    <div
      className="incense-cake"
      style={{ transform: `scale(${scale})` }}
    >
      <div className="cake-body">
        <div className="cake-stamp">
          <svg viewBox="0 0 40 40" className="stamp-svg">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#8b6914" strokeWidth="1.5" />
            <path
              d="M20 8 L14 20 L20 32 L26 20 Z"
              fill="none"
              stroke="#8b6914"
              strokeWidth="1"
            />
            <circle cx="20" cy="20" r="5" fill="#8b6914" opacity="0.6" />
            <text
              x="20"
              y="38"
              textAnchor="middle"
              fill="#8b6914"
              fontSize="5"
              fontFamily="serif"
            >
              瑞兰阁
            </text>
          </svg>
        </div>
        <div className="cake-edge" />
        <div className="cake-highlight" />
      </div>
      <style>{`
        .incense-cake {
          position: relative;
          transform-origin: center;
        }

        .cake-body {
          width: 140px;
          height: 60px;
          background: linear-gradient(
            180deg,
            #8b6914 0%,
            #5c4a0a 30%,
            #3d2817 70%,
            #2a1810 100%
          );
          border-radius: 50% / 30%;
          position: relative;
          box-shadow:
            inset 0 -10px 20px rgba(0, 0, 0, 0.4),
            0 8px 16px rgba(0, 0, 0, 0.4);
        }

        .cake-edge {
          position: absolute;
          inset: 4px;
          border-radius: 50% / 30%;
          border: 2px solid rgba(139, 105, 20, 0.3);
        }

        .cake-highlight {
          position: absolute;
          top: 6px;
          left: 20px;
          width: 40px;
          height: 15px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.2) 0%,
            transparent 100%
          );
          border-radius: 50%;
          transform: rotate(-5deg);
        }

        .cake-stamp {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          opacity: 0.7;
        }

        .stamp-svg {
          width: 100%;
          height: 100%;
        }
      `}</style>
    </div>
  );
}
