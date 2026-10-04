import type { Explanation } from '@/engine';

export function ExplainPanel({ explanation }: { explanation: Explanation | null }) {
  if (!explanation) {
    return <div className="text-sm text-gray-400">点击左侧任务，查看它为何排在当前位置</div>;
  }
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-base font-semibold">{explanation.taskId}</span>
        {explanation.scheduled ? (
          <span className="text-xs text-gray-500">
            第 {explanation.orderIndex! + 1} 位 · {explanation.est === null ? '时刻待定' : `${explanation.est} → ${explanation.finish}`}
          </span>
        ) : (
          <span className="text-xs text-red-500">未调度</span>
        )}
        {explanation.onCriticalPath && (
          <span className="rounded bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">关键路径</span>
        )}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
        {explanation.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}
