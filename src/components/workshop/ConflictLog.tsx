/** 冲突痕迹面板：展示被版本冲突拦下的操作，当前有效状态可判定 */
import { useWorkshopStore } from '@/stores/workshopStore';

const KIND_LABEL: Record<string, string> = {
  advance_stage: '工序推进',
  requisition_material: '材料领用',
  return_material: '材料退回',
  add_record: '修复记录',
};

export default function ConflictLog() {
  const snapshot = useWorkshopStore((s) => s.snapshot);
  const conflicts = snapshot?.conflicts ?? [];
  const books = snapshot?.books ?? [];

  return (
    <section className="rounded-lg border border-[#7b241c]/40 bg-[#f5f0e8] p-4 shadow">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#7b241c]">冲突痕迹</h2>
        <span className="text-xs text-[#8b5a2b]">{conflicts.length} 条未生效操作</span>
      </header>
      {conflicts.length === 0 ? (
        <p className="text-sm text-[#3a3a3a]/50">暂无冲突。并发或过期版本提交的操作会保留在这里。</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {conflicts.map((c) => (
            <li key={c.seq} className="rounded bg-[#7b241c]/5 px-2 py-1">
              <span className="mr-2 font-bold text-[#7b241c]">#{c.seq} {KIND_LABEL[c.op.kind] ?? c.op.kind}</span>
              <span className="text-[#3a3a3a]">
                {books.find((b) => b.id === c.op.bookId)?.title ?? c.op.bookId}，操作人：{c.op.actor}
              </span>
              <span className="ml-2 text-xs text-[#3a3a3a]/60">{c.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
