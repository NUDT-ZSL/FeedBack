import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useBackpressureStore } from '@/state/store';

export default function DecisionList() {
  const { derivation, eventSet } = useBackpressureStore();
  const pending = eventSet.conflicts.filter((group) => group.status === 'pending');

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">
        处置结论与判定依据
        <span className="ml-2 text-xs font-normal text-slate-500">{derivation.decisions.length} 条</span>
      </h2>
      {pending.length > 0 && (
        <p className="mb-3 rounded border border-amber-600/50 bg-amber-500/5 p-2 text-xs text-amber-300">
          存在 {pending.length} 组待裁决事件，对应区间已排除背压结论；裁决后仅重推受影响区间并更新依据版本。
        </p>
      )}
      {derivation.decisions.length === 0 ? (
        <p className="text-xs text-slate-500">当前参数下没有触发背压。</p>
      ) : (
        <ol className="max-h-80 space-y-2 overflow-auto pr-1">
          {derivation.decisions.map((decision) => (
            <li
              key={`${decision.type}-${decision.seq}`}
              className={`rounded border p-3 ${
                decision.type === 'trigger'
                  ? 'border-red-800/60 bg-red-500/5'
                  : 'border-emerald-800/60 bg-emerald-500/5'
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                {decision.type === 'trigger' ? (
                  <ShieldAlert size={15} className="text-red-400" />
                ) : (
                  <ShieldCheck size={15} className="text-emerald-400" />
                )}
                <span className={decision.type === 'trigger' ? 'text-red-300' : 'text-emerald-300'}>
                  #{decision.seq} {decision.action}
                </span>
                <span className="ml-auto font-mono text-xs text-slate-500">
                  区间 #{decision.tick} · t={decision.time}ms
                </span>
              </div>
              <p className="text-xs leading-5 text-slate-400">{decision.explanation}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-600">
                依据版本 basis: events v{decision.basis.eventsVersion} / params v{decision.basis.paramsVersion}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
