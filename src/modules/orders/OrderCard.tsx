import { memo, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  User,
  Calendar,
  Clock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Order } from '@/utils/types';
import {
  STYLE_NAMES,
  LEATHER_NAMES,
  COLOR_PALETTE,
  COLOR_NAMES,
  STATUS_NAMES,
  STATUS_COLORS,
  STATUS_BG_GRADIENTS,
} from '@/utils/constants';
import { useSwipe } from '@/hooks/useSwipe';
import { getNextStatus } from '@/services/dataService';
import { useAppStore } from '@/store/useAppStore';
import { ProgressBar } from '@/modules/common/ProgressBar';

interface OrderCardProps {
  order: Order;
}

function OrderCardComponent({ order }: OrderCardProps) {
  const navigate = useNavigate();
  const { changeOrderStatus, showToast, calculateProgressPercent } =
    useAppStore();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleStatusChange = useCallback(
    async (direction: 'left' | 'right') => {
      const next = getNextStatus(order.status, direction);
      if (!next) {
        showToast(
          direction === 'right' ? '已是最终状态' : '已是初始状态',
          'info',
        );
        return;
      }
      const updated = await changeOrderStatus(order.id, next);
      if (updated) {
        showToast(
          `订单 #${order.id} 状态更新为：${STATUS_NAMES[next]}`,
          'success',
        );
      }
    },
    [order.id, order.status, changeOrderStatus, showToast],
  );

  const swipe = useSwipe({
    threshold: 80,
    onSwipeLeft: () => handleStatusChange('left'),
    onSwipeRight: () => handleStatusChange('right'),
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    swipe.handlePointerDown(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    swipe.handlePointerMove(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    swipe.handlePointerUp(e);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (dragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    navigate(`/orders/${order.id}`);
  };

  const percent = calculateProgressPercent(order);
  const leftDisabled = order.status === 'pending';
  const rightDisabled = order.status === 'completed';

  return (
    <div className="relative group overflow-hidden rounded-card shadow-card">
      {!leftDisabled && (
        <div
          className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-amber-300 to-amber-200/60
            flex items-center justify-center opacity-0 group-hover:opacity-80 transition-opacity"
          aria-hidden="true"
        >
          <ChevronLeft className="w-7 h-7 text-white drop-shadow" />
        </div>
      )}
      {!rightDisabled && (
        <div
          className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-success to-[#7CB068]/60
            flex items-center justify-center opacity-0 group-hover:opacity-80 transition-opacity"
          aria-hidden="true"
        >
          <ChevronRight className="w-7 h-7 text-white drop-shadow" />
        </div>
      )}

      <div
        ref={(el) => {
          cardRef.current = el;
          swipe.elementRef.current = el;
        }}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`card-leather card-interactive rounded-card
          bg-gradient-to-br ${STATUS_BG_GRADIENTS[order.status]}
          p-4 md:p-5 cursor-pointer select-none min-h-[200px]
          transition-[background] duration-300`}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono-num font-bold text-brand-brown text-base">
                #{order.id}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[order.status]} font-medium`}
              >
                {STATUS_NAMES[order.status]}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-brand-dark/60">
              <User className="w-3 h-3" />
              <span className="truncate">{order.customerName}</span>
              <span className="text-brand-dark/30">·</span>
              <span className="font-mono-num text-[10px]">
                {order.customerPhone}
              </span>
            </div>
          </div>
          <div
            className="w-10 h-10 md:w-12 md:h-12 rounded-xl shadow-inner flex-shrink-0 border-2 border-white/50"
            style={{ backgroundColor: COLOR_PALETTE[order.color] }}
            title={COLOR_NAMES[order.color]}
          />
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-brand-dark/50">款式</span>
            <span className="font-medium text-brand-dark">
              {STYLE_NAMES[order.style]}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-brand-dark/50">皮料</span>
            <span className="font-medium text-brand-dark truncate">
              {LEATHER_NAMES[order.leatherType]}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-brand-dark/50">尺寸</span>
            <span className="font-medium text-brand-dark">{order.size}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-brand-dark/50">颜色</span>
            <span className="font-medium text-brand-dark">
              {COLOR_NAMES[order.color]}
            </span>
          </div>
        </div>

        {order.remark && (
          <div className="text-[11px] text-brand-dark/60 bg-white/40 rounded-lg px-2.5 py-1.5 mb-3 line-clamp-2 border border-white/60">
            {order.remark}
          </div>
        )}

        <ProgressBar stages={order.stages} showPercent size="sm" />

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-dark/5 text-[10px] text-brand-dark/50">
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>{order.createdAt.slice(5, 16)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>预计 {order.estimatedCompletionDate.slice(5)}</span>
          </div>
          <div className="font-mono-num text-brand-brown font-semibold">
            {percent}%
          </div>
        </div>
      </div>
    </div>
  );
}

OrderCardComponent.displayName = 'OrderCard';
export const OrderCard = memo(OrderCardComponent);
