import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import useStore from '../store';
import HorseIcon from './HorseIcon';
import { URGENCY_COLORS, URGENCY_LABELS, STATION_NAMES, getStationIndex } from '../utils';

const DispatchPanel = () => {
  const {
    stations,
    horses,
    soldier,
    selectedStation,
    selectedHorse,
    selectedDocument,
    selectHorse,
    selectDocument,
    dispatchDocument,
    restSoldier,
  } = useStore(state => ({
    stations: state.stations,
    horses: state.horses,
    soldier: state.soldier,
    selectedStation: state.selectedStation,
    selectedHorse: state.selectedHorse,
    selectedDocument: state.selectedDocument,
    selectHorse: state.selectHorse,
    selectDocument: state.selectDocument,
    dispatchDocument: state.dispatchDocument,
    restSoldier: state.restSoldier,
  }));

  const [restCountdown, setRestCountdown] = useState(0);

  useEffect(() => {
    if (soldier.isResting && soldier.restEndTime) {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((soldier.restEndTime! - Date.now()) / 1000));
        setRestCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    } else {
      setRestCountdown(0);
    }
  }, [soldier.isResting, soldier.restEndTime]);

  const currentStation = stations.find(s => s.id === selectedStation);
  const pendingDocs = currentStation?.documents.filter(d => d.status === 'pending') || [];
  const isLowStamina = soldier.stamina < 30;
  const canDispatch = selectedStation && selectedHorse && selectedDocument && !soldier.isResting && soldier.stamina > 0;

  const getStationName = (stationId: string) => {
    const idx = getStationIndex(stationId);
    return STATION_NAMES[idx] || stationId;
  };

  return (
    <div className="dispatch-container">
      <div className="panel dispatch-panel">
        <div className="panel-header">
          <h2 className="panel-title">📯 调度指挥</h2>
        </div>
        <div className="panel-body dispatch-body">
          <div className="soldier-section">
            <div className="soldier-info">
              <span className="soldier-avatar">
                {isLowStamina ? '😰' : '🧑‍✈️'}
              </span>
              <div className="soldier-details">
                <span className="soldier-name">驿卒 · 王七</span>
                <span className={`stamina-label ${isLowStamina ? 'low' : ''}`}>
                  {isLowStamina ? '体力不足' : '状态良好'}
                </span>
              </div>
            </div>
            <div className="stamina-bar-container">
              <div className="stamina-bar-bg">
                <motion.div
                  className="stamina-bar-fill"
                  initial={{ width: '100%' }}
                  animate={{ width: `${soldier.stamina}%` }}
                  transition={{ duration: 0.3 }}
                  style={{
                    backgroundColor: isLowStamina ? '#ef4444' : '#22c55e',
                  }}
                />
              </div>
              <span className="stamina-value">{soldier.stamina}/100</span>
            </div>
            <button
              className="btn rest-btn"
              onClick={restSoldier}
              disabled={soldier.isResting || soldier.stamina >= 100}
            >
              {soldier.isResting ? (
                <>
                  <span className="hourglass-icon">⏳</span>
                  <span> 休息中 ({restCountdown}s)</span>
                </>
              ) : (
                <>💤 休息恢复 (+30)</>
              )}
            </button>
          </div>

          <div className="divider"></div>

          <div className="station-info-section">
            <h3 className="section-label">📍 当前驿站</h3>
            <div className="station-display">
              {selectedStation ? (
                <span className="station-name">
                  🏠 {currentStation?.name}
                </span>
              ) : (
                <span className="station-hint">请在地图上选择驿站</span>
              )}
            </div>
          </div>

          <div className="divider"></div>

          <div className="horses-section">
            <h3 className="section-label">🐎 选择驿马</h3>
            <div className="horses-grid">
              {horses.map(horse => (
                <div key={horse.id} className="horse-item">
                  <HorseIcon
                    selected={selectedHorse === horse.id}
                    onClick={() => !horse.available || selectHorse(selectedHorse === horse.id ? null : horse.id)}
                    disabled={!horse.available}
                  />
                  <span className={`horse-name ${!horse.available ? 'unavailable' : ''}`}>
                    {horse.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="divider"></div>

          <div className="documents-section">
            <h3 className="section-label">📜 待发文书</h3>
            {!selectedStation ? (
              <p className="empty-hint">请先选择驿站</p>
            ) : pendingDocs.length === 0 ? (
              <p className="empty-hint">该驿站暂无待发文书</p>
            ) : (
              <div className="documents-list">
                {pendingDocs.map(doc => (
                  <motion.div
                    key={doc.id}
                    className={`document-item ${selectedDocument === doc.id ? 'selected' : ''}`}
                    onClick={() => selectDocument(selectedDocument === doc.id ? null : doc.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.1 }}
                  >
                    <div className="doc-main">
                      <span className="doc-code">{doc.code}</span>
                      <span
                        className="urgency-tag"
                        style={{ backgroundColor: URGENCY_COLORS[doc.urgency] }}
                      >
                        {URGENCY_LABELS[doc.urgency]}
                      </span>
                    </div>
                    <div className="doc-destination">
                      目的地：{getStationName(doc.toStation)}
                    </div>
                    <div className="doc-timelimit">
                      时限：{doc.timeLimit}秒
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          <div className="divider"></div>

          <button
            className="btn btn-primary dispatch-btn"
            onClick={dispatchDocument}
            disabled={!canDispatch}
          >
            🚀 发送文书
          </button>

          {!canDispatch && selectedStation && (
            <p className="dispatch-hint">
              {!selectedHorse && '请选择驿马'}
              {selectedHorse && !selectedDocument && '请选择文书'}
              {soldier.isResting && '驿卒正在休息'}
              {soldier.stamina <= 0 && '驿卒体力耗尽，请休息'}
            </p>
          )}
        </div>
      </div>

      <style>{`
        .dispatch-container {
          flex: 0 0 17.5%;
          min-width: 240px;
          display: flex;
          flex-direction: column;
        }

        .dispatch-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .dispatch-body {
          flex: 1;
          padding: 12px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .dispatch-body::-webkit-scrollbar {
          width: 6px;
        }

        .dispatch-body::-webkit-scrollbar-track {
          background: rgba(139, 90, 43, 0.1);
          border-radius: 3px;
        }

        .dispatch-body::-webkit-scrollbar-thumb {
          background: rgba(139, 90, 43, 0.4);
          border-radius: 3px;
        }

        .soldier-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .soldier-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .soldier-avatar {
          font-size: 36px;
        }

        .soldier-details {
          display: flex;
          flex-direction: column;
        }

        .soldier-name {
          font-size: 14px;
          font-weight: 600;
          color: #3d2914;
        }

        .stamina-label {
          font-size: 12px;
          color: #22c55e;
        }

        .stamina-label.low {
          color: #ef4444;
        }

        .stamina-bar-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stamina-bar-bg {
          flex: 1;
          height: 12px;
          background: rgba(139, 90, 43, 0.2);
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid #8b5a2b;
        }

        .stamina-bar-fill {
          height: 100%;
          border-radius: 5px;
          transition: width 0.3s ease;
        }

        .stamina-value {
          font-size: 12px;
          font-weight: 600;
          color: #3d2914;
          min-width: 45px;
        }

        .rest-btn {
          width: 100%;
          padding: 8px 12px;
          font-size: 13px;
        }

        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, #8b5a2b, transparent);
          margin: 4px 0;
        }

        .section-label {
          font-size: 13px;
          font-weight: 600;
          color: #5c3d1e;
          margin: 0 0 8px;
          letter-spacing: 1px;
        }

        .station-info-section {
          display: flex;
          flex-direction: column;
        }

        .station-display {
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid #c9b896;
          border-radius: 4px;
        }

        .station-name {
          font-size: 14px;
          font-weight: 600;
          color: #3d2914;
        }

        .station-hint {
          font-size: 13px;
          color: #8b7355;
          font-style: italic;
        }

        .horses-section {
          display: flex;
          flex-direction: column;
        }

        .horses-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
          gap: 8px;
        }

        .horse-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .horse-icon {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.5);
          border: 2px solid #8b5a2b;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .horse-icon:hover:not(.disabled) {
          background: rgba(255, 255, 255, 0.8);
          border-color: #5c3d1e;
        }

        .horse-icon.selected {
          background: #d4a574;
          border-color: #8b5a2b;
          box-shadow: 0 0 10px rgba(139, 90, 43, 0.5);
        }

        .horse-icon.disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .horse-emoji {
          font-size: 24px;
        }

        .horse-name {
          font-size: 10px;
          color: #5c3d1e;
          text-align: center;
        }

        .horse-name.unavailable {
          color: #999;
          text-decoration: line-through;
        }

        .documents-section {
          display: flex;
          flex-direction: column;
        }

        .documents-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 200px;
          overflow-y: auto;
        }

        .documents-list::-webkit-scrollbar {
          width: 4px;
        }

        .documents-list::-webkit-scrollbar-track {
          background: rgba(139, 90, 43, 0.1);
        }

        .documents-list::-webkit-scrollbar-thumb {
          background: rgba(139, 90, 43, 0.4);
        }

        .document-item {
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.4);
          border: 2px solid #c9b896;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .document-item:hover {
          background: rgba(255, 255, 255, 0.6);
          border-color: #8b5a2b;
        }

        .document-item.selected {
          background: rgba(212, 165, 116, 0.3);
          border-color: #8b5a2b;
          box-shadow: 0 0 8px rgba(139, 90, 43, 0.3);
        }

        .doc-main {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }

        .doc-code {
          font-size: 12px;
          font-weight: 600;
          color: #3d2914;
        }

        .urgency-tag {
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
          color: #fff;
          text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.3);
        }

        .doc-destination {
          font-size: 11px;
          color: #6b4423;
          margin-bottom: 2px;
        }

        .doc-timelimit {
          font-size: 10px;
          color: #8b7355;
        }

        .dispatch-btn {
          width: 100%;
          padding: 12px;
          font-size: 15px;
          letter-spacing: 2px;
        }

        .dispatch-hint {
          text-align: center;
          font-size: 12px;
          color: #8b7355;
          margin: 0;
        }

        .empty-hint {
          text-align: center;
          font-size: 12px;
          color: #8b7355;
          padding: 16px;
          font-style: italic;
          margin: 0;
        }

        @media (max-width: 800px) {
          .dispatch-container {
            flex: 0 0 auto;
            order: 2;
          }

          .horses-grid {
            grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
          }
        }
      `}</style>
    </div>
  );
};

export default DispatchPanel;
