import { useEffect, useState } from 'react';
import { useWorkshopStore } from '@/stores/workshopStore';
import StagePanel from '@/components/workshop/StagePanel';
import MaterialPanel from '@/components/workshop/MaterialPanel';
import RecordPanel from '@/components/workshop/RecordPanel';
import ConflictLog from '@/components/workshop/ConflictLog';

export default function Home() {
  const snapshot = useWorkshopStore((s) => s.snapshot);
  const loading = useWorkshopStore((s) => s.loading);
  const error = useWorkshopStore((s) => s.error);
  const lastResult = useWorkshopStore((s) => s.lastResult);
  const refresh = useWorkshopStore((s) => s.refresh);
  const setActor = useWorkshopStore((s) => s.setActor);
  const [selectedBookId, setSelectedBookId] = useState<string>('');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const books = snapshot?.books ?? [];
  const bookId = selectedBookId || books[0]?.id || '';
  const selectedBook = books.find((b) => b.id === bookId);

  return (
    <div className="min-h-screen bg-[#f5f0e8] text-[#3a3a3a]">
      <header className="bg-[#3c2a1a] px-6 py-4 text-[#f5f0e8]">
        <h1 className="text-xl font-bold tracking-wide">古籍修复工坊 · 修复台</h1>
        <p className="text-xs text-[#c9a96e]">工序推进、材料领用、修复记录共享同一份可追溯状态</p>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            古籍：
            <select
              className="ml-1 rounded-lg border border-[#c9a96e]/60 bg-white px-2 py-1"
              value={bookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title} · {b.author}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            操作人：
            <input
              className="ml-1 w-32 rounded-lg border border-[#c9a96e]/60 bg-white px-2 py-1"
              defaultValue="拓印师"
              onChange={(e) => setActor(e.target.value)}
            />
          </label>
          <button
            className="rounded-lg border border-[#8b5a2b] px-3 py-1 text-sm text-[#8b5a2b] transition hover:bg-[#c9a96e]/30"
            onClick={() => void refresh()}
          >
            重新读取
          </button>
          {loading && <span className="text-xs text-[#8b5a2b]">读取中…</span>}
        </div>

        {error && <div className="rounded-lg bg-[#7b241c]/10 px-3 py-2 text-sm text-[#7b241c]">{error}（请确认已通过 npm run dev 启动后端）</div>}
        {lastResult && lastResult.status === 'conflict' && (
          <div className="rounded-lg bg-[#7b241c]/10 px-3 py-2 text-sm text-[#7b241c]">
            本次操作未生效：版本冲突，已保留到冲突痕迹。当前有效状态以先提交的操作为准。
          </div>
        )}

        {selectedBook && (
          <div className="grid gap-4 md:grid-cols-2">
            <StagePanel bookId={bookId} />
            <MaterialPanel bookId={bookId} />
            <RecordPanel bookId={bookId} />
            <ConflictLog />
          </div>
        )}
      </main>
    </div>
  );
}
