import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Clock, TrendingUp, TrendingDown, Repeat } from 'lucide-react';
import { useStore } from '../store';
import { groupTransactionsByDate, getTimeString } from '../utils/mock';
import { formatCopperValue, getCurrencyName } from '../utils/currency';
import type { Transaction } from '../types';

export default function AccountPanel() {
  const transactions = useStore(state => state.transactions);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const groupedTransactions = groupTransactionsByDate(transactions);
  const sortedDates = Object.keys(groupedTransactions).sort((a, b) => b.localeCompare(a));

  const toggleDate = (date: string) => {
    setExpandedDates(prev => ({
      ...prev,
      [date]: !prev[date]
    }));
  };

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'sale':
        return <TrendingUp size={14} className="text-[#27ae60]" />;
      case 'purchase':
        return <TrendingDown size={14} className="text-[#c0392b]" />;
      case 'exchange':
        return <Repeat size={14} className="text-[#f39c12]" />;
    }
  };

  const getTypeLabel = (type: Transaction['type']) => {
    switch (type) {
      case 'sale':
        return '售出';
      case 'purchase':
        return '进货';
      case 'exchange':
        return '兑换';
    }
  };

  const getDailyStats = (txs: Transaction[]) => {
    const sales = txs.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.totalAmount, 0);
    const purchases = txs.filter(t => t.type === 'purchase').reduce((sum, t) => sum + t.totalAmount, 0);
    return { sales, purchases, profit: sales - purchases };
  };

  return (
    <motion.div
      className="bg-[#faf3e0] rounded-xl shadow-xl overflow-hidden"
      animate={{ height: isCollapsed ? 'auto' : 'auto' }}
    >
      <div
        className="bg-gradient-to-r from-[#5d3a1a] to-[#8b4513] text-[#f5e6c8] px-4 py-3 flex items-center justify-between cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">📜</span>
          <h2 className="text-lg font-bold">账目明细</h2>
          <span className="text-sm text-[#d4b89a]">({transactions.length}笔)</span>
        </div>
        <button className="p-1 hover:bg-white/20 rounded transition-colors">
          {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className="p-4 max-h-[400px] overflow-y-auto"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#b5835a #f5e6c8'
              }}
            >
              <style>{`
                div::-webkit-scrollbar {
                  width: 8px;
                }
                div::-webkit-scrollbar-track {
                  background: #f5e6c8;
                  border-radius: 4px;
                }
                div::-webkit-scrollbar-thumb {
                  background: #b5835a;
                  border-radius: 4px;
                }
                div::-webkit-scrollbar-thumb:hover {
                  background: #8b6914;
                }
              `}</style>

              {sortedDates.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-4xl mb-2">📋</p>
                  <p>暂无交易记录</p>
                </div>
              ) : (
                sortedDates.map((date) => {
                  const txs = groupedTransactions[date];
                  const stats = getDailyStats(txs);
                  const isExpanded = expandedDates[date] ?? true;

                  return (
                    <div key={date} className="mb-4 last:mb-0">
                      <div
                        className="bg-white rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleDate(date)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock size={16} className="text-[#5d3a1a]" />
                            <span className="font-bold text-[#2c1810]">{date}</span>
                            <span className="text-sm text-gray-500">({txs.length}笔)</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-xs text-gray-500">营业额</p>
                              <p className="text-sm font-bold text-[#27ae60]">
                                +{formatCopperValue(stats.sales)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-500">支出</p>
                              <p className="text-sm font-bold text-[#c0392b]">
                                -{formatCopperValue(stats.purchases)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-500">盈亏</p>
                              <p className={`text-sm font-bold ${stats.profit >= 0 ? 'text-[#27ae60]' : 'text-[#c0392b]'}`}>
                                {stats.profit >= 0 ? '+' : ''}{formatCopperValue(stats.profit)}
                              </p>
                            </div>
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-1 space-y-1"
                          >
                            {txs.map((tx) => (
                              <motion.div
                                key={tx.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="bg-white/70 rounded-lg p-2 flex items-center justify-between text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  {getTypeIcon(tx.type)}
                                  <span className="text-gray-500">{getTimeString(tx.timestamp)}</span>
                                  <span className="font-medium text-[#2c1810]">
                                    {getTypeLabel(tx.type)} {tx.goodsName}
                                  </span>
                                  {tx.traderName && (
                                    <span className="text-xs text-gray-400">
                                      ({tx.traderName}·{tx.traderOrigin})
                                    </span>
                                  )}
                                  {tx.type === 'exchange' && tx.exchangeFrom && tx.exchangeTo && (
                                    <span className="text-xs text-gray-400">
                                      {tx.exchangeAmount}
                                      {getCurrencyName(tx.exchangeFrom)} → {tx.quantity.toFixed(2)}
                                      {getCurrencyName(tx.exchangeTo)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-gray-500">
                                    {tx.quantity}
                                    {tx.type === 'sale' || tx.type === 'purchase' ? '件' : ''} × {tx.unitPrice}文
                                  </span>
                                  <span
                                    className={`font-bold ${
                                      tx.type === 'sale'
                                        ? 'text-[#27ae60]'
                                        : tx.type === 'purchase'
                                        ? 'text-[#c0392b]'
                                        : 'text-[#f39c12]'
                                    }`}
                                  >
                                    {tx.type === 'sale' ? '+' : tx.type === 'purchase' ? '-' : '±'}
                                    {formatCopperValue(tx.totalAmount)}
                                  </span>
                                </div>
                              </motion.div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
