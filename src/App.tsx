import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import ShelfGrid from './components/ShelfGrid';
import TradePanel from './components/TradePanel';
import AccountPanel from './components/AccountPanel';
import GoodsDetail from './components/GoodsDetail';
import ExchangeModal from './components/ExchangeModal';
import { useStore } from './store';

function MainPage() {
  const fetchAll = useStore(state => state.fetchAll);
  const error = useStore(state => state.error);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="min-h-screen bg-[#f5e6c8]">
      <Header />
      {error && (
        <div className="container mx-auto px-4 mt-3">
          <div className="bg-[#fdf0ee] border border-[#c0392b] text-[#c0392b] rounded-lg px-4 py-2 text-sm">
            {error}
          </div>
        </div>
      )}
      <main className="container mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
