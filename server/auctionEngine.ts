import type { AuctionState, BidRecord } from '../shared/types.js';

export const AUCTION_DURATION_MS = 30 * 1000;

export interface AuctionSnapshot {
  itemId: string;
  basePrice: number;
  bids: BidRecord[];
  storedEndTime: string | null;
  storedIsActive: boolean;
  now: number;
}

export interface AuctionDerivation {
  itemId: string;
  endTime: string;
  isActive: boolean;
  winnerId: string | null;
  highestAmount: number;
  winningBid: BidRecord | null;
  bids: BidRecord[];
}

export function sortBidsCanonical(bids: BidRecord[]): BidRecord[] {
  return [...bids].sort((left, right) => {
    const byTimestamp = right.timestamp.localeCompare(left.timestamp);
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function deriveHighestAmount(basePrice: number, bids: BidRecord[]): number {
  let highest = Math.max(basePrice, 0);
  for (const bid of bids) {
    if (bid.amount > highest) highest = bid.amount;
  }
  return highest;
}

export function selectWinningBid(bids: BidRecord[]): BidRecord | null {
  let winner: BidRecord | null = null;
  for (const bid of bids) {
    if (winner === null) {
      winner = bid;
      continue;
    }
    if (bid.amount > winner.amount) {
      winner = bid;
    } else if (bid.amount === winner.amount) {
      const timestampCompare = bid.timestamp.localeCompare(winner.timestamp);
      if (timestampCompare < 0 || (timestampCompare === 0 && bid.id < winner.id)) {
        winner = bid;
      }
    }
  }
  return winner;
}

export function deriveEndTime(
  storedEndTime: string | null,
  bids: BidRecord[],
  now: number
): string {
  let endMs = storedEndTime ? Date.parse(storedEndTime) : now + AUCTION_DURATION_MS;
  for (const bid of bids) {
    const extendedEndMs = Date.parse(bid.timestamp) + AUCTION_DURATION_MS;
    if (extendedEndMs > endMs) endMs = extendedEndMs;
  }
  return new Date(endMs).toISOString();
}

export function deriveAuction(snapshot: AuctionSnapshot): AuctionDerivation {
  const bids = sortBidsCanonical(snapshot.bids);
  const highestAmount = deriveHighestAmount(snapshot.basePrice, bids);
  const endTime = deriveEndTime(snapshot.storedEndTime, bids, snapshot.now);
  const isActive = snapshot.storedIsActive && snapshot.now < Date.parse(endTime);
  const winningBid = selectWinningBid(bids);
  const winnerId = !isActive && winningBid !== null ? winningBid.userId : null;

  return {
    itemId: snapshot.itemId,
    endTime,
    isActive,
    winnerId,
    highestAmount,
    winningBid,
    bids
  };
}

export function toAuctionState(derivation: AuctionDerivation): AuctionState {
  return {
    itemId: derivation.itemId,
    endTime: derivation.endTime,
    isActive: derivation.isActive,
    winnerId: derivation.winnerId,
    bids: derivation.bids
  };
}

export function validateBidAmount(
  derivation: AuctionDerivation,
  amount: number
): { accepted: boolean; currentHighest: number } {
  return {
    accepted: amount > derivation.highestAmount,
    currentHighest: derivation.highestAmount
  };
}
