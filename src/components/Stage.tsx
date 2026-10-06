// 主舞台：木竿、猴子动作动画、围观人群、铜钱抛物线与欢呼气泡。
// 数据来自 store（coins/cheers/monkey），猴子动作通过 actionSeq 触发 CSS 关键帧重放，
// 铜钱飞行用 framer-motion 关键帧实现抛物线，落地后由 CSS 闪烁两次。

import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store';
import {
  ACTIONS,
  COIN_FLIGHT_MS,
  GROUND_Y,
  MONKEY_X,
  POLE_COLOR,
  POLE_HEIGHT,
  SPECTATORS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from '@/config';

function SpectatorFigure({ x, height, color, name }: { x: number; height: number; color: string; name: string }) {
  const headSize = Math.round(height * 0.28);
  return (
    <div
      className="absolute flex flex-col items-center transition-transform duration-200 hover:scale-105"
      style={{ left: x - 14, bottom: STAGE_HEIGHT - GROUND_Y, width: 28 }}
      title={name}
    >
      <div
        className="rounded-full"
        style={{ width: headSize, height: headSize, background: '#f0c8a0', border: '2px solid #8b6f47' }}
      />
      <div
        style={{
          width: Math.round(height * 0.36),
          height: height - headSize,
          background: `linear-gradient(180deg, ${color}, ${color}cc)`,
          borderRadius: '8px 8px 3px 3px',
          border: '2px solid #8b6f47',
        }}
      />
    </div>
  );
}

export default function Stage() {
  const coins = useGameStore((s) => s.coins);
  const cheers = useGameStore((s) => s.cheers);
  const currentAction = useGameStore((s) => s.monkey.currentAction);
  const actionSeq = useGameStore((s) => s.monkey.actionSeq);
  const forcedRest = useGameStore((s) => s.monkey.forcedRestUntil !== null);
  const combo = useGameStore((s) => s.monkey.combo);

  const action = currentAction ? ACTIONS[currentAction] : null;

  return (
    <div
      className="relative overflow-hidden rounded-xl border-4 shadow-lg"
      style={{
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        maxWidth: '100%',
        background: 'linear-gradient(180deg, #f5e6c8 0%, #ecd9ae 70%, #e2cba0 100%)',
        borderColor: '#8b6f47',
      }}
    >
      {/* 地面：青灰砖纹 */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: STAGE_HEIGHT - GROUND_Y,
          background:
            'repeating-linear-gradient(90deg, #7a8a7a 0px, #7a8a7a 38px, #6d7d6d 38px, #6d7d6d 40px), repeating-linear-gradient(0deg, transparent 0px, transparent 18px, #6d7d6d 18px, #6d7d6d 20px)',
          backgroundColor: '#7a8a7a',
          borderTop: '3px solid #8b6f47',
        }}
      />

      {/* 木竿 */}
      <div
        className="absolute"
        style={{
          left: MONKEY_X - 5,
          top: GROUND_Y - POLE_HEIGHT,
          width: 10,
          height: POLE_HEIGHT,
          background: `linear-gradient(90deg, ${POLE_COLOR}, #b8894d 60%, ${POLE_COLOR})`,
          borderRadius: 4,
          border: '1px solid #8b6f47',
        }}
      />

      {/* 围观人群 */}
      {SPECTATORS.map((sp) => (
        <SpectatorFigure key={sp.name} {...sp} />
      ))}

      {/* 猴子（动作动画由 key=actionSeq 重新触发） */}
      <div
        className="absolute"
        style={{ left: MONKEY_X - 24, top: GROUND_Y - 52, width: 48, height: 48 }}
      >
        <div
          key={actionSeq}
          className={action ? `monkey-anim-${action.id}` : ''}
          style={{
            fontSize: 40,
            lineHeight: '48px',
            textAlign: 'center',
            animationDuration: action ? `${action.duration}ms` : undefined,
            filter: forcedRest ? 'grayscale(0.8)' : undefined,
          }}
        >
          🐒
        </div>
        {forcedRest && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white whitespace-nowrap">
            罢工中…
          </div>
        )}
      </div>

      {/* 满堂彩横幅 */}
      <AnimatePresence>
        {combo >= 3 && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-sm font-bold"
            style={{ background: '#c0392b', color: '#f5e6c8', border: '2px solid #ebb04b' }}
          >
            满堂彩！连击 x{combo}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 铜钱：抛物线飞行 + 落地闪烁 */}
      {coins.map((coin) => (
        <motion.div
          key={coin.id}
          className={`coin ${coin.phase === 'landed' ? 'coin-blink' : ''}`}
          initial={{ x: coin.startX - 6, y: coin.startY - 6 }}
          animate={{
            x: [coin.startX - 6, (coin.startX + coin.landX) / 2 - 6, coin.landX - 6],
            y: [coin.startY - 6, Math.min(coin.startY, coin.landY) - 80, coin.landY - 6],
          }}
          transition={{ duration: COIN_FLIGHT_MS / 1000, ease: 'easeIn' }}
        >
          <div className="coin-hole" />
        </motion.div>
      ))}

      {/* 欢呼气泡 */}
      <AnimatePresence>
        {cheers.map((cheer) => {
          const spec = SPECTATORS[cheer.spectator];
          return (
            <motion.div
              key={cheer.id}
              initial={{ opacity: 0, y: 8, scale: 0.8 }}
              animate={{ opacity: 1, y: -18, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap"
              style={{
                left: spec.x - 16,
                top: GROUND_Y - spec.height - 34,
                background: '#fff8e7',
                border: '2px solid #8b6f47',
                color: '#8b4513',
              }}
            >
              {cheer.text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
