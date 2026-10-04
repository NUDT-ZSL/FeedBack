import type { Decision, Issue } from '@/scheduler/index.ts';

interface Props {
  issues: Issue[];
  onDecision: (decision: Decision) => void;
}

export function IssuesPanel({ issues, onDecision }: Props) {
  const open = issues.filter((issue) => issue.status === 'open');
  const resolved = issues.filter((issue) => issue.status === 'resolved');
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">
        待裁决问题 <span className="text-slate-400">（{open.length} 待处理 / {resolved.length} 已解决）</span>
      </h2>
      {issues.length === 0 && <p className="text-sm text-slate-400">没有检测到冲突或缺失。</p>}
      <ul className="space-y-3">
        {issues.map((issue) => (
          <li key={issue.id} className={`rounded-md border p-3 text-sm ${issue.status === 'open' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
            {issue.kind === 'missing-target' && (
              <div>
                <p className="font-medium text-slate-800">
                  依赖指向缺失：<code>{issue.from}</code> → <code>{issue.to}</code>
                  {issue.optional && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700">可选依赖</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  声明来源：{issue.claims.map((claim) => `${claim.source}${claim.note ? `（${claim.note}）` : ''}`).join('、')}
                </p>
                {issue.status === 'open' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800" onClick={() => onDecision({ type: 'drop-edge', from: issue.from, to: issue.to })}>放弃该依赖</button>
                    <button className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800" onClick={() => onDecision({ type: 'declare-external', taskId: issue.to })}>登记为外部任务（耗时 0）</button>
                    <button className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800" onClick={() => onDecision({ type: 'declare-external', taskId: issue.to, duration: 2 })}>登记为外部任务（耗时 2）</button>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-emerald-700">已解决：{issue.resolution}</p>
                )}
              </div>
            )}
            {issue.kind === 'cycle' && (
              <div>
                <p className="font-medium text-slate-800">依赖成环：{issue.displayCycle.join(' → ')}</p>
                {issue.status === 'open' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {issue.displayCycle.slice(0, -1).map((from, index) => {
                      const to = issue.displayCycle[index + 1];
                      return (
                        <button key={`${from}->${to}`} className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800" onClick={() => onDecision({ type: 'drop-edge', from, to })}>
                          断开 {from} → {to}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-emerald-700">已解决：{issue.resolution}</p>
                )}
              </div>
            )}
            {issue.kind === 'duration-conflict' && (
              <div>
                <p className="font-medium text-slate-800">耗时冲突：<code>{issue.taskId}</code></p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {issue.claims.map((claim) => (
                    <li key={claim.source}>
                      {claim.source}：{claim.duration}{claim.note ? `（${claim.note}）` : ''}
                    </li>
                  ))}
                </ul>
                {issue.status === 'open' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {issue.claims.map((claim) => (
                      <button key={claim.source} className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800" onClick={() => onDecision({ type: 'select-duration', taskId: issue.taskId, source: claim.source })}>
                        采纳 {claim.source}（{claim.duration}）
                      </button>
                    ))}
                    <button
                      className="rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-800"
                      onClick={() => {
                        const value = window.prompt(`为 ${issue.taskId} 人工指定耗时`, '4');
                        const duration = Number(value);
                        if (value !== null && Number.isFinite(duration) && duration >= 0) {
                          onDecision({ type: 'override-duration', taskId: issue.taskId, duration });
                        }
                      }}
                    >
                      人工指定…
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-emerald-700">已解决：{issue.resolution}</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
