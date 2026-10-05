import { useState } from 'react';
import type { ConflictGroup } from '@/engine/types';

interface Props {
  groups: ConflictGroup[];
  onAdjudicate: (groupId: string, eventId: string) => void;
}

/** 重复/冲突事件面板：双方保留展示，裁决后记录选定事件 */
export default function ConflictPanel({ groups, onAdjudicate }: Props) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const pending = groups.filter((g) => g.status === 'pending');
  const resolved = groups.filter((g) => g.status === 'resolved');

  if (groups.length === 0) {
    return <p className="text-sm text-slate-500">暂无重复或冲突事件</p>;
  }

  return (
    <div className="space-y-2">
      {pending.map((g) => (
        <div key={g.id} className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              {g.kind === 'conflict' ? '内容冲突' : '内容重复'} · 待裁决
            </span>
            <span className="text-slate-700">
              {g.source} @ t={g.time}s
            </span>
            <button
              className="ml-auto rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-700 disabled:opacity-40"
              disabled={!choice[g.id]}
              onClick={() => onAdjudicate(g.id, choice[g.id])}
            >
              裁决并只重推该区间起
            </button>
          </div>
          <ul className="mt-1 space-y-1">
            {g.events.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="radio"
                  name={g.id}
                  checked={(choice[g.id] ?? g.resolvedEventId) === e.id}
                  onChange={() => setChoice((c) => ({ ...c, [g.id]: e.id }))}
                />
                <span className="font-mono">{e.id}</span>
                <span>size={e.size}</span>
                <span className="text-slate-400">{e.payload}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {resolved.map((g) => (
        <div key={g.id} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-500">
          已裁决：{g.source} @ t={g.time}s（{g.kind === 'conflict' ? '冲突' : '重复'}）→ 选定{' '}
          <span className="font-mono">{g.resolvedEventId}</span>
        </div>
      ))}
    </div>
  );
}
