import type { Goods, Transaction, Currency, CurrencyHoldings, ExchangeRate } from './types';

const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export const api = {
  getHealth: () => request<{ status: string; timestamp: number }>('/health'),

  getGoods: () => request<Goods[]>('/goods'),

  getGoodsById: (id: string) => request<Goods>(`/goods/${id}`),

  updateStock: (id: string, amount: number, type: 'in' | 'out') =>
    request<Goods>(`/goods/${id}/stock`, {
      method: 'PUT',
      body: JSON.stringify({ amount, type })
    }),

  getTransactions: () => request<Transaction[]>('/transactions'),

  addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp'>) =>
    request<Transaction>('/transactions', {
      method: 'POST',
      body: JSON.stringify(tx)
    }),

  getExchangeRate: () => request<ExchangeRate>('/exchange-rate'),

  getHoldings: () => request<CurrencyHoldings>('/holdings'),

  exchangeCurrency: (from: Currency, to: Currency, amount: number) =>
    request<{ success: boolean; holdings: CurrencyHoldings; exchangeTx: Transaction }>('/exchange', {
      method: 'POST',
      body: JSON.stringify({ from, to, amount })
    }),

  purchaseGoods: (goodsId: string, quantity: number, cost: number) =>
    request<{ success: boolean; goods: Goods; holdings: CurrencyHoldings; transaction: Transaction }>('/purchase', {
      method: 'POST',
      body: JSON.stringify({ goodsId, quantity, cost })
    })
};
