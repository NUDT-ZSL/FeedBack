/** 工序面板：展示工序列表与当前进度，提供推进/回退入口 */
import { useWorkshopStore } from '@/stores/workshopStore';

export default function StagePanel({ bookId }: { bookId: string }) {
  const snapshot = useWorkshopStore((s) => s.snapshot);
  const submitOp = useWorkshopStore((s) => s.submitOp);
  const simulateConflict = useWorkshopStore((s) => s.simulateConflict);

  const progress = snapshot?.progress.find((p) => p.bookId === bookId);
  const stages = snapshot?.stages ?? [];
  const currentIndex = stages.findIndex((s) => s.id === progress?.currentStageId);

  return (
    <section className="rounded-lg border border-[#c9a96e]/40 bg-[#f5f0e8] p-4 shadow">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#3a3a3a]">修复工序</h2>
        <span className="text-xs text-[#8b5a2b]">版本 v{progress?.version ?? 0}</span>
      </header>

      <ol className="mb-3 space-y-1">
        {stages.map((stage, index) => {
          const isCurrent = stage.id === progress?.currentStageId;
          const isDone = currentIndex > index;
          return (
            <li
              key={stage.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                isCurrent ? 'bg-[#c9a96e]/30 font-bold text-[#7b241c]' : isDone ? 'text-[#8b5a2b]' : 'text-[#3a3a3a]/60'
              }`}
            >
              <span className="w-5 text-center">{isCurrent ? '▶' : isDone ? '✓' : '·'}</span>
              {stage.name}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-lg bg-[#8b5a2b] px-3 py-1 text-sm text-white transition hover:bg-[#c9a96e] disabled:opacity-40"
          disabled={!progress || currentIndex >= stages.length - 1}
          onClick={() => void submitOp({ kind: 'advance_stage', bookId, toStageId: stages[currentIndex + 1].id })}
        >
          推进到下一工序
        </button>
        <button
          className="rounded-lg border border-[#8b5a2b] px-3 py-1 text-sm text-[#8b5a2b] transition hover:bg-[#c9a96e]/30 disabled:opacity-40"
          disabled={!progress || currentIndex < 1}
          onClick={() => void submitOp({ kind: 'advance_stage', bookId, toStageId: stages[currentIndex - 1].id })}
        >
          回退上一工序
        </button>
        <button
          className="rounded-lg border border-[#7b241c] px-3 py-1 text-sm text-[#7b241c] transition hover:bg-[#7b241c]/10"
          onClick={() => void simulateConflict(bookId)}
        >
          模拟并发提交
        </button>
      </div>

      {progress && progress.transitions.length > 0 && (
        <details className="mt-3 text-xs text-[#3a3a3a]/70">
          <summary className="cursor-pointer">切换轨迹（{progress.transitions.length}）</summary>
          <ul className="mt-1 space-y-0.5">
            {progress.transitions.map((t) => (
              <li key={t.seq}>
                #{t.seq} {t.fromStageId ?? '（未开工）'} → {t.toStageId}，操作人：{t.actor}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
