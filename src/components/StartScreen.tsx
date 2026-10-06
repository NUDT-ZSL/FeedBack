// 开场界面（被 Home 调用）
import { memo } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/store';

const StartScreen = memo(function StartScreen() {
  const phase = useGameStore((s) => s.phase);
  const bestScore = useGameStore((s) => s.bestScore);
  const startGame = useGameStore((s) => s.startGame);

  if (phase !== 'ready') return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="w-[340px] rounded-2xl border-4 p-6 text-center shadow-2xl"
        style={{ borderColor: 'var(--wood)', backgroundColor: '#fdf6e6' }}
        initial={{ scale: 0.85, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 18 }}
      >
        <div className="text-5xl">🐒</div>
        <h1 className="mt-2 text-2xl font-bold tracking-widest" style={{ color: 'var(--wood)' }}>
          唐代百戏 · 驯猴打赏
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#6b5437]">
          你是长安西市的驯猴艺人。60 秒内指挥猴子表演，
          博得看客打赏；管理疲劳、善用彩戏道具，
          冲击 <span className="font-bold text-[#8b6914]">300 文</span> 的金字招牌！
        </p>
        {bestScore > 0 && (
          <p className="mt-2 text-xs text-[#7a6444]">历史最佳：{bestScore} 文</p>
        )}
        <button
          type="button"
          onClick={startGame}
          className="btn-action mt-5 w-full rounded-lg py-3 text-lg font-bold text-white shadow"
          style={{ background: 'linear-gradient(135deg, #8b6f47, #6b5437)' }}
        >
          开 锣 演 出
        </button>
      </motion.div>
    </motion.div>
  );
});

export default StartScreen;
