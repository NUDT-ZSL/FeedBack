import { memo } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useNavigate } from 'react-router-dom';
import { LEATHER_NAMES, COLOR_NAMES } from '@/utils/constants';

function LowStockAlertComponent() {
  const { lowStock, fetchLowStock } = useAppStore();
  const navigate = useNavigate();

  if (lowStock.length === 0) return null;

  const topItems = lowStock.slice(0, 3);

  return (
    <div
      className="sticky top-16 z-10 bg-gradient-to-r from-danger via-[#D65A49] to-danger text-white shadow-lg
        animate-slideInRight overflow-hidden"
      role="alert"
    >
      <div className="relative px-4 md:px-8 py-3 flex items-center gap-3">
        <div
          className="absolute inset-0 pointer-events-none animate-shake"
          style={{ animationDuration: '0.3s' }}
        />
        <AlertTriangle className="w-6 h-6 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">
            库存预警 · {lowStock.length} 种皮料低于安全阈值
          </div>
          <div className="text-[11px] opacity-90 truncate mt-0.5">
            {topItems
              .map(
                (it) =>
                  `${LEATHER_NAMES[it.leatherType]}·${COLOR_NAMES[it.color]}(${it.areaSqft}sqft)`,
              )
              .join('，')}
            {lowStock.length > topItems.length && ' 等'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            navigate('/purchases');
          }}
          className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 active:scale-95 text-xs font-semibold transition-all min-w-[80px] text-center"
        >
          去采购
        </button>
        <button
          type="button"
          onClick={() => {
            fetchLowStock();
          }}
          className="p-1.5 -mr-1 rounded-lg hover:bg-white/20 active:scale-90 transition-all"
          aria-label="关闭警告"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

LowStockAlertComponent.displayName = 'LowStockAlert';
export const LowStockAlert = memo(LowStockAlertComponent);
