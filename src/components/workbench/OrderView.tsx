import type { DerivationResult } from '@/engine';

interface Props {
  result: DerivationResult;
  affected: string[] | null;
  selected: string | null;
  onSelect: (id: string) => void;
}

export function OrderView({ result, affected, selected, onSelect }: Props) {
  const unscheduled = Object.values(result.tasks).filter((t) => t.unscheduledReason !== null);
  return (
    <div>
      <ol className="space-y-1">
        {result.order.map((id, index) => {
          const task = result.tasks[id];
          const isAffected = affected?.includes(id);
          return (
            <li key={id}>
              <button
                className={`flex w-full items-center gap-2 rounded border px-3 py-1.5 text-left text-sm transition-colors ${
                  selected === id
                    ? 'border-blue-500 bg-blue-50'
                    : task.onCriticalPath
                      ? 'border-orange-300 bg-orange-50 hover:bg-orange-100'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
                onClick={() => onSelect(id)}
              >
                <span className="w-6 text-gray-400">{index + 1}.</span>
                <span className="font-mono font-medium">{id}</span>
                <span className="text-xs text-gray-500">
                  {task.est === null ? '时刻待定' : `${task.est} → ${task.finish}`}
                </span>
                <span className="text-xs text-gray-400">耗时 {task.duration ?? '?'}</span>
                {task.onCriticalPath && (
                  <span className="rounded bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">关键路径</span>
                )}
                {isAffected && (
                  <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] text-white">本次重推</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {unscheduled.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500">无法调度</div>
          <ul className="mt-1 space-y-1">
            {unscheduled.map((task) => (
              <li key={task.id}>
                <button
                  className={`w-full rounded border border-dashed px-3 py-1.5 text-left text-sm ${
                    selected === task.id ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'
                  }`}
                  onClick={() => onSelect(task.id)}
                >
                  <span className="font-mono">{task.id}</span>
                  <span className="ml-2 text-xs text-gray-500">{task.unscheduledReason}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
