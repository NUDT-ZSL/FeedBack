import type { DeriveResult } from '@/scheduler/index.ts';

interface Props {
  result: DeriveResult;
  taskId: string | null;
}

export function TracePanel({ result, taskId }: Props) {
  const task = taskId ? result.tasks[taskId] : undefined;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">排位依据追溯</h2>
      {!task && <p className="text-sm text-slate-400">点击构建顺序中的任务，查看它为什么排在当前位置。</p>}
      {task && (
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-slate-800">{task.id}（第 {task.rationale?.position ?? '-'} 位）</p>
            <p className="text-xs text-slate-500">耗时 {task.duration}，来源：{task.durationSource}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">最早开始时刻依据</p>
            <ul className="list-inside list-disc space-y-1 text-xs text-slate-600">
              {task.startRationale.map((reason, index) => <li key={index}>{reason}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">为什么排在这个位置</p>
            <ul className="list-inside list-disc space-y-1 text-xs text-slate-600">
              {task.rationale?.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">关键路径判定</p>
            {task.critical ? (
              <p className="text-xs text-slate-600">
                松弛度 = LS({task.latestStart}) − ES({task.earliestStart}) = {task.slack}，位于关键路径上；
                {result.criticalPaths.filter((path) => path.includes(task.id)).length > 0
                  ? `出现在关键路径 ${result.criticalPaths.filter((path) => path.includes(task.id)).map((path) => path.join(' → ')).join('；')}`
                  : '决定项目总时长。'}
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                松弛度 = LS({task.latestStart}) − ES({task.earliestStart}) = {task.slack}，可延后而不延长项目总时长，故不在关键路径上。
              </p>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">来源依赖边</p>
            <ul className="space-y-0.5 text-xs text-slate-600">
              {result.edges.filter((edge) => edge.from === task.id).map((edge) => (
                <li key={edge.to}>{edge.from} → {edge.to}{edge.optional ? '（可选）' : ''} — {edge.claims.map((claim) => claim.source).join('、')}</li>
              ))}
              {result.edges.filter((edge) => edge.from === task.id).length === 0 && <li>无前置依赖</li>}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
