// 彩戏道具面板（扩展能力）：复用 store 的同一游戏时钟与状态约定
import { memo } from 'react';
import { motion } from 'framer-motion';
import { PROPS } from '@/utils/gameLogic';
import { useGameStore } from '@/store';

const PropPanel = memo(function PropPanel() {
  const phase = useGameStore((s) => s.phase);
  const props = useGameStore((s) => s.props);
  const gameTime = useGameStore((s) => s.gameTime);
  const isStunned = useGameStore((s) => s.monkey.isStunned);
  const currentAction = useGameStore((s) => s.monkey.currentAction);
  const ribbonActive = useGameStore((s) => s.ribbonActive);
  const applyProp = useGameStore((s) => s.useProp);

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border-2 border-dashed p-3" style={{ borderColor: '#3a6b8d', backgroundColor: '#eef4f7' }}>
      <h2 className="text-center text-base font-bold text-[#3a6b8d]">彩戏道具</h2>
      {PROPS.map((def) => {
        const slot = props.find((p) => p.id === def.id);
        const stock = slot?.stock ?? 0;
        const cooldownLeft = Math.max(0, (slot?.cooldownUntil ?? 0) - gameTime);
        const isRibbonActive = def.id === 'ribbon' && ribbonActive;
        const blockedByStun = isStunned && def.id !== 'banana';
        const ribbonDuringAct = def.id === 'ribbon' && currentAction !== null;
        const disabled = phase !== 'playing' || stock <= 0 || cooldownLeft > 0 || isRibbonActive || blockedByStun || ribbonDuringAct;

        return (
          <motion.button
            key={def.id}
            type="button"
            whileTap={disabled ? undefined : { scale: 0.95 }}
            onClick={() => applyProp(def.id)}
            disabled={disabled}
            className="btn-action flex h-[50px] items-center justify-between rounded-lg border border-[#3a6b8d]/40 bg-white/80 px-3 text-left text-sm font-semibold text-[#2c4f68] shadow-sm"
            title={def.description}
          >
            <span className="flex items-center gap-2">
              <span className="text-lg">{def.icon}</span>
              <span>
                {def.name}
                <span className="ml-1 rounded bg-[#3a6b8d] px-1 text-[10px] text-white">×{stock}</span>
              </span>
            </span>
            <span className="max-w-[45%] text-right text-[10px] font-normal leading-tight">
              {isRibbonActive ? (
                <span className="text-pink-600">加护生效中</span>
              ) : cooldownLeft > 0 ? (
                <span>{Math.ceil(cooldownLeft)}s</span>
              ) : blockedByStun ? (
                <span className="text-red-600">罢工中不可用</span>
              ) : (
                def.description
              )}
            </span>
          </motion.button>
        );
      })}
      <p className="text-center text-[10px] text-[#3a6b8d]/70">道具贯穿整场演出，重置即恢复配额</p>
    </div>
  );
});

export default PropPanel;
