import { memo } from 'react';
import type { OrderStatus } from '@/utils/types';
import { STATUS_FILTER, STATUS_FILTER_NAMES } from '@/utils/constants';
import { useAppStore } from '@/store/useAppStore';

export const StatusFilter = memo(function StatusFilter() {
  const { statusFilter, setStatusFilter, fetchOrders } = useAppStore();

  const handleChange = (v: OrderStatus | 'all') => {
    setStatusFilter(v);
    fetchOrders(v, 1, 50);
  };

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1">
      {STATUS_FILTER.map((f) => {
        const active = statusFilter === f;
        return (
          <button
            key={f}
            type="button"
            onClick={() => handleChange(f)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap
              transition-all duration-200 active:scale-95 min-w-fit
              ${active
                ? 'bg-gradient-to-r from-brand-brown to-[#A67F1D] text-white shadow-md shadow-brand-brown/20'
                : 'bg-white/80 text-brand-dark/70 border border-brand-dark/10 hover:border-brand-brown/30 hover:text-brand-dark'
              }`}
          >
            {STATUS_FILTER_NAMES[f]}
          </button>
        );
      })}
    </div>
  );
});
