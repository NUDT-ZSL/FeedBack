// 动作选择面板：竖排绫绸质感按钮，显示耗时/成功率/疲劳，
// 冷却中显示倒计时，按钮颜色随疲劳度从绿到红；招牌技需充能满后可放。

import { useGameStore } from '@/store';
import { ACTION_ORDER, ACTIONS, FATIGUE_WARNING, SIGNATURE_COST } from '@/config';
import type { ActionId } from '@/types';

function ActionButton({ id }: { id: ActionId }) {
  const action = ACTIONS[id];
  const elapsed = useGameStore((s) => s.elapsed);
  const status = useGameStore((s) => s.status);
  const performing = useGameStore((s) => s.monkey.currentAction) !== null;
  const fatigue = useGameStore((s) => s.monkey.fatigue);
  const energy = useGameStore((s) => s.monkey.energy);
  const restUntil = useGameStore((s) => s.monkey.forcedRestUntil);
  const cooldownUntil = useGameStore((s) => s.cooldowns[id]) ?? 0;
  const selectAction = useGameStore((s) => s.selectAction);

  const resting = restUntil !== null && elapsed < restUntil;
  const cooldownLeft = Math.max(0, cooldownUntil - elapsed);
  const isSignature = id === 'signature';
  const energyReady = !isSignature || energy >= SIGNATURE_COST;

  const disabled =
    status !== 'running' || performing || resting || cooldownLeft > 0 || !energyReady;

  const effectiveRate =
    !action.alwaysSucceeds && fatigue >= FATIGUE_WARNING
      ? action.successRate / 2
      : action.successRate;

  // 颜色随疲劳从绿（120）到红（0）
  const hue = Math.round(120 - (fatigue / 100) * 120);
  const base = isSignature ? '#d4a017' : `hsl(${hue}, 55%, 42%)`;
  const light = isSignature ? '#ebb04b' : `hsl(${hue}, 65%, 55%)`;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => selectAction(id)}
      title={action.desc}
      className="relative flex h-[50px] w-full items-center justify-between overflow-hidden rounded-lg px-3 text-sm font-semibold text-white shadow transition-transform duration-200 enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        background: `linear-gradient(135deg, ${light}, ${base})`,
        border: '2px solid #8b6f47',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
      }}
    >
      <div className="flex flex-col items-start leading-tight">
        <span>{action.name}</span>
        <span className="text-[10px] font-normal opacity-90">{action.desc}</span>
      </div>
      <div className="flex flex-col items-end text-[10px] leading-tight">
        <span>{(action.duration / 1000).toFixed(1)}s</span>
        <span>{Math.round(effectiveRate * 100)}%</span>
      </div>

      {isSignature && !energyReady && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
          <div
            className="h-full bg-yellow-200"
            style={{ width: `${(energy / SIGNATURE_COST) * 100}%` }}
          />
        </div>
      )}

      {cooldownLeft > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs">
          冷却 {(cooldownLeft / 1000).toFixed(1)}s
        </div>
      )}
    </button>
  );
}

export default function ActionPanel() {
  return (
    <div
      className="flex w-[200px] flex-col gap-2 rounded-xl border-4 p-3"
      style={{ background: '#f0dfb8', borderColor: '#8b6f47' }}
    >
      <h2 className="text-center text-sm font-bold text-[#5d4a2f]">动作面板</h2>
      {ACTION_ORDER.map((id) => (
        <ActionButton key={id} id={id} />
      ))}
    </div>
  );
}
