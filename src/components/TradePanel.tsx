import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, ThumbsDown, RefreshCw, X } from 'lucide-react';
import { useStore } from '../store';
import ForeignTrader from './ForeignTrader';
import type { Currency } from '../types';
import {
  getCurrencyName,
  formatAmountInCurrency,
  convertToCopper,
  exchangeRate
} from '../utils/currency';

const currencyUnits: Record<Currency, string> = {
  copper: '文',
  silver: '两',
  silk: '匹'
};

export default function TradePanel() {
  const negotiation = useStore(state => state.negotiation);
  const acceptOffer = useStore(state => state.acceptOffer);
  const rejectOffer = useStore(state => state.rejectOffer);
  const makeCounterOffer = useStore(state => state.makeCounterOffer);
  const dismissNegotiation = useStore(state => state.dismissNegotiation);
  const settlementCurrency = useStore(state => state.settlementCurrency);
  const setSettlementCurrency = useStore(state => state.setSettlementCurrency);
  const [counterOffer, setCounterOffer] = useState('');
  const [showCounterInput, setShowCounterInput] = useState(false);
  const [reaction, setReaction] = useState<'idle' | 'happy' | 'sad' | 'thinking'>('idle');

  const handleAccept = async () => {
    setReaction('happy');
    setTimeout(() => {
      acceptOffer();
      setReaction('idle');
    }, 800);
  };

  const handleReject = () => {
    setReaction('sad');
    setTimeout(() => {
      rejectOffer();
      setReaction('idle');
      setShowCounterInput(false);
      setCounterOffer('');
    }, 800);
  };

  const handleCounterOffer = () => {
    const input = parseFloat(counterOffer);
    if (isNaN(input) || input <= 0) return;
    // 还价以所选结算货币录入，一次性换算为铜钱后全程按铜钱口径议价
    const offerCopper = Math.round(convertToCopper(input, settlementCurrency));
    if (offerCopper <= 0) return;
    setReaction('thinking');
    setTimeout(() => {
      makeCounterOffer(offerCopper);
      setShowCounterInput(false);
      setCounterOffer('');
      setReaction('idle');
    }, 600);
  };

  const currencies: Currency[] = ['copper', 'silver', 'silk'];
  const isBreakdown = negotiation?.status === 'breakdown';

  return (
    <AnimatePresence>
      {negotiation && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-[#d4b89a] rounded-xl p-4 shadow-xl h-full flex flex-col"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#2c1810] flex items-center gap-2">
              <span className="text-xl">🤝</span> 讨价还价
            </h2>
            <button
              onClick={handleReject}
              className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="bg-[#faf3e0] rounded-lg p-4 mb-4 flex-shrink-0">
            <ForeignTrader trader={negotiation.trader} reaction={reaction} />
          </div>

          <div className="bg-white rounded-lg p-4 mb-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">货物</span>
              <span className="font-bold flex items-center gap-1">
                <span className="text-xl">{negotiation.goods.emoji}</span>
                {negotiation.goods.name}
              </span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">标价</span>
              <span className="font-bold text-[#8b4513]">
                {formatAmountInCurrency(negotiation.goods.price, settlementCurrency)}
              </span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">第 {negotiation.round} 轮</span>
              <span className="text-xs text-gray-400">最多{negotiation.maxRounds}轮</span>
            </div>
            <div className="border-t border-gray-200 pt-3 mt-3">
              <p className="text-center text-sm text-gray-500 mb-1">番客出价</p>
              <p className="text-center text-2xl font-bold text-[#c0392b]">
                {formatAmountInCurrency(negotiation.currentOffer, settlementCurrency)}
              </p>
              <p className="text-center text-xs text-gray-400 mt-1">
                比标价低 {Math.round((1 - negotiation.currentOffer / negotiation.goods.price) * 100)}%
              </p>
            </div>
            {negotiation.userCounterOffer !== undefined && (
              <div className="border-t border-gray-200 pt-3 mt-3">
                <p className="text-center text-sm text-gray-500 mb-1">我方还价</p>
                <p className="text-center text-xl font-bold text-[#27ae60]">
                  {formatAmountInCurrency(negotiation.userCounterOffer, settlementCurrency)}
                </p>
              </div>
            )}
          </div>

          <div className="mb-4 flex-shrink-0">
            <p className="text-sm text-[#2c1810] mb-2">结算货币:</p>
            <div className="flex gap-2">
              {currencies.map((curr) => (
                <button
                  key={curr}
                  onClick={() => setSettlementCurrency(curr)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 ${
                    settlementCurrency === curr
                      ? 'bg-[#5d3a1a] text-[#f5e6c8]'
                      : 'bg-white text-[#5d3a1a] hover:bg-gray-100'
                  }`}
                >
                  {getCurrencyName(curr)}
                </button>
              ))}
            </div>
            <p className="text-xs text-center text-[#5d3a1a] mt-2">
              应收: {formatAmountInCurrency(negotiation.currentOffer, settlementCurrency)}
              {settlementCurrency !== 'copper' && `（合${negotiation.currentOffer}文）`}
            </p>
          </div>

          {isBreakdown && (
            <div className="bg-[#fdf0ee] border border-[#c0392b] rounded-lg p-3 mb-4 flex-shrink-0">
              <p className="text-sm text-[#c0392b] font-bold text-center">💔 谈判破裂</p>
              <p className="text-xs text-[#c0392b] text-center mt-1">
                {negotiation.breakdownReason || '双方未能达成一致'}
              </p>
              <p className="text-xs text-gray-500 text-center mt-1">库存与账目均未变动</p>
            </div>
          )}

          {showCounterInput && !isBreakdown && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-lg p-3 mb-4 flex-shrink-0"
            >
              <p className="text-sm text-gray-600 mb-2">
                你的还价（{getCurrencyName(settlementCurrency)}，{currencyUnits[settlementCurrency]}）:
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={counterOffer}
                  onChange={(e) => setCounterOffer(e.target.value)}
                  placeholder={`输入价格（${currencyUnits[settlementCurrency]}）`}
                  className="flex-1 px-3 py-2 border border-[#d4b89a] rounded-lg focus:outline-none focus:border-[#5d3a1a]"
                  autoFocus
                />
                <button
                  onClick={handleCounterOffer}
                  className="px-4 py-2 bg-[#f39c12] text-white rounded-lg font-bold hover:bg-[#e67e22] transition-all active:scale-95"
                >
                  还价
                </button>
              </div>
              {settlementCurrency !== 'copper' && counterOffer && !isNaN(parseFloat(counterOffer)) && (
                <p className="text-xs text-gray-400 mt-1">
                  约合 {Math.round(convertToCopper(parseFloat(counterOffer), settlementCurrency))}文
                  （1{currencyUnits[settlementCurrency]} = {exchangeRate[settlementCurrency]}文）
                </p>
              )}
            </motion.div>
          )}

          <div className="flex flex-col gap-2 mt-auto">
            {isBreakdown ? (
              <button
                onClick={dismissNegotiation}
                className="w-full py-3 bg-[#5d3a1a] text-[#f5e6c8] rounded-lg font-bold hover:bg-[#8b4513] transition-all active:scale-95"
              >
                番客已离开（关闭）
              </button>
            ) : (
              <>
                <button
                  onClick={handleAccept}
                  className="w-full py-3 bg-[#27ae60] text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-[#2ecc71] transition-all active:scale-95"
                >
                  <ThumbsUp size={18} />
                  接受（按 {formatAmountInCurrency(negotiation.currentOffer, settlementCurrency)} 成交）
                </button>

                {!showCounterInput && negotiation.round < negotiation.maxRounds && (
                  <button
                    onClick={() => setShowCounterInput(true)}
                    className="w-full py-3 bg-[#f39c12] text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-[#e67e22] transition-all active:scale-95"
                  >
                    <RefreshCw size={18} />
                    还价
                  </button>
                )}

                <button
                  onClick={handleReject}
                  className="w-full py-3 bg-[#c0392b] text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-[#e74c3c] transition-all active:scale-95"
                >
                  <ThumbsDown size={18} />
                  拒绝（不卖）
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}

      {!negotiation && (
        <div className="bg-[#d4b89a] rounded-xl p-6 shadow-xl h-full flex flex-col items-center justify-center">
          <span className="text-6xl mb-4">🏪</span>
          <h3 className="text-xl font-bold text-[#2c1810] mb-2">暂无交易</h3>
          <p className="text-[#5d3a1a] text-center">
            点击货架上的"交易"按钮<br />
            与番客讨价还价
          </p>
        </div>
      )}
    </AnimatePresence>
  );
}
