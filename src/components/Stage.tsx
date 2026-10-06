// 主舞台（依赖 store 状态、framer-motion）
import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '@/store';
import Monkey from '@/components/Monkey';
import Audience from '@/components/Audience';
import Coin from '@/components/Coin';

const Stage = memo(function Stage() {
  const monkey = useGameStore((s) => s.monkey);
  const audience = useGameStore((s) => s.audience);
  const coins = useGameStore((s) => s.coins);
  const ribbonActive = useGameStore((s) => s.ribbonActive);

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border-4"
      style={{
        borderColor: 'var(--wood)',
        background:
          'linear-gradient(to bottom, #f5e6c8 0%, #f5e6c8 55%, #7a8a7a 55%, #6b7b6b 100%)',
      }}
    >
      {/* 戏棚横幅 */}
      <div
        className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md px-6 py-1 text-lg font-bold tracking-widest text-amber-100 shadow"
        style={{ backgroundColor: 'var(--wood)' }}
      >
        长 安 西 市 · 百 戏
      </div>

      {/* 木竿：200px 竹黄色 */}
      <div
        className="absolute z-0 rounded-full"
        style={{
          left: '50%',
          top: '18%',
          height: '200px',
          width: '10px',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(to right, #b98d4f, #d4a76a 40%, #b98d4f)',
          boxShadow: '2px 2px 4px rgba(0,0,0,0.25)',
        }}
      />
      {/* 竿顶小旗 */}
      <div
        className="absolute z-0"
        style={{
          left: 'calc(50% + 5px)',
          top: '18%',
          width: 0,
          height: 0,
          borderTop: '8px solid transparent',
          borderBottom: '8px solid transparent',
          borderLeft: '18px solid #c0392b',
        }}
      />

      <Audience audience={audience} />
      <Monkey monkey={monkey} />

      {/* 彩绫加护提示 */}
      <AnimatePresence>
        {ribbonActive && (
          <motion.div
            key="ribbon"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 top-[52%] z-20 -translate-x-1/2 rounded-full bg-pink-100/90 px-3 py-0.5 text-xs text-pink-700 shadow"
          >
            🎀 彩绫加护中：下次表演成功率 +20%
          </motion.div>
        )}
      </AnimatePresence>

      {/* 铜钱层 */}
      {coins.map((c) => (
        <Coin key={c.id} coin={c} />
      ))}

      {/* 罢工提示 */}
      {monkey.isStunned && (
        <div className="absolute left-1/2 top-[40%] z-20 -translate-x-1/2 rounded-lg bg-red-800/85 px-4 py-1 text-sm text-amber-100 shadow">
          猴子罢工了！喂根香蕉 🍌 或稍等片刻
        </div>
      )}
    </div>
  );
});

export default Stage;
