import { motion } from 'framer-motion';
import useStore from '../store';
import { formatTime } from '../utils';
import type { LogEntry } from '../types';

const LogBook = () => {
  const logs = useStore(state => state.logs);

  const getStatusText = (status: LogEntry['status']) => {
    switch (status) {
      case 'delivered':
        return '已送达';
      case 'in-transit':
        return '在途';
      case 'delayed':
        return '延误';
    }
  };

  const getStatusClass = (status: LogEntry['status']) => {
    switch (status) {
      case 'delivered':
        return 'status-delivered';
      case 'in-transit':
        return 'status-in-transit';
      case 'delayed':
        return 'status-delayed delayed-blink';
    }
  };

  return (
    <div className="logbook-container">
      <div className="panel logbook-panel">
        <div className="panel-header">
          <h2 className="panel-title">📖 驿事日志</h2>
        </div>
        <div className="panel-body logbook-body">
          <div className="bamboo-scroll">
            <div className="scroll-top"></div>
            <div className="scroll-content">
              {logs.length === 0 ? (
                <div className="empty-log">
                  <p className="empty-text">暂无传递记录</p>
                  <p className="empty-subtext">调度文书后将在此记录</p>
                </div>
              ) : (
                <div className="logs-list">
                  {logs.map((log, index) => (
                    <motion.div
                      key={log.id}
                      className="log-entry"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                    >
                      <div className="bamboo-strip">
                        <div className="log-header">
                          <span className="log-code">{log.documentCode}</span>
                          <span className={`log-status ${getStatusClass(log.status)}`}>
                            {getStatusText(log.status)}
                          </span>
                        </div>
                        <div className="log-route">
                          <span className="log-from">{log.fromStation}</span>
                          <span className="log-arrow">→</span>
                          <span className="log-to">{log.toStation}</span>
                        </div>
                        <div className="log-footer">
                          <span className="log-time">
                            发：{formatTime(log.dispatchTime)}
                          </span>
                          {log.arrivalTime && (
                            <span className="log-time">
                              收：{formatTime(log.arrivalTime)}
                            </span>
                          )}
                          {log.duration !== undefined && (
                            <span className="log-duration">
                              耗时：{log.duration.toFixed(1)}s
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
            <div className="scroll-bottom"></div>
          </div>
        </div>
      </div>

      <style>{`
        .logbook-container {
          flex: 0 0 17.5%;
          min-width: 240px;
          display: flex;
          flex-direction: column;
        }

        .logbook-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .logbook-body {
          flex: 1;
          padding: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .bamboo-scroll {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, #d4a574 0%, #c4956a 100%);
          border-radius: 8px;
          padding: 8px;
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.2);
          overflow: hidden;
        }

        .scroll-top,
        .scroll-bottom {
          height: 16px;
          background: linear-gradient(180deg, #8b5a2b 0%, #6b4423 100%);
          border-radius: 4px;
          flex-shrink: 0;
          position: relative;
        }

        .scroll-top::before,
        .scroll-bottom::before {
          content: '';
          position: absolute;
          left: 8px;
          right: 8px;
          top: 50%;
          height: 2px;
          background: #d4a574;
          transform: translateY(-50%);
        }

        .scroll-content {
          flex: 1;
          overflow-y: auto;
          padding: 8px 4px;
          margin: 4px 0;
          scroll-behavior: smooth;
        }

        .scroll-content::-webkit-scrollbar {
          width: 6px;
        }

        .scroll-content::-webkit-scrollbar-track {
          background: rgba(107, 68, 35, 0.3);
          border-radius: 3px;
        }

        .scroll-content::-webkit-scrollbar-thumb {
          background: rgba(92, 61, 30, 0.7);
          border-radius: 3px;
        }

        .empty-log {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 20px;
        }

        .empty-text {
          font-size: 14px;
          color: #5c3d1e;
          margin: 0 0 8px;
        }

        .empty-subtext {
          font-size: 12px;
          color: #6b4423;
          margin: 0;
          opacity: 0.8;
        }

        .logs-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .log-entry {
          width: 100%;
        }

        .bamboo-strip {
          background: linear-gradient(180deg, #f5e6d3 0%, #e8d5bc 100%);
          border: 2px solid #8b5a2b;
          border-radius: 4px;
          padding: 8px 10px;
          position: relative;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .bamboo-strip::before,
        .bamboo-strip::after {
          content: '';
          position: absolute;
          left: 4px;
          right: 4px;
          height: 1px;
          background: #8b5a2b;
          opacity: 0.3;
        }

        .bamboo-strip::before {
          top: 4px;
        }

        .bamboo-strip::after {
          bottom: 4px;
        }

        .log-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }

        .log-code {
          font-size: 12px;
          font-weight: 700;
          color: #3d2914;
          letter-spacing: 1px;
        }

        .log-status {
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
        }

        .status-delivered {
          background: #22c55e;
          color: #fff;
        }

        .status-in-transit {
          background: #eab308;
          color: #3d2914;
        }

        .status-delayed {
          background: #ef4444;
          color: #fff;
        }

        .log-route {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
          font-size: 11px;
        }

        .log-from,
        .log-to {
          color: #5c3d1e;
          font-weight: 500;
        }

        .log-arrow {
          color: #8b5a2b;
          font-weight: 700;
        }

        .log-footer {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          font-size: 10px;
          color: #6b4423;
        }

        .log-time {
          opacity: 0.8;
        }

        .log-duration {
          font-weight: 600;
          color: #5c3d1e;
        }

        @media (max-width: 800px) {
          .logbook-container {
            flex: 0 0 auto;
            order: 3;
            min-height: 300px;
          }

          .scroll-content {
            max-height: 250px;
          }
        }
      `}</style>
    </div>
  );
};

export default LogBook;
