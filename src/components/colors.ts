const PALETTE = ['#38bdf8', '#fbbf24', '#fb7185', '#a78bfa', '#34d399', '#f472b6', '#f97316', '#22d3ee'];

export function tierColor(tierIds: string[], tierId: string): string {
  const index = tierIds.indexOf(tierId);
  return PALETTE[(index >= 0 ? index : 0) % PALETTE.length];
}

export const DISPOSITION_STYLE: Record<string, { label: string; className: string }> = {
  kept: { label: '保留', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  dropped: { label: '丢弃', className: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  consumed: { label: '已消费', className: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
};
