import { useMemo, useState } from 'react';
import type { SwitchRecord, TierConfig } from '../engine/types.ts';
import { tierColor } from './colors.ts';

interface Props {
  switches: SwitchRecord[];
  tiers: TierConfig[];
  selectedSource: string | 'all';
  timeRange: [number, number] | null;
  selectedSwitchId: string | null;
  onSelectSwitch: (id: string | null) => void;
  onAdjudicate: (source: string, tick: number, chosenTierId: string, reason: string) => void;
}

export default function SwitchLog(props: Props) {
  const { switches, tiers, selectedSource, timeRange, selectedSwitchId } = props;
  const [draftTier, setDraftTier] = useState('');
  const [draftReason, setDraftReason] = useState('');
  const tierIds = tiers.map((t) => t.id);

  const visible = useMemo(
    () =>
      switches.filter(
        (sw) =>
          (selectedSource === 'all' || sw.source === selectedSource) &&
          (!timeRange || (sw.tick >= timeRange[0] && sw.tick <= timeRange[1])),
      ),
    [switches, selectedSource, timeRange],
  );

  const selected = switches.find((sw) => sw.id === selectedSwitchId) ?? null;

  return (
    <div className="space-y-2">
      <div className="max-h-64 overflow-auto rounded-lg border border-slate-700">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-800 text-slate-300">
            <tr>
              <th className="px-2 py-1.5 text-left">切换</th>
              <th className="px-2 py-1.5 text-left">时刻</th>
              <th className="px-2 py-1.5 text-left">档位</th>
              <th className="px-2 py-1.5 text-left">触发依据</th>
              <th className="px-2 py-1.5 text-left">受影响区间</th>
              <th className="px-2 py-1.5 text-left">标记</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">当前筛选范围内无档位切换</td></tr>
            )}
            {visible.map((sw) => {
              const isSelected = sw.id === selectedSwitchId;
              return (
                <tr
                  key={sw.id}
                  className={`cursor-pointer border-t border-slate-800 ${isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/50'}`}
                  onClick={() => props.onSelectSwitch(isSelected ? null : sw.id)}
                >
                  <td className="px-2 py-1.5 font-mono text-slate-300">{sw.id}</td>
                  <td className="px-2 py-1.5 font-mono">t={sw.tick}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span style={{ color: tierColor(tierIds, sw.fromTier) }}>{sw.fromTier}</span>
                    <span className="mx-1 text-slate-500">→</span>
                    <span style={{ color: tierColor(tierIds, sw.toTier) }}>{sw.toTier}</span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">
                    积压 {sw.basis.backlog} &gt; 阈值 {sw.basis.upThreshold}
                    {sw.basis.candidates.length > 1 && (
                      <span className="text-slate-500">（候选 {sw.basis.candidates.join('/')}）</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">
                    [{sw.affectedFrom}, {sw.affectedTo}] · {sw.affectedEventCount} 事件
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {sw.conflict && (
                      <span className="mr-1 rounded border border-rose-500/50 bg-rose-500/15 px-1 py-0.5 text-rose-300">冲突</span>
                    )}
                    {sw.adjudication && (
                      <span className="rounded border border-yellow-400/50 bg-yellow-400/15 px-1 py-0.5 text-yellow-200">
                        已裁决→{sw.adjudication.chosenTierId}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-slate-200">
              切换 {selected.id} · 来源 {selected.source} · t={selected.tick}
            </div>
            <button className="text-slate-500 hover:text-slate-300" onClick={() => props.onSelectSwitch(null)}>关闭</button>
          </div>
          <div className="text-slate-400">
            {selected.fromTier} → {selected.toTier}；触发时积压 {selected.basis.backlog}，目标档阈值 {selected.basis.upThreshold}（滞回 {selected.basis.downThreshold}）；
            候选：{selected.basis.candidates.join('、')}；受影响区间 [{selected.affectedFrom}, {selected.affectedTo}]，共 {selected.affectedEventCount} 条事件。
          </div>
          {selected.conflict && !selected.adjudication && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 space-y-2">
              <div className="text-rose-200">
                冲突判定：候选 {selected.conflictCandidates?.join(' / ')} 阈值相同，当前默认择一（{selected.toTier}）。可人工裁决改选：
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200"
                  value={draftTier}
                  onChange={(e) => setDraftTier(e.target.value)}
                >
                  <option value="">选择档位…</option>
                  {selected.conflictCandidates?.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <input
                  className="min-w-40 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200"
                  placeholder="裁决理由（可追溯）"
                  value={draftReason}
                  onChange={(e) => setDraftReason(e.target.value)}
                />
                <button
                  className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-500 disabled:opacity-40"
                  disabled={!draftTier}
                  onClick={() => {
                    props.onAdjudicate(selected.source, selected.tick, draftTier, draftReason || '人工裁决');
                    setDraftTier('');
                    setDraftReason('');
                  }}
                >
                  裁决并增量重推
                </button>
              </div>
            </div>
          )}
          {selected.adjudication && (
            <div className="rounded border border-yellow-400/40 bg-yellow-400/10 p-2 text-yellow-100">
              人工裁决：改选 {selected.adjudication.chosenTierId}；理由：{selected.adjudication.reason ?? '（未填写）'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
