import type { Goods, Transaction, Currency, CurrencyHoldings } from '../types';
import { toSettlementAmount } from './currency';
import { generateId } from './mock';

export interface LedgerState {
  goods: Goods[];
  transactions: Transaction[];
  holdings: CurrencyHoldings;
}

export interface SaleInput {
  goodsId: string;
  quantity: number;
  totalCopper: number;
  currency: Currency;
  traderName?: string;
  traderOrigin?: string;
}

export type SaleResult =
  | { ok: true; transaction: Transaction; goods: Goods; holdings: CurrencyHoldings }
  | { ok: false; error: string };

function validateSale(state: LedgerState, input: SaleInput): Goods | string {
  const item = state.goods.find(g => g.id === input.goodsId);
  if (!item) return '货物不存在';
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    return '成交数量非法';
  }
  if (!Number.isFinite(input.totalCopper) || input.totalCopper <= 0) return '成交金额非法';
  if (item.stock < input.quantity) return '库存不足';
  if (!(input.currency in state.holdings)) return '结算货币非法';
  return item;
}

export function settleSale(state: LedgerState, input: SaleInput): SaleResult {
  const validation = validateSale(state, input);
  if (typeof validation === 'string') return { ok: false, error: validation };
  const item = validation;

  const settleAmount = toSettlementAmount(input.totalCopper, input.currency);
  const timestamp = Date.now();

  const snapshot = JSON.stringify({
    goods: state.goods,
    transactions: state.transactions,
    holdings: state.holdings
  });

  try {
    item.stock -= input.quantity;
    state.holdings[input.currency] += settleAmount;

    item.saleRecords.push({
      id: generateId(),
      quantity: input.quantity,
      revenue: input.totalCopper,
      timestamp,
      traderName: input.traderName,
      traderOrigin: input.traderOrigin
    });

    const transaction: Transaction = {
      id: generateId(),
      goodsId: item.id,
      goodsName: item.name,
      type: 'sale',
      quantity: input.quantity,
      unitPrice: settleAmount,
      totalAmount: settleAmount,
      currency: input.currency,
      timestamp,
      traderName: input.traderName,
      traderOrigin: input.traderOrigin
    };
    state.transactions.unshift(transaction);

    return { ok: true, transaction, goods: item, holdings: state.holdings };
  } catch (error) {
    const restored = JSON.parse(snapshot) as LedgerState;
    state.goods.splice(0, state.goods.length, ...restored.goods);
    state.transactions.splice(0, state.transactions.length, ...restored.transactions);
    Object.assign(state.holdings, restored.holdings);
    return { ok: false, error: '结算写入失败，已回滚' };
  }
}
