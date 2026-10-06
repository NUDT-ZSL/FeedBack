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

export type NegotiationStatus = 'ongoing' | 'deal' | 'breakdown';

export interface NegotiationOffer {
  round: number;
  traderOffer: number;
  userOffer?: number;
}

export interface NegotiationState {
  trader: ForeignTrader;
  goods: Goods;
  /** 番客当前报价（统一以铜钱文计价） */
  currentOffer: number;
  round: number;
  maxRounds: number;
  /** 番客心理底价（铜钱文），触及后无法继续让步 */
  floorPrice: number;
  /** 我方最近一次还价（铜钱文） */
  userCounterOffer?: number;
  status: NegotiationStatus;
  offerHistory: NegotiationOffer[];
  /** 谈崩原因 */
  breakdownReason?: string;
  /** 达成一致时的成交价（铜钱文） */
  agreedPrice?: number;
}

export interface SaleRequest {
  goodsId: string;
  quantity: number;
  /** 成交价（铜钱文），入账时按所选结算货币换算 */
  unitPriceCopper: number;
  currency: Currency;
  traderName?: string;
  traderOrigin?: string;
}

export interface DailyStats {
  date: string;
  totalSales: number;
  totalPurchases: number;
  profit: number;
  transactions: Transaction[];
}
