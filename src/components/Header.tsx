import { motion } from 'framer-motion';
import { Coins } from 'lucide-react';
import { useStore } from '../store';
import { formatCopperValue } from '../utils/currency';

export default function Header() {
  const todayProfit = useStore(state => state.getTodayProfit());
  const lowStockItems = useStore(state => state.lowStockItems);
  const goods = useStore(state => state.goods);
  const setShowExchangeModal = useStore(state => state.setShowExchangeModal);
  const holdings = useStore(state => state.holdings);

  const lowStockGoods = goods.filter(g => lowStockItems.includes(g.id));

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  return (
    <header className="w-full bg-gradient-to-r from-[#5d3a1a] via-[#8b4513] to-[#5d3a1a] text-[#f5e6c8] shadow-xl">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-3xl">🏮</span>
              <div>
                <h1 className="text-2xl font-bold tracking-wider">粟特商号</h1>
                <p className="text-xs text-[#d4b89a]">长安西市 · 异域奇珍</p>
              </div>
              <span className="text-3xl">🏮</span>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm text-[#d4b89a]">{dateStr}</p>
            <div className="flex items-center gap-6 mt-1">
              <div className="text-center">
                <p className="text-xs text-[#d4b89a]">铜钱</p>
                <p className="font-bold">{holdings.copper.toLocaleString()}文</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[#d4b89a]">白银</p>
                <p className="font-bold">{holdings.silver}两</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[#d4b89a]">丝绸</p>
                <p className="font-bold">{holdings.silk}匹</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowExchangeModal(true)}
            className="flex items-center gap-2 bg-[#f5e6c8] text-[#5d3a1a] px-4 py-2 rounded-lg hover:bg-[#e8d4a8] transition-all hover:scale-105 active:scale-95 shadow-md"
          >
            <Coins size={20} />
            <span className="font-bold">兑换所</span>
          </button>
        </div>

        <div className="mt-3 bg-[#f5e6c8] text-[#2c1810] rounded-lg px-4 py-2 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="flex items-center justify-between relative">
            <div className="flex items-center gap-2">
              <span className="text-lg">📜</span>
              <span className="font-bold">今日盈亏:</span>
              <motion.span
                key={todayProfit}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`font-bold text-xl ${todayProfit >= 0 ? 'text-[#27ae60]' : 'text-[#c0392b]'}`}
              >
                {todayProfit >= 0 ? '+' : ''}{formatCopperValue(todayProfit)}
              </motion.span>
            </div>
            {lowStockGoods.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 bg-[#c0392b]/10 px-3 py-1 rounded-full"
              >
                <span className="text-[#c0392b]">⚠️</span>
                <span className="text-sm text-[#c0392b] font-bold">
                  补货提醒: {lowStockGoods.map(g => g.name).join('、')}库存不足!
                </span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
