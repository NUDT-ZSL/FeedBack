import type { NegotiationOffer } from '../types';

export const MAX_NEGOTIATION_ROUNDS = 3;

export type Rng = () => number;

export interface NegotiationSession {
  listPriceCopper: number;
  round: number;
  maxRounds: number;
  traderOfferCopper: number;
  userOfferCopper: number | null;
  status: 'ongoing' | 'converged' | 'breakdown';
  history: NegotiationOffer[];
}

export function traderInitialOffer(listPriceCopper: number, rng: Rng = Math.random): number {
  const discount = 0.2 + rng() * 0.3;
  return Math.max(1, Math.round(listPriceCopper * (1 - discount)));
}

export function createSession(
  listPriceCopper: number,
  rng: Rng = Math.random,
  maxRounds: number = MAX_NEGOTIATION_ROUNDS
): NegotiationSession {
  const opening = traderInitialOffer(listPriceCopper, rng);
  return {
    listPriceCopper,
    round: 1,
    maxRounds,
    traderOfferCopper: opening,
    userOfferCopper: null,
    status: 'ongoing',
    history: [{ round: 1, party: 'trader', amountCopper: opening }]
  };
}

export function traderCounterOffer(
  traderOfferCopper: number,
  userOfferCopper: number,
  rng: Rng = Math.random
): number {
  const gap = traderOfferCopper - userOfferCopper;
  const concessionRatio = 0.3 + rng() * 0.4;
  const next = Math.round(traderOfferCopper - gap * concessionRatio);
  return Math.max(next, userOfferCopper);
}

export function convergenceThreshold(listPriceCopper: number): number {
  return Math.max(2, Math.round(listPriceCopper * 0.05));
}

export function applyUserCounter(
  session: NegotiationSession,
  userOfferCopper: number,
  rng: Rng = Math.random
): NegotiationSession {
  if (session.status !== 'ongoing') return session;

  const offer = Math.max(1, Math.round(userOfferCopper));
  const history: NegotiationOffer[] = [
    ...session.history,
    { round: session.round, party: 'user', amountCopper: offer }
  ];

  if (offer >= session.traderOfferCopper) {
    return {
      ...session,
      userOfferCopper: offer,
      traderOfferCopper: offer,
      status: 'converged',
      history: [...history, { round: session.round, party: 'trader', amountCopper: offer }]
    };
  }

  if (session.round >= session.maxRounds) {
    return { ...session, userOfferCopper: offer, status: 'breakdown', history };
  }

  const nextRound = session.round + 1;
  const nextTraderOffer = traderCounterOffer(session.traderOfferCopper, offer, rng);
  const threshold = convergenceThreshold(session.listPriceCopper);
  const converged = nextTraderOffer - offer <= threshold;
  const dealOffer = converged ? Math.round((offer + nextTraderOffer) / 2) : nextTraderOffer;

  return {
    ...session,
    round: nextRound,
    userOfferCopper: offer,
    traderOfferCopper: dealOffer,
    status: converged ? 'converged' : 'ongoing',
    history: [
      ...history,
      { round: nextRound, party: 'trader', amountCopper: dealOffer }
    ]
  };
}
