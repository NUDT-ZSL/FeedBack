import { useEffect } from 'react';
import { useStore } from './store';
import Header from './components/Header';
import ShelfGrid from './components/ShelfGrid';
import TradePanel from './components/TradePanel';
import AccountPanel from './components/AccountPanel';
import GoodsDetail from './components/GoodsDetail';
import ExchangeModal from './components/ExchangeModal';

export default function App() {
  const fetchAll = useStore(state => state.fetchAll);
  const error = useStore(state => state.error);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="min-h-screen bg-[#f5e6c8]">
      <Header />
      <main className="container mx-auto px-4 py-4">
        {error && (
          <div className="mb-4 bg-[#c0392b]/10 border border-[#c0392b] text-[#c0392b] rounded-lg px-4 py-2 text-sm font-bold">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <ShelfGrid />
          </div>
          <div className="flex flex-col gap-4">
            <TradePanel />
            <AccountPanel />
          </div>
        </div>
      </main>
      <GoodsDetail />
      <ExchangeModal />
    </div>
  );
}
