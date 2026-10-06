import type { PitchResult } from './gameLogic.ts';

export const GUEST_COUNT = 6;
export const REACTION_DURATION_MS = 900;
export const TENSION_REMAINING_MAX = 2;
export const TENSION_GAP_MAX = 10;

export type ReactionCategory = 'idle' | 'cheer' | 'shake' | 'laugh' | 'watch' | 'tense';

export interface GuestReaction {
  category: ReactionCategory;
  intensity: number;
}

export type GuestTemperament = 'lively' | 'steady';

export interface GuestSeat {
  id: number;
  seatIndex: number;
  color: string;
  favors: PitchResult;
  temperament: GuestTemperament;
}

export interface ReactionRequest {
  result: PitchResult;
  totalScore: number;
  pitchesRemaining: number;
  pitchHistory: readonly { result: PitchResult }[];
}

export const GUEST_COLORS = [
  '#c0392b',
  '#3a6b8d',
  '#ffd700',
  '#8e44ad',
  '#d4938b',
  '#27ae60',
];

const FAVOR_POOL: PitchResult[] = ['hit', 'hit', 'hit', 'ear', 'miss', 'miss'];
const TEMPERAMENT_POOL: GuestTemperament[] = ['lively', 'lively', 'lively', 'steady', 'steady', 'steady'];

export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function shuffled<T>(pool: readonly T[], random: () => number): T[] {
  const result = [...pool];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function assignGuestSeats(seed: number): GuestSeat[] {
  const random = createSeededRandom(seed);
  const colors = shuffled(GUEST_COLORS, random);
  const favors = shuffled(FAVOR_POOL, random);
  const temperaments = shuffled(TEMPERAMENT_POOL, random);
  return colors.map((color, seatIndex) => ({
    id: seatIndex,
    seatIndex,
    color,
    favors: favors[seatIndex],
    temperament: temperaments[seatIndex],
  }));
}

export function analyzeStreaks(
  history: readonly { result: PitchResult }[],
): { hitStreak: number; missStreak: number } {
  let hitStreak = 0;
  let missStreak = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const result = history[i].result;
    if (result === 'hit') {
      if (missStreak > 0) break;
      hitStreak += 1;
    } else if (result === 'miss') {
      if (hitStreak > 0) break;
      missStreak += 1;
    } else {
      break;
    }
  }
  return { hitStreak, missStreak };
}

export function isTitleTense(totalScore: number, pitchesRemaining: number): boolean {
  if (pitchesRemaining <= 0 || pitchesRemaining > TENSION_REMAINING_MAX) return false;
  return [50, 80].some((threshold) => {
    const gap = threshold - totalScore;
    return gap > 0 && gap <= TENSION_GAP_MAX;
  });
}

export function idleReaction(): GuestReaction {
  return { category: 'idle', intensity: 0 };
}

export function decideGuestReaction(guest: GuestSeat, request: ReactionRequest): GuestReaction {
  const { result, totalScore, pitchesRemaining, pitchHistory } = request;
  const { hitStreak, missStreak } = analyzeStreaks(pitchHistory);
  const tense = isTitleTense(totalScore, pitchesRemaining);
  const favored = guest.favors === result;
  const lively = guest.temperament === 'lively';

  if (favored) {
    if (result === 'miss') {
      const intensity = Math.min(3, 1 + missStreak);
      return { category: 'laugh', intensity };
    }
    const base = result === 'hit' ? 2 : 1;
    const trend = lively ? hitStreak - 1 : 1 - hitStreak;
    let intensity = base + trend + (tense ? 1 : 0);
    intensity = Math.max(1, Math.min(3, intensity));
    return { category: 'cheer', intensity };
  }

  if (tense) {
    return { category: 'tense', intensity: lively ? 2 : 1 };
  }

  if (result === 'miss') {
    return lively ? { category: 'shake', intensity: 1 } : { category: 'watch', intensity: 1 };
  }

  return lively ? { category: 'shake', intensity: 1 } : { category: 'watch', intensity: 1 };
}

export function decideAllGuestReactions(
  guests: readonly GuestSeat[],
  request: ReactionRequest,
): Record<number, GuestReaction> {
  const reactions: Record<number, GuestReaction> = {};
  for (const guest of guests) {
    reactions[guest.id] = decideGuestReaction(guest, request);
  }
  return reactions;
}
