import { memo, useEffect } from 'react';
import { Package, TrendingDown, AlertTriangle, Calendar } from 'lucide-react';
import type { InventoryItem } from '@/utils/types';
import { useAppStore } from '@/store/useAppStore';
import {
  LEATHER_NAMES,
  COLOR_PALETTE,
  COLOR_NAMES,
} from '@/utils/constants';

export const InventoryTracker = memo(function InventoryTracker() {
  const { inventory, fetchInventory, fetchLowStock, lowStock } = useAppStore();

  useEffect(() => {
    fetchInventory();
    fetchLowStock();
  }, [fetchInventory, fetchLowStock]);

  if (inventory.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-brand-dark/60">
          <div className="w-5 h-5 border-2 border-brand-brown/30 border-t-brand-brown rounded-full animate-spin" />
          正在加载库存数据...
        </div>
      </div>
    );
  }

  const totalArea = inventory.reduce((s, i) => s + i.areaSqft, 0);
  const lowCount = lowStock.length;
  const totalValue = totalArea * 80;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-brand-dark mb-1">
          库存管理
        </h2>
        <p className="text-sm text-brand-dark/60">
          实时追踪皮料库存，订单确认后自动扣减，保障生产不中断
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="皮料种类"
          value={String(inventory.length)}
          unit="种"
          accent="brown"
          icon={<Package className="w-5 h-5" />}
        />
        <StatCard
          label="库存总面积"
          value={totalArea.toFixed(1)}
          unit="sqft"
          accent="green"
          icon={<Package className="w-5 h-5" />}
        />
        <StatCard
          label="低于安全值"
          value={String(lowCount)}
          unit="种"
          accent="red"
          icon={<AlertTriangle className="w-5 h-5" />}
          highlight={lowCount > 0}
        />
        <StatCard
          label="预估估值"
          value={Math.round(totalValue).toLocaleString()}
          unit="元"
          accent="dark"
          icon={<TrendingDown className="w-5 h-5" />}
        />
      </div>

      <div className="card-leather rounded-card shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-brand-dark flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-brand-brown" />
            库存明细
          </h3>
          <button
            type="button"
            onClick={() => {
              fetchInventory();
              fetchLowStock();
            }}
            className="text-xs text-brand-dark/60 hover:text-brand-brown transition-colors active:scale-95"
          >
            刷新
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {inventory.map((item) => (
            <InventoryCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
});

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  accent: 'brown' | 'green' | 'red' | 'dark';
  icon: React.ReactNode;
  highlight?: boolean;
}

function StatCard({ label, value, unit, accent, icon, highlight }: StatCardProps) {
  const accentMap: Record<string, string> = {
    brown: 'from-brand-brown to-[#A67F1D]',
    green: 'from-success to-[#7CB068]',
    red: 'from-danger to-[#D86256]',
    dark: 'from-brand-dark to-[#5A4230]',
  };
  return (
    <div
      className={`card-leather rounded-card shadow-card p-4 relative overflow-hidden
        ${highlight ? 'ring-2 ring-danger/30' : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div
          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${accentMap[accent]} text-white shadow-md flex items-center justify-center`}
        >
          {icon}
        </div>
        {highlight && (
          <AlertTriangle className="w-4 h-4 text-danger animate-pulse" />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono-num text-2xl font-bold text-brand-dark">
          {value}
        </span>
        <span className="text-xs text-brand-dark/50">{unit}</span>
      </div>
      <div className="text-xs text-brand-dark/60 mt-0.5">{label}</div>
    </div>
  );
}

function InventoryCard({ item }: { item: InventoryItem }) {
  const isLow = item.areaSqft < item.safeThreshold;
  const percent = Math.min(
    100,
    Math.round((item.areaSqft / (item.safeThreshold * 2.5)) * 100),
  );

  return (
    <div
      className={`rounded-xl p-4 border transition-all duration-200 hover:shadow-md card-interactive
        ${isLow ? 'bg-gradient-to-br from-red-50/80 to-white border-danger/30' : 'bg-white/70 border-brand-dark/5'}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-12 h-12 rounded-xl shadow-inner border-2 border-white/60 flex-shrink-0 ${isLow ? 'ring-2 ring-danger/30' : ''}`}
          style={{ backgroundColor: COLOR_PALETTE[item.color] }}
          title={COLOR_NAMES[item.color]}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-medium text-sm text-brand-dark truncate">
              {LEATHER_NAMES[item.leatherType]}
            </span>
            {isLow && (
              <AlertTriangle className="w-3.5 h-3.5 text-danger flex-shrink-0" />
            )}
          </div>
          <div className="text-xs text-brand-dark/50">
            {COLOR_NAMES[item.color]}
          </div>
        </div>
      </div>

      <div className="mb-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="font-mono-num font-bold text-lg text-brand-dark">
            {item.areaSqft}
            <span className="text-[10px] text-brand-dark/50 ml-0.5 font-normal">
              sqft
            </span>
          </span>
          {isLow ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger font-medium">
              库存不足
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">
              充足
            </span>
          )}
        </div>
        <div className="w-full h-1.5 bg-progress-gray/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isLow
              ? 'bg-gradient-to-r from-danger to-[#E07B6E]'
              : 'bg-gradient-to-r from-success to-[#7CB068]'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px] text-brand-dark/40">
          <span>安全值 {item.safeThreshold} sqft</span>
          <span>{percent}%</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-brand-dark/5 text-[10px] text-brand-dark/50">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {item.purchaseDate.slice(5)}
        </div>
        <div className="flex items-center gap-1">
          <TrendingDown className="w-3 h-3" />
          近期耗 {item.recentConsumption}
        </div>
      </div>
    </div>
  );
}
