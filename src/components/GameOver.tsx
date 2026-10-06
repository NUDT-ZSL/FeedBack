// 结算弹窗（被 Home 调用）
import { memo } from 'react';
import { motion } from 'framer-motion';
import { useGameStore, getRank } from '@/store';

const GameOver = memo(function GameOver() {
  const phase = useGameStore((s) => s.phase);
  const score = useGameStore((s) => s.lastRoundScore ?? 0);
  const bestScore = useGameStore((s) => s.bestScore);
  const startGame = useGameStore((s) => s.startGame);
  const resetGame = useGameStore((s) => s.resetGame);

  if (phase !== 'over') return null;

  const rank = getRank(score);
  const isNewBest = score >= bestScore && score > 0;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="w-[320px] rounded-2xl border-4 p-6 text-center shadow-2xl"
        style={{ borderColor: 'var(--wood)', backgroundColor: '#fdf6e6' }}
        initial={{ scale: 0.8, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        <h2 className="text-xl font-bold" style={{ color: 'var(--wood)' }}>演出落幕</h2>

        <div
          className="mx-auto my-4 flex h-20 w-20 items-center justify-center rounded-full border-4 text-3xl font-bold"
          style={{ borderColor: rank.color, color: rank.color, backgroundColor: `${rank.color}22` }}
        >
          {rank.label}
        </div>

        <p className="text-lg">
          最终打赏：<span className="font-bold text-[#8b6914]">{score}</span> 文
        </p>
        <p className="mt-1 text-sm text-[#7a6444]">
          {isNewBest ? '🎉 新纪录！' : `历史最佳：${bestScore} 文`}
        </p>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={startGame}
            className="btn-action flex-1 rounded-lg py-2 font-bold text-white shadow"
            style={{ background: 'linear-gradient(135deg, #8b6f47, #6b5437)' }}
          >
            再来一局
          </button>
          <button
            type="button"
            onClick={resetGame}
            className="btn-action flex-1 rounded-lg border-2 py-2 font-semibold"
            style={{ borderColor: 'var(--wood)', color: 'var(--wood)' }}
          >
            返回戏棚
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default GameOver;
