import { useBackpressureStore } from '@/state/store';
import { conflictByEvent, eventStatus } from '@/engine';
import type { AdjudicationAction, ConflictGroup } from '@/engine';

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  normal: { text: '正常', className: 'text-slate-400' },
  pending: { text: '待裁决', className: 'text-amber-300' },
  dropped: { text: '已排除', className: 'text-slate-600 line-through' },
};

function AdjudicateButtons({ group }: { group: ConflictGroup }) {
  const { adjudicateConflict } = useBackpressureStore();
  if (group.status === 'resolved') {
    const map: Record<string, string> = {
      keep: `保留 ${group.resolution?.type === 'keep' ? group.resolution.eventId : ''}`,
      keepAll: '双方保留',
      dropAll: '全部丢弃',
    };
    return <span className="text-xs text-slate-500">已裁决：{map[group.resolution?.type ?? 'keep'] ?? '-'}</span>;
  }
  const apply = (action: AdjudicationAction) => adjudicateConflict(group.key, action);
  return (
    <div className="flex flex-wrap gap-1">
      {group.eventIds.map((id) => (
        <button
          key={id}
          onClick={() => apply({ type: 'keep', eventId: id })}
          className="rounded border border-cyan-700 px-2 py-0.5 text-xs text-cyan-300 hover:bg-cyan-700/15"
        >
          保留 {id}
        </button>
      ))}
      <button
        onClick={() => apply({ type: 'keepAll' })}
        className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-700/15"
      >
        双方保留
      </button>
      <button
        onClick={() => apply({ type: 'dropAll' })}
        className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-700/30"
      >
        全部丢弃
      </button>
    </div>
  );
}

export default function EventTable() {
  const { eventSet } = useBackpressureStore();

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        事件集合
        <span className="ml-2 text-xs font-normal text-slate-500">
          {eventSet.events.length} 条 · {eventSet.conflicts.length} 组重复/冲突
        </span>
      </h2>

      {eventSet.conflicts.length > 0 && (
        <div className="mb-4 space-y-2">
          {eventSet.conflicts.map((group) => (
            <div
              key={group.key}
              className={`rounded border p-3 ${
                group.status === 'pending' ? 'border-amber-600/60 bg-amber-500/5' : 'border-slate-700'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    group.kind === 'duplicate' ? 'bg-amber-500/15 text-amber-300' : 'bg-orange-500/15 text-orange-300'
                  }`}
                >
                  {group.kind === 'duplicate' ? '重复' : '内容冲突'}
                </span>
                <span className="text-slate-400">
                  {group.source} @ t={group.timestamp}ms：双方保留、不静默择一
                </span>
                {group.status === 'pending' && (
                  <span className="text-amber-300">待裁决（该区间暂不参与背压结论）</span>
                )}
              </div>
              <AdjudicateButtons group={group} />
            </div>
          ))}
        </div>
      )}

      <div className="max-h-72 overflow-auto rounded border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-800 text-slate-400">
            <tr>
              <th className="px-2 py-1.5">id</th>
              <th className="px-2 py-1.5">来源</th>
              <th className="px-2 py-1.5 text-right">时刻ms</th>
              <th className="px-2 py-1.5 text-right">量</th>
              <th className="px-2 py-1.5">内容</th>
              <th className="px-2 py-1.5">状态</th>
            </tr>
          </thead>
          <tbody>
            {eventSet.events.map((event) => {
              const status = eventStatus(eventSet, event.id);
              const group = conflictByEvent(eventSet, event.id);
              const label = STATUS_LABEL[status] ?? STATUS_LABEL.normal;
              return (
                <tr key={event.id} className={group ? 'bg-amber-500/5' : ''}>
                  <td className="px-2 py-1 font-mono text-slate-300">{event.id}</td>
                  <td className="px-2 py-1 text-slate-300">{event.source}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{event.timestamp}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{event.size}</td>
                  <td className="px-2 py-1 text-slate-500">{event.payload ?? '-'}</td>
                  <td className={`px-2 py-1 ${label.className}`}>{label.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
