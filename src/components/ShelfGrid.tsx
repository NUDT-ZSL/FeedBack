import { useStore } from '../store';
import GoodsCard from './GoodsCard';

export default function ShelfGrid() {
  const goods = useStore(state => state.goods);
  const lowStockItems = useStore(state => state.lowStockItems);

  return (
    <div className="bg-[#5d3a1a] rounded-xl p-4 shadow-2xl">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">📦</span>
        <h2 className="text-xl font-bold text-[#f5e6c8]">货架</h2>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-3">
        {goods.map((item) => (
          <GoodsCard
            key={item.id}
            goods={item}
            isLowStock={lowStockItems.includes(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
