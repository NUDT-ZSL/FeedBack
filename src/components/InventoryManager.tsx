import { useState } from 'react';
import { inventoryApi, getApiErrorMessage } from '../api/orderApi';
import { useFanStore } from '../store/useFanStore';
import { COLORS } from '../types';

const RESTOCK_AMOUNT = 12;

export default function InventoryManager() {
  const { fanRibs, updateFanRib, showNotification } = useFanStore();
  const [restockingId, setRestockingId] = useState<string | null>(null);

  const handleRestock = async (ribId: string, quantity: number) => {
    if (restockingId) return;
    setRestockingId(ribId);
    try {
      const updated = await inventoryApi.restockFanRib(ribId, quantity);
      updateFanRib(updated);
      showNotification(`扇骨 #${updated.number} 已补货 ${quantity} 根，现存 ${updated.quantity} 根`, 'success');
    } catch (error) {
      showNotification(getApiErrorMessage(error, '补货失败'), 'error');
    } finally {
      setRestockingId(null);
    }
  };

  const totalStock = fanRibs.reduce((sum, rib) => sum + rib.quantity, 0);
  const lowStockCount = fanRibs.filter((rib) => rib.quantity < 12).length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: COLORS.wood }}>扇骨库存</h2>
        <p className="text-sm text-gray-500 mt-1">
          总库存 {totalStock} 根 · {lowStockCount > 0 ? `${lowStockCount} 种扇骨低于一把用量（12 根）` : '库存充足'} · 与订单页共用同一本总账
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg shadow-lg">
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: COLORS.wood }}>
              {['编号', '材质', '颜色', '库存数量', '状态', '操作'].map((header) => (
                <th key={header} className="px-4 py-3 text-left font-medium" style={{ color: COLORS.cream }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fanRibs.map((rib) => {
              const low = rib.quantity < 12;
              return (
                <tr key={rib.id} className="border-b border-amber-200"
                  style={{ backgroundColor: low ? '#fdf3e3' : undefined }}>
                  <td className="px-4 py-3 font-mono text-sm">#{rib.number}</td>
                  <td className="px-4 py-3">{rib.material}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block w-5 h-5 rounded-full border border-gray-300 align-middle"
                      style={{ backgroundColor: rib.color }} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-bold" style={{ color: low ? COLORS.cinnabar : COLORS.wood }}>
                      {rib.quantity}
                    </span>
                    <span className="text-xs text-gray-400 ml-1">根</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-full text-white text-xs"
                      style={{ backgroundColor: rib.quantity > 0 ? (low ? COLORS.goldDark : COLORS.malachite) : COLORS.cinnabar }}>
                      {rib.quantity > 0 ? (low ? '偏低' : '充足') : '缺货'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleRestock(rib.id, RESTOCK_AMOUNT)} disabled={restockingId === rib.id}
                      className="px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 disabled:opacity-50">
                      补货 {RESTOCK_AMOUNT} 根
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
