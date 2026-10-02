import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Package } from 'lucide-react';
import type { Goods } from '../types';
import { useStore } from '../store';

interface GoodsCardProps {
  goods: Goods;
  isLowStock: boolean;
}

export default function GoodsCard({ goods, isLowStock }: GoodsCardProps) {
  const [showRestock, setShowRestock] = useState(false);
  const [restockQuantity, setRestockQuantity] = useState(goods.defaultStock);
  const selectGoods = useStore(state => state.selectGoods);
  const setShowGoodsDetail = useStore(state => state.setShowGoodsDetail);
  const startNegotiation = useStore(state => state.startNegotiation);
  const purchaseStock = useStore(state => state.purchaseStock);
  const holdings = useStore(state => state.holdings);

  const handleCardClick = () => {
    selectGoods(goods);
    setShowGoodsDetail(true);
  };

  const handleTrade = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (goods.stock > 0) {
      selectGoods(goods);
      startNegotiation(goods);
    }
  };

  const handleRestock = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const cost = goods.price * restockQuantity * 0.6;
    if (holdings.copper >= cost) {
      await purchaseStock(goods.id, restockQuantity, Math.round(cost));
      setShowRestock(false);
    }
  };

  const estimatedCost = Math.round(goods.price * restockQuantity * 0.6);

  return (
    <motion.div
      layout
      className={`relative bg-[#faf3e0] rounded-lg p-3 cursor-pointer transition-all duration-200 hover:scale-105 hover:-translate-y-1 shadow-md ${
        isLowStock ? 'low-stock border-2 border-[#c0392b]' : 'border border-[#d4b89a]'
      }`}
      onClick={handleCardClick}
      whileHover={{ boxShadow: '0 8px 25px rgba(0,0,0,0.2)' }}
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl">{goods.emoji}</span>
        <h3 className="font-bold text-[#2c1810]">{goods.name}</h3>
        <div className="flex items-center gap-1 text-sm">
          <Package size={14} className="text-[#5d3a1a]" />
          <span className={isLowStock ? 'text-[#c0392b] font-bold' : 'text-[#5d3a1a]'}>
            库存: {goods.stock}
          </span>
        </div>
        <p className="text-[#8b4513] font-bold text-sm">{goods.price}文/两</p>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleTrade}
          disabled={goods.stock === 0}
          className={`flex-1 py-1.5 rounded text-sm font-bold transition-all active:scale-95 ${
            goods.stock > 0
              ? 'bg-[#5d3a1a] text-[#f5e6c8] hover:bg-[#8b4513]'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          交易
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowRestock(true);
          }}
          className="p-1.5 rounded bg-[#27ae60] text-white hover:bg-[#2ecc71] transition-all active:scale-95"
          title="补货"
        >
          <Plus size={16} />
        </button>
      </div>

      <AnimatePresence>
        {showRestock && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-0 bg-[#faf3e0] rounded-lg p-3 flex flex-col justify-center z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="font-bold text-[#2c1810] text-center mb-2">补货 - {goods.name}</h4>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-[#5d3a1a]">数量:</span>
              <input
                type="number"
                value={restockQuantity}
                onChange={(e) => setRestockQuantity(Math.max(1, parseInt(e.target.value) || 0))}
                className="flex-1 px-2 py-1 border border-[#d4b89a] rounded text-center"
                min="1"
              />
            </div>
            <p className="text-xs text-[#5d3a1a] text-center mb-2">
              预计成本: {estimatedCost.toLocaleString()}文
              <br />
              (当前铜钱: {holdings.copper.toLocaleString()}文)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRestock(false)}
                className="flex-1 py-1.5 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-all active:scale-95"
              >
                取消
              </button>
              <button
                onClick={handleRestock}
                disabled={holdings.copper < estimatedCost}
                className={`flex-1 py-1.5 rounded font-bold transition-all active:scale-95 ${
                  holdings.copper >= estimatedCost
                    ? 'bg-[#27ae60] text-white hover:bg-[#2ecc71]'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                确认
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
