import { memo, useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Perfume } from '../types';

interface IncenseBoxProps {
  isOpen: boolean;
  onClose: () => void;
  perfumes: Perfume[];
  onSelectPerfume: (perfume: Perfume) => void;
  onDeletePerfume: (id: string) => void;
  onGoToList: () => void;
}

export const IncenseBox = memo(function IncenseBox({
  isOpen,
  onClose,
  perfumes,
  onSelectPerfume,
  onDeletePerfume,
  onGoToList,
}: IncenseBoxProps) {
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAnimating(true);
    }
  }, [isOpen]);

  const handleAnimationEnd = () => {
    if (!isOpen) {
      setAnimating(false);
    }
  };

  if (!isOpen && !animating) return null;

  return (
    <div className="box-overlay" onClick={onClose}>
      <div
        className={`box-container ${isOpen ? 'open' : 'closed'}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="box-hinge" />

        <div className="box-lid">
          <div className="lid-inner">
            <div className="lid-silk">
              <div className="silk-text">瑞兰阁珍藏</div>
              <div className="silk-pattern" />
            </div>
          </div>
          <div className="lid-outer">
            <div className="lid-clasp" />
            <div className="lid-ornament" />
          </div>
        </div>

        <div className="box-base">
          <div className="base-inner">
            <div className="box-header">
              <h3 className="box-title">个人香匣</h3>
              <span className="box-count">
                {perfumes.length}/12
              </span>
              <button
                className="box-list-btn"
                onClick={onGoToList}
                title="查看完整列表"
              >
                <Plus size={16} />
                列表
              </button>
              <button className="box-close" onClick={onClose}>
                <X size={20} />
              </button>
            </div>

            <div className="box-grid">
              {Array.from({ length: 12 }).map((_, idx) => {
                const perfume = perfumes[idx];
                return (
                  <div key={idx} className="box-slot">
                    {perfume ? (
                      <div className="slot-item">
                        <div
                          className="slot-preview"
                          onClick={() => onSelectPerfume(perfume)}
                        >
                          <MiniPerfumePreview perfume={perfume} />
                        </div>
                        <div className="slot-name">{perfume.name}</div>
                        <button
                          className="slot-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeletePerfume(perfume.id);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="slot-empty">
                        <span className="slot-plus">+</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .box-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          animation: fade-in 0.3s ease;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .box-container {
          position: relative;
          width: 600px;
          max-width: 90vw;
          perspective: 1000px;
        }

        .box-hinge {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 60px;
          height: 8px;
          background: linear-gradient(
            180deg,
            #c9a94e 0%,
            #8b6914 100%
          );
          border-radius: 0 0 4px 4px;
          z-index: 10;
        }

        .box-hinge::before,
        .box-hinge::after {
          content: '';
          position: absolute;
          top: 0;
          width: 6px;
          height: 6px;
          background: #5c3a21;
          border-radius: 50%;
        }

        .box-hinge::before { left: 8px; }
        .box-hinge::after { right: 8px; }

        .box-lid {
          position: relative;
          height: 80px;
          transform-origin: top center;
          transform-style: preserve-3d;
        }

        .box-container.open .box-lid {
          animation: lid-open 0.3s ease forwards;
        }

        .box-container.closed .box-lid {
          animation: lid-close 0.3s ease forwards;
        }

        @keyframes lid-open {
          0% { transform: rotateX(0deg); }
          100% { transform: rotateX(-120deg); }
        }

        @keyframes lid-close {
          0% { transform: rotateX(-120deg); }
          100% { transform: rotateX(0deg); }
        }

        .lid-inner {
          position: absolute;
          inset: 0;
          background: #1a1410;
          border-radius: 8px 8px 0 0;
          padding: 8px;
          transform: translateZ(1px);
        }

        .lid-silk {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            #d4af37 0%,
            #c9a94e 50%,
            #b8941f 100%
          );
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .silk-text {
          font-size: 18px;
          font-weight: 600;
          color: #3d2817;
          letter-spacing: 8px;
          z-index: 2;
        }

        .silk-pattern {
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(
              45deg,
              transparent 0px,
              transparent 10px,
              rgba(255, 255, 255, 0.1) 10px,
              rgba(255, 255, 255, 0.1) 20px
            );
        }

        .lid-outer {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            #2a1810 0%,
            #1a1410 100%
          );
          border-radius: 8px 8px 0 0;
          border: 3px solid #3d2817;
          transform: translateZ(-1px) rotateY(180deg);
          backface-visibility: hidden;
        }

        .lid-clasp {
          position: absolute;
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          width: 40px;
          height: 12px;
          background: linear-gradient(
            180deg,
            #c9a94e 0%,
            #8b6914 100%
          );
          border-radius: 2px;
        }

        .lid-ornament {
          position: absolute;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 80px;
          height: 30px;
          border: 2px solid #c9a94e;
          border-radius: 4px;
          opacity: 0.5;
        }

        .box-base {
          background: linear-gradient(
            180deg,
            #2a1810 0%,
            #1a1410 100%
          );
          border: 3px solid #3d2817;
          border-top: none;
          border-radius: 0 0 8px 8px;
          padding: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .base-inner {
          background: linear-gradient(
            180deg,
            #f5ead6 0%,
            #e8d5b7 100%
          );
          border-radius: 4px;
          padding: 16px;
          min-height: 300px;
        }

        .box-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 2px solid rgba(201, 169, 78, 0.3);
        }

        .box-title {
          flex: 1;
          font-size: 20px;
          font-weight: 600;
          color: #3d2817;
          margin: 0;
        }

        .box-count {
          font-size: 14px;
          color: #8b6914;
          font-weight: 500;
        }

        .box-list-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px;
          background: linear-gradient(
            135deg,
            #c9a94e 0%,
            #8b6914 100%
          );
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
        }

        .box-list-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(201, 169, 78, 0.4);
        }

        .box-close {
          background: none;
          border: none;
          color: #5c3a21;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .box-close:hover {
          background: rgba(92, 58, 33, 0.1);
          color: #c94c4c;
        }

        .box-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }

        @media (max-width: 600px) {
          .box-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        .box-slot {
          aspect-ratio: 1;
          position: relative;
        }

        .slot-item {
          width: 100%;
          height: 100%;
          background: rgba(201, 169, 78, 0.1);
          border: 2px solid rgba(201, 169, 78, 0.3);
          border-radius: 8px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .slot-item:hover {
          transform: translateY(-2px);
          border-color: #c9a94e;
          box-shadow: 0 4px 12px rgba(201, 169, 78, 0.3);
        }

        .slot-preview {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }

        .slot-name {
          font-size: 11px;
          color: #3d2817;
          text-align: center;
          margin-top: 4px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .slot-delete {
          position: absolute;
          top: 4px;
          right: 4px;
          background: rgba(201, 76, 76, 0.9);
          color: white;
          border: none;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: all 0.2s ease;
        }

        .slot-item:hover .slot-delete {
          opacity: 1;
        }

        .slot-empty {
          width: 100%;
          height: 100%;
          background: rgba(92, 58, 33, 0.05);
          border: 2px dashed rgba(92, 58, 33, 0.2);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .slot-plus {
          font-size: 24px;
          color: rgba(92, 58, 33, 0.3);
        }
      `}</style>
    </div>
  );
});

function MiniPerfumePreview({ perfume }: { perfume: Perfume }) {
  const getColor = () => {
    const typeColors = {
      线香: '#8b6914',
      香丸: '#c9a94e',
      香饼: '#5c4a0a',
    };
    return typeColors[perfume.type];
  };

  return (
    <div className="mini-preview">
      {perfume.type === '线香' && (
        <div className="mini-stick" style={{ backgroundColor: getColor() }} />
      )}
      {perfume.type === '香丸' && (
        <div className="mini-pill" style={{ backgroundColor: getColor() }} />
      )}
      {perfume.type === '香饼' && (
        <div className="mini-cake" style={{ backgroundColor: getColor() }} />
      )}
      <style>{`
        .mini-preview {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }

        .mini-stick {
          width: 4px;
          height: 40px;
          border-radius: 2px;
        }

        .mini-pill {
          width: 24px;
          height: 24px;
          border-radius: 50%;
        }

        .mini-cake {
          width: 36px;
          height: 16px;
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
}
