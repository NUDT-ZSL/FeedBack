import type { ForeignTrader, Goods, NegotiationState } from '../types';

/** 最大议价轮次（与交易面板展示的“最多3轮”保持一致） */
export const MAX_NEGOTIATION_ROUNDS = 3;

/** 双方报价差距小于该比例时视为收敛，番客直接接受我方还价 */
export const DEAL_TOLERANCE_RATIO = 0.03;

/** 番客底价 = 标价 × 该比例，触及底价后不再让步 */
export const FLOOR_PRICE_RATIO = 0.55;

/** 可注入的随机源，便于离线验证时复现结果 */
export type RandomSource = () => number;

export type CounterOutcome = 'ongoing' | 'deal' | 'breakdown';

export interface CounterResult {
  state: NegotiationState;
  outcome: CounterOutcome;
  /** outcome 为 deal 时的成交价（铜钱文） */
  agreedPrice?: number;
}

/**
 * 发起一轮新的议价：番客在标价的 50%~80% 之间开出第一口价。
 */
export function createNegotiation(
  goods: Goods,
  trader: ForeignTrader,
  random: RandomSource = Math.random
): NegotiationState {
  const discount = 0.2 + random() * 0.3;
  const initialOffer = Math.max(1, Math.round(goods.price * (1 - discount)));
  const floorPrice = Math.max(1, Math.round(goods.price * FLOOR_PRICE_RATIO));
  return {
    trader,
    goods,
    currentOffer: initialOffer,
    round: 1,
    maxRounds: MAX_NEGOTIATION_ROUNDS,
    floorPrice,
    status: 'ongoing',
    offerHistory: [{ round: 1, traderOffer: initialOffer }]
  };
}

function breakdown(state: NegotiationState, reason: string): CounterResult {
  return {
    state: { ...state, status: 'breakdown', breakdownReason: reason },
    outcome: 'breakdown'
  };
}

function deal(state: NegotiationState, agreedPrice: number, userOffer: number): CounterResult {
  const history = state.offerHistory.map(h => ({ ...h }));
  history[history.length - 1] = { ...history[history.length - 1], userOffer };
  return {
    state: { ...state, status: 'deal', agreedPrice, userCounterOffer: userOffer, offerHistory: history },
    outcome: 'deal',
    agreedPrice
  };
}

/**
 * 我方还价后，番客基于“双方最新出价”给出新一轮报价：
 * - 我方出价达到或超过番客报价 → 成交；
 * - 双方差距在容忍范围内 → 番客接受我方还价，成交；
 * - 否则番客按差距的一定比例让步，报出介于双方出价之间的新价；
 * - 让步触及底价仍无法弥合差距，或超出轮次上限 → 谈崩。
 *
 * 所有金额均以铜钱文计价，结算货币只在展示与入账时换算一次。
 */
export function applyCounterOffer(
  state: NegotiationState,
  userOffer: number,
  random: RandomSource = Math.random
): CounterResult {
  if (state.status !== 'ongoing') {
    return { state, outcome: state.status === 'deal' ? 'deal' : 'breakdown', agreedPrice: state.agreedPrice };
  }

  const offer = Math.round(userOffer);
  if (!Number.isFinite(offer) || offer <= 0) {
    return breakdown(state, '还价无效，番客拂袖而去');
  }

  if (state.round >= state.maxRounds) {
    return breakdown(state, `已讨价还价${state.maxRounds}轮，番客失去耐心`);
  }

  const traderOffer = state.currentOffer;

  if (offer >= traderOffer) {
    return deal(state, offer, offer);
  }

  const gap = traderOffer - offer;
  const tolerance = Math.max(1, Math.round(traderOffer * DEAL_TOLERANCE_RATIO));
  if (gap <= tolerance) {
    return deal(state, offer, offer);
  }

  // 番客让步：以双方出价的差距为基础让步 30%~60%，保证逐步收敛
  const concessionRate = 0.3 + random() * 0.3;
  let nextOffer = Math.round(traderOffer - gap * concessionRate);
  nextOffer = Math.min(nextOffer, traderOffer - 1);
  nextOffer = Math.max(nextOffer, state.floorPrice);

  if (nextOffer <= offer) {
    return deal(state, offer, offer);
  }

  if (nextOffer >= traderOffer) {
    return breakdown(state, '番客已退到底价，双方报价无法收敛');
  }

  const round = state.round + 1;
  const history = state.offerHistory.map(h => ({ ...h }));
  history[history.length - 1] = { ...history[history.length - 1], userOffer: offer };
  history.push({ round, traderOffer: nextOffer });

  return {
    state: {
      ...state,
      currentOffer: nextOffer,
      round,
      userCounterOffer: offer,
      offerHistory: history
    },
    outcome: 'ongoing'
  };
}
