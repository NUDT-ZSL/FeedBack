import { memo, useEffect, useState, useRef, useCallback } from 'react';
import { Plus, Filter, Inbox } from 'lucide-react';
import { OrderCard } from '@/modules/orders/OrderCard';
import { StatusFilter } from '@/modules/orders/StatusFilter';
import { NewOrderForm } from '@/modules/orders/NewOrderForm';
import { useAppStore } from '@/store/useAppStore';

export const DashboardPage = memo(function DashboardPage() {
  const { orders, ordersTotal, fetchOrders, fetchLowStock, loading, statusFilter } =
    useAppStore();
  const [formOpen, setFormOpen] = useState(false);
  const [page, setPage] = useState(1);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchOrders(statusFilter, 1, 50);
    fetchLowStock();
    setPage(1);
  }, [fetchOrders, fetchLowStock, statusFilter]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || loading) return;
    if (orders.length >= ordersTotal) return;
    loadingRef.current = true;
    const next = page + 1;
    setPage(next);
    fetchOrders(statusFilter, next, 50).finally(() => {
      loadingRef.current = false;
    });
  }, [fetchOrders, statusFilter, loading, orders.length, ordersTotal, page]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-brand-dark">
            订单看板
          </h2>
          <p className="text-sm text-brand-dark/60 mt-0.5">
            左右滑动卡片快速切换状态 · 点击查看详情
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="px-4 md:px-5 py-2.5 md:py-3 rounded-xl bg-gradient-to-r from-brand-brown to-[#A67F1D] text-white font-semibold
            interactive-btn shadow-lg shadow-brand-brown/20 flex items-center gap-2 text-sm md:text-base"
        >
          <Plus className="w-4 h-4 md:w-5 md:h-5" />
          新建订单
        </button>
      </div>

      <div className="card-leather rounded-card shadow-card p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-brand-dark/60">
            <Filter className="w-4 h-4" />
            状态筛选
          </div>
          <div className="text-xs text-brand-dark/50">
            共 <span className="font-mono-num text-brand-brown font-bold text-sm">{ordersTotal}</span> 条订单
          </div>
        </div>
        <StatusFilter />
      </div>

      <div>
        {orders.length === 0 && !loading ? (
          <div className="card-leather rounded-card shadow-card p-12 text-center">
            <Inbox className="w-12 h-12 mx-auto text-brand-dark/20 mb-3" />
            <div className="text-brand-dark/50 mb-1">暂无订单数据</div>
            <p className="text-xs text-brand-dark/30">点击右上角「新建订单」开始录入</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>

            <div ref={sentinelRef} className="h-10 mt-4 flex items-center justify-center">
              {loading && (
                <div className="flex items-center gap-2 text-brand-dark/40 text-sm">
                  <div className="w-4 h-4 border-2 border-brand-brown/30 border-t-brand-brown rounded-full animate-spin" />
                  加载更多订单...
                </div>
              )}
              {!loading && orders.length >= ordersTotal && ordersTotal > 0 && (
                <span className="text-xs text-brand-dark/30">— 已加载全部 —</span>
              )}
            </div>
          </>
        )}
      </div>

      <NewOrderForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
});
