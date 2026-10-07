import { memo, useEffect, useState, useRef } from 'react';
import { SmokeParticles } from './SmokeParticles';
import type { EffectKey } from '../types';

interface CenserProps {
  burning: boolean;
  effectText: string;
  dominantEffect: EffectKey;
  onClose: () => void;
}

export const Censer = memo(function Censer({
  burning,
  effectText,
  dominantEffect,
  onClose,
}: CenserProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [showText, setShowText] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (burning) {
      setDisplayedText('');
      setShowText(false);

      timeoutRef.current = setTimeout(() => {
        setShowText(true);
        let index = 0;
        const typeInterval = setInterval(() => {
          if (index < effectText.length) {
            setDisplayedText(effectText.slice(0, index + 1));
            index++;
          } else {
            clearInterval(typeInterval);
          }
        }, 150);

        return () => clearInterval(typeInterval);
      }, 1000);
    } else {
      setShowText(false);
      setDisplayedText('');
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [burning, effectText]);

  if (!burning) return null;

  return (
    <div className="censer-overlay" onClick={onClose}>
      <div className="censer-container" onClick={(e) => e.stopPropagation()}>
        <button className="censer-close" onClick={onClose}>
          ×
        </button>

        <div className="censer-effect-text" style={{ opacity: showText ? 1 : 0 }}>
          {displayedText}
          <span className="cursor">|</span>
        </div>

        <div className="censer-wrapper">
          <SmokeParticles
            active={burning}
            color="rgba(255, 255, 255, 0.6)"
            particleCount={50}
            riseHeight={200}
            duration={4000}
          />

          <div className="censer">
            <div className="censer-lid">
              <div className="lid-knob" />
              <div className="lid-openings">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="lid-opening"
                    style={{ transform: `rotate(${i * 60}deg)` }}
                  />
                ))}
              </div>
            </div>

            <div className="censer-body">
              <div className="censer-pattern">
                <svg viewBox="0 0 120 60" className="pattern-svg">
                  <path
                    d="M10 30 Q30 10 60 30 Q90 50 110 30"
                    fill="none"
                    stroke="rgba(0, 0, 0, 0.3)"
                    strokeWidth="2"
                  />
                  <path
                    d="M10 30 Q30 50 60 30 Q90 10 110 30"
                    fill="none"
                    stroke="rgba(0, 0, 0, 0.3)"
                    strokeWidth="2"
                  />
                  <circle cx="20" cy="30" r="4" fill="rgba(0, 0, 0, 0.2)" />
                  <circle cx="60" cy="30" r="6" fill="rgba(0, 0, 0, 0.25)" />
                  <circle cx="100" cy="30" r="4" fill="rgba(0, 0, 0, 0.2)" />
                </svg>
              </div>
              <div className="censer-glow" />
            </div>

            <div className="censer-legs">
              <div className="leg leg-left" />
              <div className="leg leg-center" />
              <div className="leg leg-right" />
            </div>
          </div>

          <div className="censer-shadow" />
        </div>
      </div>

      <style>{`
        .censer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          animation: fade-in 0.5s ease;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .censer-container {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px;
        }

        .censer-close {
          position: absolute;
          top: 0;
          right: 0;
          width: 40px;
          height: 40px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 50%;
          color: #f7e7b4;
          font-size: 24px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .censer-close:hover {
          background: rgba(255, 255, 255, 0.2);
          transform: scale(1.1);
        }

        .censer-effect-text {
          font-size: 32px;
          font-weight: 600;
          color: #f7e7b4;
          text-shadow:
            0 0 20px rgba(247, 231, 180, 0.5),
            0 2px 4px rgba(0, 0, 0, 0.5);
          margin-bottom: 40px;
          letter-spacing: 8px;
          transition: opacity 0.5s ease;
          min-height: 40px;
        }

        .cursor {
          animation: blink 1s infinite;
          color: #f7e7b4;
        }

        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }

        .censer-wrapper {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .censer {
          position: relative;
          z-index: 1;
        }

        .censer-lid {
          width: 180px;
          height: 60px;
          background: linear-gradient(
            180deg,
            #6b8e6b 0%,
            #5d825a 30%,
            #4a6b4a 70%,
            #3d5a3d 100%
          );
          border-radius: 90px 90px 10px 10px;
          position: relative;
          margin: 0 auto;
          box-shadow:
            inset 0 -4px 8px rgba(0, 0, 0, 0.4),
            0 4px 8px rgba(0, 0, 0, 0.3);
          border: 3px solid #3d5a3d;
        }

        .censer-lid::before {
          content: '';
          position: absolute;
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          width: 190px;
          height: 12px;
          background: linear-gradient(
            180deg,
            #5d825a 0%,
            #4a6b4a 100%
          );
          border-radius: 6px;
          border: 2px solid #3d5a3d;
        }

        .lid-knob {
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          width: 30px;
          height: 25px;
          background: linear-gradient(
            180deg,
            #6b8e6b 0%,
            #5d825a 100%
          );
          border-radius: 50% 50% 30% 30%;
          border: 2px solid #3d5a3d;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .lid-knob::before {
          content: '';
          position: absolute;
          top: 5px;
          left: 50%;
          transform: translateX(-50%);
          width: 8px;
          height: 8px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 50%;
        }

        .lid-openings {
          position: absolute;
          top: 15px;
          left: 50%;
          transform: translateX(-50%);
          width: 60px;
          height: 60px;
        }

        .lid-opening {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 8px;
          height: 25px;
          background: rgba(0, 0, 0, 0.4);
          border-radius: 4px;
          transform-origin: center top;
        }

        .censer-body {
          width: 200px;
          height: 100px;
          background: linear-gradient(
            180deg,
            #5d825a 0%,
            #4a6b4a 30%,
            #3d5a3d 60%,
            #2d4a2d 100%
          );
          border-radius: 10px 10px 50px 50px;
          position: relative;
          margin-top: -4px;
          box-shadow:
            inset 0 -10px 20px rgba(0, 0, 0, 0.5),
            inset 0 5px 10px rgba(255, 255, 255, 0.1),
            0 8px 16px rgba(0, 0, 0, 0.4);
          border: 3px solid #3d5a3d;
          overflow: hidden;
        }

        .censer-body::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 15px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.15) 0%,
            transparent 100%
          );
        }

        .censer-pattern {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 120px;
          height: 60px;
          opacity: 0.8;
        }

        .pattern-svg {
          width: 100%;
          height: 100%;
        }

        .censer-glow {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 40px;
          height: 20px;
          background: radial-gradient(
            ellipse,
            rgba(255, 107, 53, 0.4) 0%,
            transparent 70%
          );
          animation: glow-pulse 2s ease-in-out infinite;
        }

        @keyframes glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }

        .censer-legs {
          display: flex;
          justify-content: space-between;
          width: 160px;
          margin: -4px auto 0;
          padding: 0 10px;
        }

        .leg {
          width: 20px;
          height: 35px;
          background: linear-gradient(
            180deg,
            #4a6b4a 0%,
            #3d5a3d 50%,
            #2d4a2d 100%
          );
          border-radius: 0 0 10px 10px;
          position: relative;
          border: 2px solid #2d4a2d;
          border-top: none;
        }

        .leg::before {
          content: '';
          position: absolute;
          bottom: -3px;
          left: 50%;
          transform: translateX(-50%);
          width: 26px;
          height: 8px;
          background: #2d4a2d;
          border-radius: 50%;
        }

        .leg-center {
          transform: translateY(10px);
        }

        .censer-shadow {
          width: 180px;
          height: 30px;
          background: radial-gradient(
            ellipse,
            rgba(0, 0, 0, 0.5) 0%,
            transparent 70%
          );
          margin: 10px auto 0;
          filter: blur(4px);
        }
      `}</style>
    </div>
  );
});
