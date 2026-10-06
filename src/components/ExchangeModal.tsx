import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRightLeft } from 'lucide-react';
import { useStore } from '../store';
import type { Currency } from '../types';
import { exchangeRate, getCurrencyName, convertCurrency, roundToCurrency } from '../utils/currency';

const currencies: Currency[] = ['copper', 'silver', 'silk'];
const units: Record<Currency, string> = { copper: '文', silver: '两', silk: '匹' };

export default function ExchangeModal() {
  const show = useStore(state => state.showExchangeModal);
  const setShow = useStore(state => state.setShowExchangeModal);
  const holdings = useStore(state => state.holdings);
  const exchangeCurrency = useStore(state => state.exchangeCurrency);

  const [from, setFrom] = useState<Currency>('copper');
  const [to, setTo] = useState<Currency>('silver');
  const [amount, setAmount] = useState('');

  const parsed = parseFloat(amount);
  const valid = !isNaN(parsed) && parsed > 0 && parsed <= holdings[from] && from !== to;
  const estimated = valid ? roundToCurrency(convertCurrency(parsed, from, to), to) : 0;

  const handleExchange = async () => {
    if (!valid) return;
    await exchangeCurrency(from, to, parsed);
    setAmount('');
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShow(false)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#faf3e0] rounded-xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#2c1810] flex items-center gap-2">
                <span className="text-xl">💱</span> 兑换所
              </h2>
              <button onClick={() => setShow(false)} className="p-1.5 hover:bg-black/10 rounded-full">
                <X size={18} />
              </button>
            </div>

            <div className="bg-white rounded-lg p-3 mb-4 text-sm text-[#5d3a1a]">
              <p className="font-bold mb-1">今日汇率</p>
              <p>1两白银 = {exchangeRate.silver}文铜钱</p>
              <p>1匹丝绸 = {exchangeRate.silk}文铜钱</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              {([['from', from, setFrom], ['to', to, setTo]] as const).map(([label, value, setter]) => (
                <div key={label}>
                  <p className="text-sm text-[#5d3a1a] mb-1">{label === 'from' ? '付出' : '换得'}</p>
                  <div className="flex flex-col gap-1">
                    {currencies.map((c) => (
                      <button
                        key={c}
                        onClick={() => setter(c)}
                        className={`py-1.5 rounded text-sm font-bold transition-all active:scale-95 ${
                          value === c ? 'bg-[#5d3a1a] text-[#f5e6c8]' : 'bg-white text-[#5d3a1a] hover:bg-gray-100'
                        }`}
                      >
                        {getCurrencyName(c)}（持有 {holdings[c]}{units[c]}）
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-3">
              <p className="text-sm text-[#5d3a1a] mb-1">兑换数量（{units[from]}）</p>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`输入${getCurrencyName(from)}数量`}
                className="w-full px-3 py-2 border border-[#d4b89a] rounded-lg focus:outline-none focus:border-[#5d3a1a]"
              />
            </div>

            {valid && (
              <p className="text-sm text-center text-[#5d3a1a] mb-3">
                可换得 <span className="font-bold text-[#27ae60]">{estimated}{units[to]}{getCurrencyName(to)}</span>
              </p>
            )}

            <button
              onClick={handleExchange}
              disabled={!valid}
              className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                valid
                  ? 'bg-[#27ae60] text-white hover:bg-[#2ecc71]'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <ArrowRightLeft size={18} />
              确认兑换
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
