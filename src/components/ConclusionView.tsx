import type { ClearanceConclusion } from '@/domain/types';
import { formatGuan, formatRate, formatTime } from '@/domain/tariff';
import { Badge } from './ui';
import { GradeBadge } from './StatusBadge';

export function ConclusionView({
  conclusion,
  title,
  onLocateEntry,
}: {
  conclusion: ClearanceConclusion | null;
  title?: string;
  onLocateEntry?: (entryId: string) => void;
}) {
  if (!conclusion) {
    return <p className="text-sm text-stone-500">尚未验讫，暂无通关结论。</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {title && <span className="text-sm font-medium text-[#6b3a2a]">{title}</span>}
        <GradeBadge grade={conclusion.grade} />
        <span className="text-sm">
          应缴税银 <strong className="text-[#e67e22]">{formatGuan(conclusion.totalDuty)}</strong>
        </span>
        <Badge tone="brown">口径 v{conclusion.scheduleVersion}</Badge>
        <span className="text-xs text-stone-500">{formatTime(conclusion.computedAt)}</span>
      </div>
      <p className="text-xs text-stone-600">{conclusion.reason}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#8b4513]/30 text-left text-xs text-[#6b3a2a]">
            <th className="py-1 pr-2">货物</th>
            <th className="py-1 pr-2">类别</th>
            <th className="py-1 pr-2">来源</th>
            <th className="py-1 pr-2 text-right">数量</th>
            <th className="py-1 pr-2 text-right">估值(贯)</th>
            <th className="py-1 pr-2 text-right">税率</th>
            <th className="py-1 text-right">税额(贯)</th>
          </tr>
        </thead>
        <tbody>
          {conclusion.lines.map((l) => (
            <tr
              key={l.entryId}
              className={
                'border-b border-[#8b4513]/10 ' +
                (onLocateEntry ? 'cursor-pointer hover:bg-[#ffd70022]' : '')
              }
              onClick={onLocateEntry ? () => onLocateEntry(l.entryId) : undefined}
              title={onLocateEntry ? '点击定位货单条目' : undefined}
            >
              <td className="py-1 pr-2">{l.name}</td>
              <td className="py-1 pr-2">{l.category}</td>
              <td className="py-1 pr-2">
                <Badge tone={l.source === 'inspection' ? 'indigo' : 'brown'}>
                  {l.source === 'inspection' ? '抽检' : '货单'}
                </Badge>
              </td>
              <td className="py-1 pr-2 text-right">{l.quantity}</td>
              <td className="py-1 pr-2 text-right">{l.unitValue}</td>
              <td className="py-1 pr-2 text-right">{formatRate(l.rate)}</td>
              <td className="py-1 text-right text-[#e67e22]">{l.duty}</td>
            </tr>
          ))}
          {conclusion.lines.length === 0 && (
            <tr>
              <td colSpan={7} className="py-2 text-center text-stone-400">
                无有效货单条目
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
