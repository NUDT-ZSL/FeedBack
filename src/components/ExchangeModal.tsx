import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRightLeft } from 'lucide-react';
import { useStore } from '../store';
import type { Currency } from '../types';
import { exchangeRate, getCurrencyName, convertCurrency } from '../utils/currency';

const currencies: Currency[] = ['copper', 'silver', 'silk'];
const currencyUnits: Record<Currency, string> = {
  copper: '文',
  silver: '两',
  silk: '匹'
};

export default function ExchangeModal() {
  const showExchangeModal = useStore(state => state.showExchangeModal);
  const setShowExchangeModal = useStore(state => state.setShowExchangeModal);
  const exchangeCurrency = useStore(state => state.exchangeCurrency);
  const holdings = useStore(state => state.holdings);

  const [from, setFrom] = useState<Currency>('copper');
  const [to, setTo] = useState<Currency>('silver');
  const [amount, setAmount] = useState('');

  const parsed = parseFloat(amount);
  const valid = !isNaN(parsed) && parsed > 0 && from !== to && holdings[from] >= parsed;
  const estimated = valid ? convertCurrency(parsed, from, to) : 0;

  const handleExchange = async () => {
    if (!valid) return;
    await exchangeCurrency(from, to, parsed);
    setAmount('');
  };

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <AnimatePresence>
      {showExchangeModal && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowExchangeModal(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#faf3e0] rounded-xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#5d3a1a] to-[#8b4513] text-[#f5e6c8] px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">📜</span> 兑换所
              </h2>
              <button
                onClick={() => setShowExchangeModal(false)}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div className="bg-white rounded-lg p-3 mb-4 shadow">
                <p className="text-sm text-gray-500 mb-2">当前汇率</p>
                <p className="text-center font-bold text-[#5d3a1a]">
                  1匹丝绸 = {exchangeRate.silk / exchangeRate.silver}两白银 = {exchangeRate.silk.toLocaleString()}文铜钱
                </p>
                <p className="text-center text-sm text-[#8b4513]">
                  1两白银 = {exchangeRate.silver.toLocaleString()}文铜钱
                </p>
              </div>

              <div className="bg-white rounded-lg p-3 mb-4 shadow">
                <p className="text-sm text-gray-500 mb-2">持有量</p>
                <div className="flex justify-between text-center">
                  {currencies.map(curr => (
                    <div key={curr}>
                      <p className="text-xs text-gray-400">{getCurrencyName(curr)}</p>
                      <p className="font-bold text-[#2c1810]">
                        {holdings[curr].toLocaleString()}{currencyUnits[curr]}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <select
                  value={from}
                  onChange={e => setFrom(e.target.value as Currency)}
                  className="flex-1 px-3 py-2 border border-[#d4b89a] rounded-lg bg-white focus:outline-none focus:border-[#5d3a1a]"
                >
                  {currencies.map(curr => (
                    <option key={curr} value={curr}>{getCurrencyName(curr)}</option>
                  ))}
                </select>
                <button
                  onClick={handleSwap}
                  className="p-2 bg-[#d4b89a] rounded-lg hover:bg-[#c9a87f] transition-all active:scale-95"
                  title="交换方向"
                >
                  <ArrowRightLeft size={18} />
                </button>
                <select
                  value={to}
                  onChange={e => setTo(e.target.value as Currency)}
                  className="flex-1 px-3 py-2 border border-[#d4b89a] rounded-lg bg-white focus:outline-none focus:border-[#5d3a1a]"
                >
                  {currencies.map(curr => (
                    <option key={curr} value={curr}>{getCurrencyName(curr)}</option>
                  ))}
                </select>
              </div>

              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={`兑换数量（${getCurrencyName(from)}）`}
                className="w-full px-3 py-2 border border-[#d4b89a] rounded-lg mb-2 focus:outline-none focus:border-[#5d3a1a]"
                min="0"
              />

              {from === to && (
                <p className="text-xs text-[#c0392b] mb-2">源货币与目标货币不能相同</p>
              )}
              {!isNaN(parsed) && parsed > holdings[from] && (
                <p className="text-xs text-[#c0392b] mb-2">{getCurrencyName(from)}余额不足</p>
              )}
              {valid && (
                <p className="text-sm text-[#5d3a1a] mb-3 text-center">
                  预计可得：<span className="font-bold">{estimated.toLocaleString()}{currencyUnits[to]}{getCurrencyName(to)}</span>
                </p>
              )}

              <button
                onClick={handleExchange}
                disabled={!valid}
                className={`w-full py-3 rounded-lg font-bold transition-all active:scale-95 ${
                  valid
                    ? 'bg-[#27ae60] text-white hover:bg-[#2ecc71]'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                确认兑换
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
