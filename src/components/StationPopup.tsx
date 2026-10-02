import { motion } from 'framer-motion';
import type { PostStation } from '../types';
import { URGENCY_COLORS, URGENCY_LABELS } from '../utils';

interface StationPopupProps {
  station: PostStation;
  onClose: () => void;
}

const StationPopup = ({ station, onClose }: StationPopupProps) => {
  const pendingDocs = station.documents.filter(d => d.status === 'pending');

  return (
    <motion.div
      className="station-popup"
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="popup-header">
        <h3 className="popup-title">📜 {station.name}</h3>
        <button className="popup-close" onClick={onClose}>
          ✕
        </button>
      </div>
      
      <div className="popup-content">
        <div className="info-row">
          <span className="info-label">🐎 驻马数</span>
          <span className="info-value">{station.horses} 匹</span>
        </div>
        <div className="info-row">
          <span className="info-label">👤 驻卒数</span>
          <span className="info-value">{station.soldiers} 人</span>
        </div>

        <div className="divider"></div>

        <h4 className="section-title">📋 待发文书</h4>
        {pendingDocs.length === 0 ? (
          <p className="no-docs">暂无待发文书</p>
        ) : (
          <div className="docs-list">
            {pendingDocs.map(doc => (
              <div key={doc.id} className="doc-item">
                <span className="doc-code">{doc.code}</span>
                <span
                  className="urgency-tag"
                  style={{ backgroundColor: URGENCY_COLORS[doc.urgency] }}
                >
                  {URGENCY_LABELS[doc.urgency]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="popup-footer">
        <p className="hint">在左侧调度面板选择驿马和文书后发送</p>
      </div>

      <style>{`
        .station-popup {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: linear-gradient(180deg, #f5ecd7 0%, #e8dcc0 100%);
          border: 3px solid #8b5a2b;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(61, 41, 20, 0.5);
          width: 320px;
          max-width: 90%;
          z-index: 100;
          overflow: hidden;
        }

        .station-popup::before {
          content: '';
          position: absolute;
          top: 4px;
          left: 4px;
          right: 4px;
          bottom: 4px;
          border: 1px solid #8b5a2b;
          border-radius: 5px;
          pointer-events: none;
          opacity: 0.4;
        }

        .popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: linear-gradient(180deg, #b8a87a 0%, #a89868 100%);
          border-bottom: 2px solid #8b5a2b;
        }

        .popup-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: #3d2914;
          letter-spacing: 2px;
        }

        .popup-close {
          background: transparent;
          border: none;
          font-size: 18px;
          color: #5c3d1e;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .popup-close:hover {
          background: rgba(139, 90, 43, 0.2);
        }

        .popup-content {
          padding: 16px;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
        }

        .info-label {
          font-size: 14px;
          color: #6b4423;
        }

        .info-value {
          font-size: 16px;
          font-weight: 600;
          color: #3d2914;
        }

        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, #8b5a2b, transparent);
          margin: 12px 0;
        }

        .section-title {
          font-size: 14px;
          font-weight: 600;
          color: #5c3d1e;
          margin: 0 0 12px;
        }

        .no-docs {
          text-align: center;
          color: #8b7355;
          font-size: 13px;
          padding: 16px 0;
        }

        .docs-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .doc-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.5);
          border-radius: 4px;
          border: 1px solid #c9b896;
        }

        .doc-code {
          font-size: 13px;
          color: #3d2914;
          font-weight: 500;
        }

        .urgency-tag {
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          color: #fff;
          text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.3);
        }

        .popup-footer {
          padding: 12px 16px;
          background: rgba(139, 90, 43, 0.1);
          border-top: 1px solid #c9b896;
        }

        .hint {
          margin: 0;
          font-size: 12px;
          color: #8b7355;
          text-align: center;
        }
      `}</style>
    </motion.div>
  );
};

export default StationPopup;
