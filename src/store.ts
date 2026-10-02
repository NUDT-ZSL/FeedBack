import { create } from 'zustand';
import type { Goods, Transaction, Currency, CurrencyHoldings, NegotiationState, DailyStats } from './types';
import { api } from './api';
import { generateForeignTrader, generateInitialOffer, generateCounterOffer, getDateString } from './utils/mock';

interface StoreState {
  goods: Goods[];
  transactions: Transaction[];
  holdings: CurrencyHoldings;
  selectedGoods: Goods | null;
  showGoodsDetail: boolean;
  negotiation: NegotiationState | null;
  showExchangeModal: boolean;
  settlementCurrency: Currency;
  isLoading: boolean;
  error: string | null;
  lowStockItems: string[];

  fetchGoods: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  fetchHoldings: () => Promise<void>;
  fetchAll: () => Promise<void>;

  selectGoods: (goods: Goods | null) => void;
  setShowGoodsDetail: (show: boolean) => void;
  setShowExchangeModal: (show: boolean) => void;
  setSettlementCurrency: (currency: Currency) => void;

  startNegotiation: (goods: Goods) => void;
  acceptOffer: () => Promise<void>;
  rejectOffer: () => void;
  makeCounterOffer: (userOffer: number) => void;

  addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) => Promise<void>;
  updateStock: (goodsId: string, amount: number, type: 'in' | 'out') => Promise<void>;
  purchaseStock: (goodsId: string, quantity: number, cost: number) => Promise<void>;
  exchangeCurrency: (from: Currency, to: Currency, amount: number) => Promise<void>;

  getDailyStats: (date?: string) => DailyStats | null;
  getTodayProfit: () => number;
}

const initialHoldings: CurrencyHoldings = {
  copper: 50000,
  silver: 50,
  silk: 10
};

export const useStore = create<StoreState>((set, get) => ({
  goods: [],
  transactions: [],
  holdings: initialHoldings,
  selectedGoods: null,
  showGoodsDetail: false,
  negotiation: null,
  showExchangeModal: false,
  settlementCurrency: 'copper',
  isLoading: false,
  error: null,
  lowStockItems: [],

  fetchGoods: async () => {
    try {
      set({ isLoading: true });
      const goods = await api.getGoods();
      const lowStockItems = goods.filter(g => g.stock < 3).map(g => g.id);
      set({ goods, lowStockItems, isLoading: false });
    } catch (error) {
      set({ error: '加载货物失败', isLoading: false });
    }
  },

  fetchTransactions: async () => {
    try {
      set({ isLoading: true });
      const transactions = await api.getTransactions();
      set({ transactions, isLoading: false });
    } catch (error) {
      set({ error: '加载交易记录失败', isLoading: false });
    }
  },

  fetchHoldings: async () => {
    try {
      const holdings = await api.getHoldings();
      set({ holdings });
    } catch (error) {
      set({ error: '加载货币持有量失败' });
    }
  },

  fetchAll: async () => {
    await Promise.all([get().fetchGoods(), get().fetchTransactions(), get().fetchHoldings()]);
  },

  selectGoods: (goods) => set({ selectedGoods: goods }),
  setShowGoodsDetail: (show) => set({ showGoodsDetail: show }),
  setShowExchangeModal: (show) => set({ showExchangeModal: show }),
  setSettlementCurrency: (currency) => set({ settlementCurrency: currency }),

  startNegotiation: (goods) => {
    const trader = generateForeignTrader();
    const initialOffer = generateInitialOffer(goods.price);
    set({
      negotiation: {
        trader,
        goods,
        currentOffer: initialOffer,
        round: 1
      }
    });
  },

  acceptOffer: async () => {
    const { negotiation, settlementCurrency } = get();
    if (!negotiation) return;

    const { trader, goods, currentOffer } = negotiation;

    try {
      await api.updateStock(goods.id, 1, 'out');

      await api.addTransaction({
        goodsId: goods.id,
        goodsName: goods.name,
        type: 'sale',
        quantity: 1,
        unitPrice: currentOffer,
        totalAmount: currentOffer,
        currency: settlementCurrency,
        traderName: trader.name,
        traderOrigin: trader.origin
      });

      await Promise.all([get().fetchGoods(), get().fetchTransactions(), get().fetchHoldings()]);
      set({ negotiation: null });
    } catch (error) {
      set({ error: '交易失败' });
    }
  },

  rejectOffer: () => {
    set({ negotiation: null });
  },

  makeCounterOffer: (userOffer) => {
    const { negotiation } = get();
    if (!negotiation) return;

    if (negotiation.round >= 3) {
      set({ negotiation: null });
      return;
    }

    const counterOffer = generateCounterOffer(userOffer, negotiation.currentOffer);
    set({
      negotiation: {
        ...negotiation,
        currentOffer: counterOffer,
        round: negotiation.round + 1,
        userCounterOffer: userOffer
      }
    });
  },

  addTransaction: async (tx) => {
    try {
      await api.addTransaction(tx);
      await get().fetchTransactions();
    } catch (error) {
      set({ error: '添加交易记录失败' });
    }
  },

  updateStock: async (goodsId, amount, type) => {
    try {
      await api.updateStock(goodsId, amount, type);
      await get().fetchGoods();
    } catch (error) {
      set({ error: '更新库存失败' });
    }
  },

  purchaseStock: async (goodsId, quantity, cost) => {
    try {
      await api.purchaseGoods(goodsId, quantity, cost);
      await Promise.all([get().fetchGoods(), get().fetchTransactions(), get().fetchHoldings()]);
    } catch (error) {
      set({ error: '进货失败' });
    }
  },

  exchangeCurrency: async (from, to, amount) => {
    try {
      await api.exchangeCurrency(from, to, amount);
      await Promise.all([get().fetchHoldings(), get().fetchTransactions()]);
    } catch (error) {
      set({ error: '兑换失败' });
    }
  },

  getDailyStats: (date) => {
    const { transactions } = get();
    const targetDate = date || getDateString(Date.now());
    const dayTransactions = transactions.filter(t => getDateString(t.timestamp) === targetDate);

    if (dayTransactions.length === 0) return null;

    const totalSales = dayTransactions
      .filter(t => t.type === 'sale')
      .reduce((sum, t) => sum + t.totalAmount, 0);

    const totalPurchases = dayTransactions
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + t.totalAmount, 0);

    return {
      date: targetDate,
      totalSales,
      totalPurchases,
      profit: totalSales - totalPurchases,
      transactions: dayTransactions
    };
  },

  getTodayProfit: () => {
    const stats = get().getDailyStats();
    return stats?.profit || 0;
  }
}));
