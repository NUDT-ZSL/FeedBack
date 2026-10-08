/** 记录面板：展示修复记录列表，提供新增记录入口 */
import { useState } from 'react';
import { useWorkshopStore } from '@/stores/workshopStore';

export default function RecordPanel({ bookId }: { bookId: string }) {
  const snapshot = useWorkshopStore((s) => s.snapshot);
  const submitOp = useWorkshopStore((s) => s.submitOp);
  const [content, setContent] = useState('');
  const [stageId, setStageId] = useState('');

  const stages = snapshot?.stages ?? [];
  const records = (snapshot?.records ?? []).filter((r) => r.bookId === bookId);
  const effectiveStageId = stageId || stages[0]?.id || '';

  const addRecord = async () => {
    if (!content.trim() || !effectiveStageId) return;
    const result = await submitOp({ kind: 'add_record', bookId, stageId: effectiveStageId, content: content.trim() });
    if (result.status === 'applied') setContent('');
  };

  return (
    <section className="rounded-lg border border-[#c9a96e]/40 bg-[#f5f0e8] p-4 shadow">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#3a3a3a]">修复记录</h2>
        <span className="text-xs text-[#8b5a2b]">共 {records.length} 条</span>
      </header>

      <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto text-sm">
        {records.length === 0 && <li className="text-[#3a3a3a]/50">暂无记录</li>}
        {records.map((r) => (
          <li key={r.seq} className="rounded bg-white/50 px-2 py-1">
            <span className="mr-2 text-xs text-[#8b5a2b]">#{r.seq} {stages.find((s) => s.id === r.stageId)?.name ?? r.stageId}</span>
            <span className="text-[#3a3a3a]">{r.content}</span>
            <span className="ml-2 text-xs text-[#3a3a3a]/50">—— {r.actor}</span>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <select
          className="rounded-lg border border-[#c9a96e]/60 bg-white px-2 py-1 text-sm"
          value={effectiveStageId}
          onChange={(e) => setStageId(e.target.value)}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input
          className="flex-1 rounded-lg border border-[#c9a96e]/60 bg-white px-2 py-1 text-sm"
          placeholder="记录本次修复内容…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className="rounded-lg bg-[#8b5a2b] px-3 py-1 text-sm text-white transition hover:bg-[#c9a96e]"
          onClick={() => void addRecord()}
        >
          添加
        </button>
      </div>
    </section>
  );
}
