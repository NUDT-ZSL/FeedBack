import type {
  Currency,
  CurrencyHoldings,
  Goods,
  SaleRequest,
  Transaction
} from '../types';
import { convertCopperToCurrency, roundToCurrency } from './currency';
import { generateId } from './mock';

export interface MarketState {
  goods: Goods[];
  transactions: Transaction[];
  holdings: CurrencyHoldings;
}

export type SaleResult = {
  transaction: Transaction;
  goods: Goods;
  holdings: CurrencyHoldings;
  /** 实际入账金额（结算货币口径） */
  receivedAmount: number;
};

const VALID_CURRENCIES: Currency[] = ['copper', 'silver', 'silk'];

/**
 * 一次性完成售出成交：库存扣减、交易记录、货币持有量、账目明细。
 * 先完成全部校验，再以快照方式写入；任一步失败即整体回滚，不留部分写入。
 */
export function applySale(
  state: MarketState,
  request: SaleRequest,
  now: number = Date.now()
): SaleResult {
  const { goodsId, quantity, unitPriceCopper, currency } = request;

  if (!VALID_CURRENCIES.includes(currency)) {
    throw new Error('结算货币无效');
  }
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('成交数量无效');
  }
  if (!Number.isFinite(unitPriceCopper) || unitPriceCopper <= 0) {
    throw new Error('成交价格无效');
  }

  const goods = state.goods.find(item => item.id === goodsId);
  if (!goods) {
    throw new Error('货物不存在');
  }
  if (goods.stock < quantity) {
    throw new Error('库存不足');
  }

  const unitPrice = convertCopperToCurrency(unitPriceCopper, currency);
  const receivedAmount = roundToCurrency(unitPrice * quantity, currency);

  const transaction: Transaction = {
    id: generateId(),
    goodsId: goods.id,
    goodsName: goods.name,
    type: 'sale',
    quantity,
    unitPrice,
    totalAmount: receivedAmount,
    currency,
    timestamp: now,
    traderName: request.traderName,
    traderOrigin: request.traderOrigin
  };

  const snapshot = JSON.stringify(state);
  try {
    goods.stock -= quantity;
    goods.saleRecords.push({
      id: generateId(),
      quantity,
      revenue: unitPriceCopper * quantity,
      timestamp: now,
      traderName: request.traderName,
      traderOrigin: request.traderOrigin
    });
    state.holdings[currency] = state.holdings[currency] + receivedAmount;
    state.transactions.unshift(transaction);
  } catch (error) {
    const backup = JSON.parse(snapshot) as MarketState;
    state.goods.splice(0, state.goods.length, ...backup.goods);
    state.transactions.splice(0, state.transactions.length, ...backup.transactions);
    state.holdings = backup.holdings;
    throw error;
  }

  return {
    transaction,
    goods,
    holdings: state.holdings,
    receivedAmount
  };
}
