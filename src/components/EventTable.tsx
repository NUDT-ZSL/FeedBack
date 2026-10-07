import { Fragment, useMemo, useState } from 'react';
import { explainEvent } from '../engine/resolve.ts';
import type { EventResult, SourceResult, SwitchRecord } from '../engine/types.ts';
import { DISPOSITION_STYLE } from './colors.ts';

interface Props {
  sources: Record<string, SourceResult>;
  switches: SwitchRecord[];
  selectedSource: string | 'all';
  timeRange: [number, number] | null;
  dispositionFilter: 'all' | 'kept' | 'dropped' | 'consumed';
}

const PAGE_SIZE = 200;

export default function EventTable(props: Props) {
  const { sources, switches, selectedSource, timeRange, dispositionFilter } = props;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const switchesById = useMemo(() => new Map(switches.map((sw) => [sw.id, sw])), [switches]);

  const filtered: EventResult[] = useMemo(() => {
    const all: EventResult[] = [];
    for (const [name, sourceResult] of Object.entries(sources)) {
      if (selectedSource !== 'all' && name !== selectedSource) continue;
      for (const eventResult of sourceResult.events) {
        if (dispositionFilter !== 'all' && eventResult.disposition !== dispositionFilter) continue;
        if (timeRange && (eventResult.tick < timeRange[0] || eventResult.tick > timeRange[1])) continue;
        all.push(eventResult);
      }
    }
    return all.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  }, [sources, selectedSource, timeRange, dispositionFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>共 {filtered.length} 条事件结论</span>
        <span className="flex items-center gap-2">
          <button
            className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >上一页</button>
          <span>{currentPage + 1} / {pageCount}</span>
          <button
            className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >下一页</button>
        </span>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-slate-700">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-800 text-slate-300">
            <tr>
              <th className="px-2 py-1.5 text-left">事件</th>
              <th className="px-2 py-1.5 text-left">来源</th>
              <th className="px-2 py-1.5 text-left">到达</th>
              <th className="px-2 py-1.5 text-left">最终结论</th>
              <th className="px-2 py-1.5 text-left">生效切换</th>
              <th className="px-2 py-1.5 text-left">决策数</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">无匹配事件</td></tr>
            )}
            {pageItems.map((eventResult) => {
              const style = DISPOSITION_STYLE[eventResult.disposition];
              const expanded = expandedId === eventResult.id;
              return (
                <Fragment key={eventResult.id}>
                  <tr
                    className={`cursor-pointer border-t border-slate-800 ${expanded ? 'bg-sky-500/10' : 'hover:bg-slate-800/50'}`}
                    onClick={() => setExpandedId(expanded ? null : eventResult.id)}
                  >
                    <td className="px-2 py-1.5 font-mono text-slate-300">{eventResult.id}</td>
                    <td className="px-2 py-1.5">{eventResult.source}</td>
                    <td className="px-2 py-1.5 font-mono">t={eventResult.tick}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded border px-1.5 py-0.5 ${style.className}`}>{style.label}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">{eventResult.effectiveSwitchId ?? '—'}</td>
                    <td className="px-2 py-1.5 text-slate-400">{eventResult.decisions.length}</td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-slate-800 bg-slate-900/70">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="space-y-1 text-slate-300">
                          <div className="text-slate-400">{explainEvent(eventResult, switchesById)}</div>
                          {eventResult.decisions.length > 0 && (
                            <ul className="list-inside list-disc text-slate-500">
                              {eventResult.decisions.map((decision, i) => (
                                <li key={i}>
                                  t={decision.tick} · {decision.action} · 档位 {decision.tierId} · 切换 {decision.switchId} ·{' '}
                                  {decision.origin === 'manual' ? '人工裁决' : '自动判定'}
                                  {decision.detail ? ` · ${decision.detail}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
