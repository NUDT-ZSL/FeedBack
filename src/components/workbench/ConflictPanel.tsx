import { useState } from 'react';
import type { Conflict, Resolution } from '@/engine';

interface Props {
  conflicts: Conflict[];
  taskIds: string[];
  onResolve: (res: Resolution) => void;
}

function MissingDepRow({
  conflict,
  taskIds,
  onResolve,
}: {
  conflict: Extract<Conflict, { type: 'missing-dependency' }>;
  taskIds: string[];
  onResolve: (res: Resolution) => void;
}) {
  const [target, setTarget] = useState(taskIds[0] ?? '');
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="font-medium text-amber-900">
        依赖缺失：{conflict.taskId} → {conflict.dep}（目标不存在）
      </div>
      <div className="mt-1 text-xs text-amber-700">来源：{conflict.sources.join('、')}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700"
          onClick={() =>
            onResolve({ kind: 'remove-dependency', taskId: conflict.taskId, dep: conflict.dep })
          }
        >
          移除该依赖
        </button>
        <select
          className="rounded border border-amber-300 bg-white px-1 py-1 text-xs"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {taskIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700"
          onClick={() =>
            onResolve({
              kind: 'retarget-dependency',
              taskId: conflict.taskId,
              dep: conflict.dep,
              to: target,
            })
          }
        >
          改指到所选任务
        </button>
      </div>
    </div>
  );
}

export function ConflictPanel({ conflicts, taskIds, onResolve }: Props) {
  if (conflicts.length === 0) {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        当前无未裁决冲突
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {conflicts.map((conflict, i) => {
        if (conflict.type === 'duration-conflict') {
          return (
            <div key={i} className="rounded border border-red-300 bg-red-50 p-3 text-sm">
              <div className="font-medium text-red-900">
                耗时冲突：任务 {conflict.taskId} 被多个来源重复声明且耗时不一致
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {conflict.variants.map((v) => (
                  <button
                    key={v.source}
                    className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                    onClick={() =>
                      onResolve({ kind: 'pick-duration', taskId: conflict.taskId, source: v.source })
                    }
                  >
                    采用 {v.duration}（{v.source}）
                  </button>
                ))}
              </div>
            </div>
          );
        }
        if (conflict.type === 'missing-dependency') {
          return (
            <MissingDepRow
              key={i}
              conflict={conflict}
              taskIds={taskIds}
              onResolve={onResolve}
            />
          );
        }
        return (
          <div key={i} className="rounded border border-purple-300 bg-purple-50 p-3 text-sm">
            <div className="font-medium text-purple-900">
              依赖成环：{conflict.members.join(' → ')}
            </div>
            <div className="mt-1 text-xs text-purple-700">断开任一环内边即可恢复调度：</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {conflict.edges.map((edge) => (
                <button
                  key={`${edge.from}-${edge.to}`}
                  className="rounded bg-purple-600 px-2 py-1 text-xs text-white hover:bg-purple-700"
                  title={`来源：${edge.sources.join('、')}`}
                  onClick={() =>
                    onResolve({ kind: 'remove-dependency', taskId: edge.from, dep: edge.to })
                  }
                >
                  断开 {edge.from} → {edge.to}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
