import type { ClearanceDecision } from '@/domain/types';
import type { RulingFilter } from '@/store/useStore';

const DECISION_META: Record<ClearanceDecision, { label: string; cls: string }> = {
  pass: { label: '验讫放行', cls: 'bg-[#1a5276] text-white' },
  hold: { label: '暂缓放行', cls: 'bg-[#b9770e] text-white' },
  review: { label: '需复核', cls: 'bg-[#922b21] text-white' },
};

export function DecisionBadge({ decision }: { decision: ClearanceDecision }) {
  const meta = DECISION_META[decision];
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

const RULING_META: Record<Exclude<RulingFilter, 'all'>, { label: string; cls: string }> = {
  none: { label: '无抽检', cls: 'bg-[#d5c9a1] text-[#6b3a2a]' },
  pending: { label: '待裁定', cls: 'bg-[#b9770e] text-white' },
  adjudicated: { label: '已裁定', cls: 'bg-[#1a5276] text-white' },
  stale: { label: '货单已变更', cls: 'bg-[#922b21] text-white' },
};

export function RulingStatusBadge({ status }: { status: Exclude<RulingFilter, 'all'> }) {
  const meta = RULING_META[status];
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
