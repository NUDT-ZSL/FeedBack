import { create } from 'zustand';
import type { Goods, Transaction, Currency, CurrencyHoldings, NegotiationState, DailyStats } from './types';
import { api } from './api';
import { generateForeignTrader, getDateString } from './utils/mock';
import { createSession, applyUserCounter, MAX_NEGOTIATION_ROUNDS } from './utils/negotiation';
import { convertToCopper } from './utils/currency';

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
    const session = createSession(goods.price);
    set({
      negotiation: {
        trader,
        goods,
        currentOffer: session.traderOfferCopper,
        round: session.round,
        maxRounds: MAX_NEGOTIATION_ROUNDS,
        status: session.status === 'converged' ? 'converged' : 'ongoing',
        history: session.history
      }
    });
  },

  acceptOffer: async () => {
    const { negotiation, settlementCurrency } = get();
    if (!negotiation) return;

    const { trader, goods, currentOffer } = negotiation;

    try {
      await api.sellGoods({
        goodsId: goods.id,
        quantity: 1,
        totalCopper: currentOffer,
        currency: settlementCurrency,
        traderName: trader.name,
        traderOrigin: trader.origin
      });

      await Promise.all([get().fetchGoods(), get().fetchTransactions(), get().fetchHoldings()]);
      set({ negotiation: null });
    } catch (error) {
      set({ error: '交易失败，未产生任何库存与账目变动' });
    }
  },

  rejectOffer: () => {
    set({ negotiation: null });
  },

  makeCounterOffer: (userOffer) => {
    const { negotiation } = get();
    if (!negotiation) return;

    const session = applyUserCounter(
      {
        listPriceCopper: negotiation.goods.price,
        round: negotiation.round,
        maxRounds: negotiation.maxRounds,
        traderOfferCopper: negotiation.currentOffer,
        userOfferCopper: negotiation.userCounterOffer ?? null,
        status: 'ongoing',
        history: negotiation.history
      },
      userOffer
    );

    if (session.status === 'breakdown') {
      set({ negotiation: null, error: '议价破裂，番客拂袖而去' });
      return;
    }

    set({
      negotiation: {
        ...negotiation,
        currentOffer: session.traderOfferCopper,
        round: session.round,
        userCounterOffer: userOffer,
        status: session.status === 'converged' ? 'converged' : 'ongoing',
        history: session.history
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
      .reduce((sum, t) => sum + convertToCopper(t.totalAmount, t.currency), 0);

    const totalPurchases = dayTransactions
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + convertToCopper(t.totalAmount, t.currency), 0);

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
