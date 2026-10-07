import { memo } from 'react';
import type { Spice } from '../types';

interface SpiceJarProps {
  spice: Spice;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, spice: Spice) => void;
  disabled?: boolean;
}

export const SpiceJar = memo(function SpiceJar({
  spice,
  onDragStart,
  disabled,
}: SpiceJarProps) {
  return (
    <div
      className={`spice-jar-wrapper ${disabled ? 'disabled' : ''}`}
      onMouseDown={(e) => !disabled && onDragStart(e, spice)}
      onTouchStart={(e) => !disabled && onDragStart(e, spice)}
      title={spice.description}
    >
      <div className="spice-jar">
        <div className="jar-lid" />
        <div className="jar-body">
          <div className="jar-glaze" />
          <div className="jar-pattern" />
          <div
            className="jar-content"
            style={{ backgroundColor: spice.color }}
          />
          <div className="jar-label">
            <span className="jar-name">{spice.name}</span>
            <span className="jar-category">{spice.category}</span>
          </div>
        </div>
      </div>

      <style>{`
        .spice-jar-wrapper {
          width: 60px;
          height: 80px;
          cursor: ${disabled ? 'not-allowed' : 'grab'};
          position: relative;
          transition: transform 0.2s ease;
          user-select: none;
        }

        .spice-jar-wrapper:hover:not(.disabled) {
          transform: translateY(-4px) scale(1.05);
        }

        .spice-jar-wrapper:active:not(.disabled) {
          cursor: grabbing;
        }

        .spice-jar-wrapper.disabled {
          opacity: 0.4;
        }

        .spice-jar {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .jar-lid {
          width: 44px;
          height: 12px;
          background: linear-gradient(180deg, #8b6914 0%, #5c4a0a 100%);
          border-radius: 4px 4px 2px 2px;
          position: relative;
          z-index: 2;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .jar-lid::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 6px;
          background: linear-gradient(180deg, #c9a94e 0%, #8b6914 100%);
          border-radius: 3px 3px 0 0;
        }

        .jar-body {
          width: 52px;
          height: 60px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.4) 0%,
            rgba(220, 230, 240, 0.3) 50%,
            rgba(200, 210, 220, 0.35) 100%
          );
          border: 2px solid rgba(100, 120, 150, 0.3);
          border-radius: 8px 8px 12px 12px;
          position: relative;
          overflow: hidden;
          backdrop-filter: blur(2px);
          margin-top: -2px;
          box-shadow:
            inset 0 2px 10px rgba(255, 255, 255, 0.2),
            0 4px 8px rgba(0, 0, 0, 0.2);
        }

        .jar-glaze {
          position: absolute;
          top: 4px;
          left: 4px;
          width: 12px;
          height: 40px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.6) 0%,
            rgba(255, 255, 255, 0) 100%
          );
          border-radius: 6px;
          transform: rotate(-5deg);
        }

        .jar-pattern {
          position: absolute;
          inset: 4px;
          border: 1px solid rgba(30, 60, 100, 0.2);
          border-radius: 6px;
          background:
            radial-gradient(
              circle at 20% 30%,
              rgba(30, 60, 100, 0.15) 2px,
              transparent 2px
            ),
            radial-gradient(
              circle at 70% 60%,
              rgba(30, 60, 100, 0.1) 3px,
              transparent 3px
            ),
            radial-gradient(
              circle at 40% 80%,
              rgba(30, 60, 100, 0.12) 2px,
              transparent 2px
            );
          pointer-events: none;
        }

        .jar-content {
          position: absolute;
          bottom: 4px;
          left: 4px;
          right: 4px;
          height: 20px;
          border-radius: 0 0 8px 8px;
          opacity: 0.7;
          filter: saturate(0.8);
        }

        .jar-label {
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          text-align: center;
          width: 100%;
        }

        .jar-name {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #3d2817;
          text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
        }

        .jar-category {
          display: block;
          font-size: 9px;
          color: #5c3a21;
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
});
