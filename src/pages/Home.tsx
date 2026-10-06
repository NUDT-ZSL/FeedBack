import { useEffect, useState } from 'react';
import { FanDesigner } from '../components/FanDesigner';
import FanAssembler from '../components/FanAssembler';
import OrderManager from '../components/OrderManager';
import InventoryManager from '../components/InventoryManager';
import { orderApi, inventoryApi } from '../api/orderApi';
import { useFanStore } from '../store/useFanStore';
import { COLORS } from '../types';

type TabKey = 'design' | 'assemble' | 'orders' | 'inventory';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'design', label: '画扇', icon: 'fa-paintbrush' },
  { key: 'assemble', label: '组装', icon: 'fa-gear' },
  { key: 'orders', label: '订单管理', icon: 'fa-scroll' },
  { key: 'inventory', label: '扇骨库存', icon: 'fa-warehouse' },
];

const POLL_INTERVAL = 4000;

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>('orders');
  const { setOrders, setFanRibs, notification, hideNotification } = useFanStore();

  useEffect(() => {
    let cancelled = false;
    const syncFromLedger = async () => {
      try {
        const [ordersData, ribsData] = await Promise.all([
          orderApi.getOrders(1, 100),
          inventoryApi.getFanRibs(),
        ]);
        if (!cancelled) {
          setOrders(ordersData);
          setFanRibs(ribsData);
        }
      } catch {
        // 账本暂时不可读时保留本地已展示的事实，下个周期再同步
      }
    };
    syncFromLedger();
    const timer = setInterval(syncFromLedger, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [setOrders, setFanRibs]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: COLORS.gray }}>
      <header className="shadow-lg" style={{ backgroundColor: COLORS.wood }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-wide" style={{ color: COLORS.cream }}>
              <i className="fa-solid fa-fan mr-2" />姑苏绢扇工坊
            </h1>
            <p className="text-xs mt-1" style={{ color: COLORS.gold }}>
              明代姑苏 · 制扇名坊 · 画扇 · 组装 · 接单 · 盘库
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 rounded-lg text-sm transition-all"
                style={{
                  backgroundColor: activeTab === tab.key ? COLORS.gold : 'rgba(245,230,211,0.12)',
                  color: activeTab === tab.key ? COLORS.wood : COLORS.cream,
                }}>
                <i className={`fa-solid ${tab.icon} mr-1`} />{tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6" style={{ minHeight: 'calc(100vh - 96px)' }}>
        <div className="bg-amber-50 rounded-xl shadow-xl mx-4 md:mx-0 p-2 md:p-4" style={{ minHeight: 600 }}>
          {activeTab === 'design' && <FanDesigner />}
          {activeTab === 'assemble' && <FanAssembler />}
          {activeTab === 'orders' && <OrderManager />}
          {activeTab === 'inventory' && <InventoryManager />}
        </div>
      </main>

      {notification?.show && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-lg w-[90%]">
          <div className="px-5 py-3 rounded-lg shadow-2xl text-white text-sm flex items-center justify-between"
            style={{
              backgroundColor:
                notification.type === 'success' ? COLORS.malachite
                : notification.type === 'error' ? COLORS.cinnabar
                : COLORS.azurite,
            }}>
            <span>
              <i className={`fa-solid ${
                notification.type === 'success' ? 'fa-circle-check'
                : notification.type === 'error' ? 'fa-circle-exclamation'
                : 'fa-circle-info'
              } mr-2`} />
              {notification.message}
            </span>
            <button onClick={hideNotification} className="ml-4 opacity-80 hover:opacity-100">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
