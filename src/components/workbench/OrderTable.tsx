import type { DeriveResult, IncrementalResult } from '@/scheduler/index.ts';

interface Props {
  result: DeriveResult;
  incremental: IncrementalResult | null;
  selected: string | null;
  onSelect: (id: string) => void;
}

export function OrderTable({ result, incremental, selected, onSelect }: Props) {
  const affected = new Set(incremental?.affected ?? []);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">构建顺序 / 最早时刻 / 关键路径</h2>
        <span className="text-xs text-slate-400">项目总时长 {result.projectDuration}</span>
      </div>

      <div className="mb-3 rounded-md bg-slate-800 px-3 py-2 text-xs leading-6 text-slate-100">
        <span className="text-slate-400">关键路径：</span>
        {result.criticalPaths.length
          ? result.criticalPaths.map((path) => path.join(' → ')).join('　｜　')
          : '存在阻塞，暂无法形成关键路径'}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2 font-normal">#</th>
            <th className="py-1 pr-2 font-normal">任务</th>
            <th className="py-1 pr-2 font-normal">耗时</th>
            <th className="py-1 pr-2 font-normal">最早开始</th>
            <th className="py-1 pr-2 font-normal">最早完成</th>
            <th className="py-1 pr-2 font-normal">最晚开始</th>
            <th className="py-1 pr-2 font-normal">松弛</th>
            <th className="py-1 font-normal">关键</th>
          </tr>
        </thead>
        <tbody>
          {result.order.map((id, index) => {
            const task = result.tasks[id];
            const isAffected = affected.has(id);
            return (
              <tr
                key={id}
                className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selected === id ? 'bg-sky-50' : ''} ${task.critical ? 'font-medium' : ''}`}
                onClick={() => onSelect(id)}
              >
                <td className="py-1.5 pr-2 text-slate-400">{index + 1}</td>
                <td className="py-1.5 pr-2">
                  {id}
                  {isAffected && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">本次重推</span>}
                </td>
                <td className="py-1.5 pr-2">{task.duration}</td>
                <td className="py-1.5 pr-2">{task.earliestStart}</td>
                <td className="py-1.5 pr-2">{task.earliestFinish}</td>
                <td className="py-1.5 pr-2 text-slate-500">{task.latestStart}</td>
                <td className="py-1.5 pr-2 text-slate-500">{task.slack}</td>
                <td className="py-1.5">{task.critical ? '★' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {result.blocked.length > 0 && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="font-semibold">阻塞任务（不参与本次排序）</p>
          <ul className="mt-1 list-inside list-disc">
            {result.blocked.map((task) => (
              <li key={task.id}><code>{task.id}</code>：{task.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {(result.skippedEdges.length > 0 || result.ignoredDecisions.length > 0 || result.warnings.length > 0) && (
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          {result.skippedEdges.map((edge) => (
            <p key={`${edge.from}-${edge.to}`}>已跳过可选依赖 {edge.from} → {edge.to}：{edge.reason}</p>
          ))}
          {result.ignoredDecisions.map((entry, index) => (
            <p key={index} className="text-rose-600">未生效裁决：{entry.reason}</p>
          ))}
          {result.warnings.map((warning, index) => (
            <p key={index} className="text-amber-600">{warning}</p>
          ))}
        </div>
      )}
    </section>
  );
}
