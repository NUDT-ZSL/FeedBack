import { memo } from 'react';
import { X } from 'lucide-react';
import type { MortarItem } from '../types';

interface MortarProps {
  items: MortarItem[];
  onRemove: (spiceId: string) => void;
  onUpdatePercentage: (spiceId: string, percentage: number) => void;
  onDrop: (e: React.MouseEvent | React.TouchEvent) => boolean;
  isDragOver: boolean;
}

export const Mortar = memo(function Mortar({
  items,
  onRemove,
  onUpdatePercentage,
  onDrop,
  isDragOver,
}: MortarProps) {
  return (
    <div
      className={`mortar-container ${isDragOver ? 'drag-over' : ''}`}
      onMouseUp={onDrop}
      onTouchEnd={onDrop}
    >
      <div className="mortar">
        <div className="mortar-bowl">
          <div className="mortar-inner">
            {items.length === 0 ? (
              <div className="mortar-empty">将香料罐拖入此处</div>
            ) : (
              <div className="mortar-spices">
                {items.map((item, index) => (
                  <div
                    key={item.spice.id}
                    className="mortar-spice-layer"
                    style={{
                      backgroundColor: item.spice.color,
                      height: `${Math.max(8, item.percentage * 0.4)}px`,
                      opacity: 0.7 - index * 0.08,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mortar-base" />
      </div>

      <div className="mortar-pestle" />

      {items.length > 0 && (
        <div className="mortar-items">
          {items.map((item) => (
            <div key={item.spice.id} className="mortar-item">
              <div className="mortar-item-header">
                <span
                  className="mortar-item-color"
                  style={{ backgroundColor: item.spice.color }}
                />
                <span className="mortar-item-name">{item.spice.name}</span>
                <button
                  className="mortar-item-remove"
                  onClick={() => onRemove(item.spice.id)}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mortar-item-slider">
                <input
                  type="range"
                  min="5"
                  max="80"
                  value={item.percentage}
                  onChange={(e) =>
                    onUpdatePercentage(item.spice.id, parseInt(e.target.value))
                  }
                  className="gold-slider"
                />
                <span className="mortar-item-percentage">
                  {item.percentage}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .mortar-container {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          transition: transform 0.2s ease;
        }

        .mortar-container.drag-over {
          transform: scale(1.05);
        }

        .mortar {
          position: relative;
          z-index: 2;
        }

        .mortar-bowl {
          width: 180px;
          height: 100px;
          background: linear-gradient(
            180deg,
            #6b5b4f 0%,
            #4a3c32 50%,
            #3d3028 100%
          );
          border-radius: 0 0 90px 90px;
          position: relative;
          box-shadow:
            inset 0 20px 40px rgba(0, 0, 0, 0.5),
            0 8px 20px rgba(0, 0, 0, 0.4);
          border: 3px solid #5a4a3e;
          overflow: hidden;
        }

        .mortar-bowl::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 12px;
          background: linear-gradient(
            180deg,
            #8b7355 0%,
            #6b5b4f 100%
          );
          border-radius: 50%;
          transform: translateY(-50%);
        }

        .mortar-inner {
          position: absolute;
          top: 15px;
          left: 10px;
          right: 10px;
          bottom: 10px;
          background: linear-gradient(
            180deg,
            #2a2018 0%,
            #1a1410 100%
          );
          border-radius: 0 0 80px 80px;
          overflow: hidden;
        }

        .mortar-empty {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.3);
          font-size: 12px;
          text-align: center;
          padding: 20px;
        }

        .mortar-spices {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          flex-direction: column-reverse;
          align-items: center;
        }

        .mortar-spice-layer {
          width: 90%;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .mortar-base {
          width: 80px;
          height: 20px;
          background: linear-gradient(
            180deg,
            #5a4a3e 0%,
            #3d3028 100%
          );
          margin: -5px auto 0;
          border-radius: 0 0 20px 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }

        .mortar-pestle {
          position: absolute;
          top: -30px;
          right: 20px;
          width: 15px;
          height: 120px;
          background: linear-gradient(
            90deg,
            #8b6914 0%,
            #c9a94e 50%,
            #8b6914 100%
          );
          border-radius: 8px;
          transform: rotate(25deg);
          box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.3);
          z-index: 3;
        }

        .mortar-pestle::before {
          content: '';
          position: absolute;
          bottom: -15px;
          left: 50%;
          transform: translateX(-50%);
          width: 30px;
          height: 25px;
          background: linear-gradient(
            180deg,
            #6b5b4f 0%,
            #4a3c32 100%
          );
          border-radius: 50%;
        }

        .mortar-items {
          margin-top: 20px;
          width: 280px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .mortar-item {
          background: rgba(92, 58, 33, 0.1);
          border: 1px solid rgba(201, 169, 78, 0.3);
          border-radius: 8px;
          padding: 10px 12px;
        }

        .mortar-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }

        .mortar-item-color {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid rgba(201, 169, 78, 0.5);
        }

        .mortar-item-name {
          flex: 1;
          font-size: 14px;
          font-weight: 500;
          color: #3d2817;
        }

        .mortar-item-remove {
          background: none;
          border: none;
          color: #8b4513;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .mortar-item-remove:hover {
          background: rgba(139, 69, 19, 0.1);
          color: #c94c4c;
        }

        .mortar-item-slider {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .gold-slider {
          flex: 1;
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          background: linear-gradient(
            90deg,
            #5c3a21 0%,
            #5c3a21 100%
          );
          border-radius: 4px;
          outline: none;
          position: relative;
        }

        .gold-slider::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: repeating-linear-gradient(
            90deg,
            transparent 0px,
            transparent 4px,
            rgba(201, 169, 78, 0.2) 4px,
            rgba(201, 169, 78, 0.2) 5px
          );
          border-radius: 4px;
          pointer-events: none;
        }

        .gold-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          background: linear-gradient(
            135deg,
            #c9a94e 0%,
            #8b6914 50%,
            #c9a94e 100%
          );
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #5c3a21;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
          transition: transform 0.2s ease;
          position: relative;
          z-index: 2;
        }

        .gold-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }

        .gold-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: linear-gradient(
            135deg,
            #c9a94e 0%,
            #8b6914 50%,
            #c9a94e 100%
          );
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #5c3a21;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }

        .mortar-item-percentage {
          width: 40px;
          text-align: right;
          font-size: 13px;
          font-weight: 600;
          color: #c9a94e;
        }
      `}</style>
    </div>
  );
});
