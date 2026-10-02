export interface Goods {
  id: string;
  name: string;
  emoji: string;
  stock: number;
  defaultStock: number;
  price: number;
  purchaseRecords: PurchaseRecord[];
  saleRecords: SaleRecord[];
}

export interface PurchaseRecord {
  id: string;
  quantity: number;
  cost: number;
  timestamp: number;
}

export interface SaleRecord {
  id: string;
  quantity: number;
  revenue: number;
  timestamp: number;
  traderName?: string;
  traderOrigin?: string;
}

export type TransactionType = 'purchase' | 'sale' | 'exchange';
export type Currency = 'copper' | 'silver' | 'silk';

export interface Transaction {
  id: string;
  goodsId: string;
  goodsName: string;
  type: TransactionType;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: Currency;
  timestamp: number;
  traderName?: string;
  traderOrigin?: string;
  exchangeFrom?: Currency;
  exchangeTo?: Currency;
  exchangeAmount?: number;
}

export interface ExchangeRate {
  copper: number;
  silver: number;
  silk: number;
}

export interface CurrencyHoldings {
  copper: number;
  silver: number;
  silk: number;
}

export interface ForeignTrader {
  id: string;
  name: string;
  origin: string;
  skinColor: string;
  clothingColor: string;
}

export interface NegotiationState {
  trader: ForeignTrader;
  goods: Goods;
  currentOffer: number;
  round: number;
  userCounterOffer?: number;
}

export interface DailyStats {
  date: string;
  totalSales: number;
  totalPurchases: number;
  profit: number;
  transactions: Transaction[];
}
