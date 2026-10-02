import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { useStore } from '../store';
import { getDateString, getTimeString } from '../utils/mock';
import { formatCopperValue } from '../utils/currency';

export default function GoodsDetail() {
  const selectedGoods = useStore(state => state.selectedGoods);
  const showGoodsDetail = useStore(state => state.showGoodsDetail);
  const setShowGoodsDetail = useStore(state => state.setShowGoodsDetail);
  const selectGoods = useStore(state => state.selectGoods);

  const handleClose = () => {
    setShowGoodsDetail(false);
    selectGoods(null);
  };

  if (!selectedGoods) return null;

  const totalPurchaseCost = selectedGoods.purchaseRecords.reduce(
    (sum, r) => sum + r.cost,
    0
  );
  const totalSaleRevenue = selectedGoods.saleRecords.reduce(
    (sum, r) => sum + r.revenue,
    0
  );
  const totalProfit = totalSaleRevenue - totalPurchaseCost;
  const totalPurchased = selectedGoods.purchaseRecords.reduce(
    (sum, r) => sum + r.quantity,
    0
  );
  const totalSold = selectedGoods.saleRecords.reduce(
    (sum, r) => sum + r.quantity,
    0
  );

  return (
    <AnimatePresence>
      {showGoodsDetail && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-[#faf3e0] rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#5d3a1a] to-[#8b4513] text-[#f5e6c8] px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{selectedGoods.emoji}</span>
                <div>
                  <h2 className="text-xl font-bold">{selectedGoods.name}</h2>
                  <p className="text-sm text-[#d4b89a]">库存: {selectedGoods.stock} | 标价: {selectedGoods.price}文/两</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-lg p-3 text-center shadow">
                  <BarChart3 size={20} className="mx-auto mb-1 text-[#5d3a1a]" />
                  <p className="text-xs text-gray-500">累计进货</p>
                  <p className="font-bold text-[#5d3a1a]">{totalPurchased}件</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center shadow">
                  <TrendingUp size={20} className="mx-auto mb-1 text-[#27ae60]" />
                  <p className="text-xs text-gray-500">累计售出</p>
                  <p className="font-bold text-[#27ae60]">{totalSold}件</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center shadow">
                  <TrendingDown size={20} className={`mx-auto mb-1 ${totalProfit >= 0 ? 'text-[#27ae60]' : 'text-[#c0392b]'}`} />
                  <p className="text-xs text-gray-500">累计盈亏</p>
                  <p className={`font-bold ${totalProfit >= 0 ? 'text-[#27ae60]' : 'text-[#c0392b]'}`}>
                    {totalProfit >= 0 ? '+' : ''}{formatCopperValue(totalProfit)}
                  </p>
                </div>
              </div>

              {selectedGoods.purchaseRecords.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold text-[#2c1810] mb-3 flex items-center gap-2">
                    <span className="text-lg">📥</span> 进货记录
                  </h3>
                  <div className="bg-white rounded-lg overflow-hidden shadow">
                    <table className="w-full text-sm">
                      <thead className="bg-[#5d3a1a] text-[#f5e6c8]">
                        <tr>
                          <th className="px-3 py-2 text-left">日期</th>
                          <th className="px-3 py-2 text-center">数量</th>
                          <th className="px-3 py-2 text-right">成本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGoods.purchaseRecords.slice().reverse().map((record) => (
                          <tr key={record.id} className="border-t border-gray-100">
                            <td className="px-3 py-2">
                              {getDateString(record.timestamp)} {getTimeString(record.timestamp)}
                            </td>
                            <td className="px-3 py-2 text-center">{record.quantity}件</td>
                            <td className="px-3 py-2 text-right text-[#c0392b]">-{record.cost.toLocaleString()}文</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedGoods.saleRecords.length > 0 && (
                <div>
                  <h3 className="font-bold text-[#2c1810] mb-3 flex items-center gap-2">
                    <span className="text-lg">📤</span> 售出记录
                  </h3>
                  <div className="bg-white rounded-lg overflow-hidden shadow">
                    <table className="w-full text-sm">
                      <thead className="bg-[#27ae60] text-white">
                        <tr>
                          <th className="px-3 py-2 text-left">日期</th>
                          <th className="px-3 py-2 text-center">数量</th>
                          <th className="px-3 py-2 text-left">买家</th>
                          <th className="px-3 py-2 text-right">收入</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGoods.saleRecords.slice().reverse().map((record) => (
                          <tr key={record.id} className="border-t border-gray-100">
                            <td className="px-3 py-2">
                              {getDateString(record.timestamp)} {getTimeString(record.timestamp)}
                            </td>
                            <td className="px-3 py-2 text-center">{record.quantity}件</td>
                            <td className="px-3 py-2">
                              {record.traderName ? `${record.traderName}(${record.traderOrigin})` : '-'}
                            </td>
                            <td className="px-3 py-2 text-right text-[#27ae60]">+{record.revenue.toLocaleString()}文</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedGoods.purchaseRecords.length === 0 && selectedGoods.saleRecords.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-4xl mb-2">📋</p>
                  <p>暂无交易记录</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
