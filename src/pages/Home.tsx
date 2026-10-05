import { useEffect, useState } from 'react';
import { Library, ReceiptText, LayoutGrid, BarChart3, Database } from 'lucide-react';
import { useShopStore } from '@/store/useShopStore';
import BooksPanel from '@/components/BooksPanel';
import SalesPanel from '@/components/SalesPanel';
import SlotsPanel from '@/components/SlotsPanel';
import SummaryPanel from '@/components/SummaryPanel';
import DataPanel from '@/components/DataPanel';

const TABS = [
  { id: 'books', label: '书籍库存', icon: Library },
  { id: 'sales', label: '销售流水', icon: ReceiptText },
  { id: 'slots', label: '陈列换位', icon: LayoutGrid },
  { id: 'summary', label: '经营汇总', icon: BarChart3 },
  { id: 'data', label: '数据', icon: Database },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Home() {
  const [tab, setTab] = useState<TabId>('books');
  const books = useShopStore((s) => s.books);
  const loadSample = useShopStore((s) => s.loadSample);

  // 首次使用（本地无任何数据）自动载入样例，方便直接核对推演结果
  useEffect(() => {
    if (useShopStore.persist.hasHydrated() && useShopStore.getState().books.length === 0) {
      loadSample();
    }
  }, [loadSample]);

  return (
    <div className="min-h-screen bg-[#f5e6c8] font-serif text-[#3e2723]">
      <header className="border-b-2 border-[#5d4037] bg-[#5d4037] shadow">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <h1 className="text-xl font-bold tracking-wide text-[#f5e6c8]">
            宋代书坊 · 经营推演簿
          </h1>
          <p className="text-xs text-[#d8c9a3]">
            书籍陈列 · 销售流水 · 库存售罄 · 归因裁决 · 营收利润，本地离线推演
          </p>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-x border-t px-4 py-2 text-sm transition ${
                tab === id
                  ? 'border-[#5d4037] bg-[#f5e6c8] font-bold text-[#5d4037]'
                  : 'border-transparent text-[#d8c9a3] hover:bg-[#6d4c41] hover:text-[#f5e6c8]'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {tab === 'books' && <BooksPanel />}
        {tab === 'sales' && <SalesPanel />}
        {tab === 'slots' && <SlotsPanel />}
        {tab === 'summary' && <SummaryPanel />}
        {tab === 'data' && <DataPanel />}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-6 text-center text-xs text-[#8d6e4a]">
        临安府书坊，共录 {books.length} 种书 · 数据仅存于本机
      </footer>
    </div>
  );
}
