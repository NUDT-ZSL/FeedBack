import React from 'react';
import { useGameStore } from '../store/gameStore';
import { calculateTitle } from '../utils/gameLogic';
import { motion, AnimatePresence } from 'framer-motion';

const ScoreBoard: React.FC = () => {
  const { totalScore, pitchesRemaining, pitchHistory, gameOver, resetGame } =
    useGameStore();

  const titleInfo = calculateTitle(totalScore);

  return (
    <>
      <div className="score-board">
        <div className="score-title">投壶计分</div>
        <div className="score-content">
          <div className="score-item">
            <div className="score-label">剩余次数</div>
            <div className="score-value">{pitchesRemaining}</div>
          </div>
          <div className="score-item">
            <div className="score-label">总积分</div>
            <div className="score-value">{totalScore}</div>
          </div>
          <div className="score-item">
            <div className="score-label">投掷记录</div>
            <div style={{ marginTop: '5px' }}>
              {pitchHistory.map((record, index) => (
                <span
                  key={index}
                  className={`result-tag ${record.result}`}
                >
                  {record.label} +{record.score}
                </span>
              ))}
              {pitchHistory.length === 0 && (
                <span style={{ color: '#8b7355', fontSize: '12px' }}>
                  尚无记录
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {gameOver && (
          <motion.div
            className="game-over-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="title-container"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 15,
                delay: 0.2,
              }}
            >
              <div className="ribbon ribbon-1" />
              <div className="ribbon ribbon-2" />
              <div className="ribbon ribbon-3" />
              <div className="ribbon ribbon-4" />

              <motion.div
                className="title-text"
                style={{ color: titleInfo.color }}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                {titleInfo.title}
              </motion.div>

              <motion.div
                className="title-score"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
              >
                总分: {totalScore} 分
              </motion.div>

              <motion.button
                className="restart-btn"
                onClick={resetGame}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.9 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                再来一局
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ScoreBoard;
