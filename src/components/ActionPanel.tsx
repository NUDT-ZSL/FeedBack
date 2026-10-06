// 动作面板（调用 store.selectAction）
import { memo } from 'react';
import { motion } from 'framer-motion';
import { ACTIONS } from '@/utils/gameLogic';
import { actionProgress, useGameStore } from '@/store';

const ActionPanel = memo(function ActionPanel() {
  const phase = useGameStore((s) => s.phase);
  const fatigue = useGameStore((s) => s.monkey.fatigue);
  const isStunned = useGameStore((s) => s.monkey.isStunned);
  const currentAction = useGameStore((s) => s.monkey.currentAction);
  const cooldowns = useGameStore((s) => s.actionCooldowns);
  const gameTime = useGameStore((s) => s.gameTime);
  const selectAction = useGameStore((s) => s.selectAction);
  const ribbonActive = useGameStore((s) => s.ribbonActive);
  const progress = actionProgress(useGameStore());

  const playing = phase === 'playing';
  const busy = currentAction !== null || isStunned;

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border-2 p-3" style={{ borderColor: 'var(--wood)', backgroundColor: '#fdf6e6' }}>
      <h2 className="text-center text-base font-bold" style={{ color: 'var(--wood)' }}>
        表演动作
      </h2>
      {ACTIONS.map((action) => {
        const cooldownLeft = Math.max(0, (cooldowns[action.id] ?? 0) - gameTime);
        const isCurrent = currentAction?.id === action.id;
        const disabled = !playing || busy || cooldownLeft > 0;
        const danger = fatigue >= 80 && !action.isRest;
        const rate = danger ? action.successRate * 0.5 : action.successRate;
        const displayRate = Math.round(Math.min(rate + (ribbonActive ? 0.2 : 0), 1) * 100);
        const currentLeft = isCurrent ? Math.ceil(progress.remaining) : 0;

        return (
          <motion.button
            key={action.id}
            type="button"
            whileTap={disabled ? undefined : { scale: 0.95 }}
            onClick={() => selectAction(action.id)}
            disabled={disabled}
            className="btn-action flex h-[50px] items-center justify-between rounded-lg px-3 text-left text-sm font-semibold text-white shadow"
            style={{
              background: action.isRest
                ? 'linear-gradient(135deg, #6b8e6b, #4a7a4a)'
                : danger
                  ? 'linear-gradient(135deg, #c0392b, #8e291d)'
                  : 'linear-gradient(135deg, #8b6f47, #6b5437)',
              outline: isCurrent ? '3px solid #ebb04b' : undefined,
            }}
          >
            <span className="flex items-center gap-2">
              <span className="text-lg">{action.icon}</span>
              <span>{action.name}</span>
            </span>
            <span className="text-xs font-normal opacity-90">
              {isCurrent ? (
                <span className="text-amber-200">表演中 {currentLeft}s</span>
              ) : cooldownLeft > 0 ? (
                <span>冷却 {Math.ceil(cooldownLeft)}s</span>
              ) : (
                <span>
                  {action.duration}s · {displayRate}%
                  {action.isRest ? '' : ` · 疲+${action.fatigueCost}`}
                </span>
              )}
            </span>
          </motion.button>
        );
      })}
      {fatigue >= 80 && (
        <p className="text-center text-xs text-red-700">疲劳过高，成功率减半！</p>
      )}
    </div>
  );
});

export default ActionPanel;
