import { useState } from 'react';
import { FanDesigner } from '../components/FanDesigner';
import FanAssembler from '../components/FanAssembler';
import OrderManager from '../components/OrderManager';
import { useFanStore } from '../store/useFanStore';
import { COLORS } from '../types';

type TabKey = 'design' | 'assemble' | 'orders';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'design', label: '画扇' },
  { key: 'assemble', label: '组装' },
  { key: 'orders', label: '订单管理' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>('orders');
  const notification = useFanStore((s) => s.notification);

  return (
    <div className="min-h-screen" style={{ backgroundColor: COLORS.cream }}>
      <header className="shadow-md" style={{ backgroundColor: COLORS.wood }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: COLORS.cream }}>
            姑苏绢扇工坊
          </h1>
          <nav className="flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: activeTab === tab.key ? COLORS.gold : 'transparent',
                  color: activeTab === tab.key ? COLORS.ink : COLORS.cream,
                  border: `1px solid ${COLORS.gold}`,
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-4">
        {activeTab === 'design' && <FanDesigner />}
        {activeTab === 'assemble' && (
          <div className="p-4 md:p-6 max-w-3xl mx-auto">
            <FanAssembler />
          </div>
        )}
        {activeTab === 'orders' && <OrderManager />}
      </main>

      {notification?.show && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg shadow-xl text-sm text-white z-50"
          style={{
            backgroundColor:
              notification.type === 'success'
                ? COLORS.malachite
                : notification.type === 'error'
                  ? COLORS.cinnabar
                  : COLORS.azurite,
          }}
        >
          {notification.message}
        </div>
      )}
    </div>
  );
}
