import type { PitchResult } from './gameLogic';
import { TITLE_THRESHOLDS } from './gameLogic';

export type GuestStyle = 'lively' | 'steady' | 'conservative';
export type GuestFavored = 'hit' | 'ear';
export type GuestReactionType =
  | 'idle'
  | 'cheer'
  | 'watch'
  | 'shake'
  | 'laugh'
  | 'nervous';

export interface GuestSeat {
  id: number;
  seatIndex: number;
  color: string;
  style: GuestStyle;
  favored: GuestFavored;
}

export interface GuestReaction {
  type: GuestReactionType;
  intensity: number;
}

export interface ReactionContext {
  result: PitchResult;
  consecutiveSuccesses: number;
  totalScore: number;
  pitchesRemaining: number;
  maxPitches: number;
}

export const GUEST_COUNT = 6;

export const GUEST_COLORS = [
  '#c0392b',
  '#3a6b8d',
  '#ffd700',
  '#8e44ad',
  '#d4938b',
  '#27ae60',
];

export const REACTION_DURATION_MS = 1600;

/**
 * 确定性的伪随机数生成器（mulberry32）。
 * 同一 seed 始终产生同一序列，供席次与偏好分配复现使用。
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 由局种子派生分配种子，保证同一局种子下席次与偏好完全一致。
 */
export function deriveSeed(gameSeed: number): number {
  return (Math.imul(gameSeed, 0x9e3779b1) ^ 0x5bf03635) >>> 0;
}

/**
 * 每局开始前为宾客重新分配席次与偏好。
 * 结果只取决于 gameSeed，可复现、便于回看对局。
 */
export function assignGuestSeats(gameSeed: number): GuestSeat[] {
  const rng = createRng(deriveSeed(gameSeed));
  const colors = shuffle(GUEST_COLORS, rng);

  const favoredPool: GuestFavored[] = [
    'hit',
    'hit',
    'hit',
    'ear',
    'ear',
    'ear',
  ];
  const stylePool: GuestStyle[] = [
    'lively',
    'lively',
    'steady',
    'steady',
    'conservative',
    'conservative',
  ];

  const favored = shuffle(favoredPool, rng);
  const styles = shuffle(stylePool, rng);

  return colors.map((color, index) => ({
    id: index,
    seatIndex: index,
    color,
    style: styles[index],
    favored: favored[index],
  }));
}

/**
 * 当前积分到下一称号门槛的差距；已是最高称号时返回 null。
 */
export function nextTitleGap(totalScore: number): number | null {
  const gap = TITLE_THRESHOLDS.find((threshold) => totalScore < threshold);
  return gap === undefined ? null : gap - totalScore;
}

/**
 * 剩余次数不多且积分接近某个称号门槛时，局势才有紧张感。
 * 差距在剩余投数可追平的范围内（10 分/投），紧张程度 0..1。
 */
export function evaluateTension(
  totalScore: number,
  pitchesRemaining: number
): number {
  if (pitchesRemaining <= 0) return 0;
  if (pitchesRemaining > 3) return 0;

  const gap = nextTitleGap(totalScore);
  if (gap === null) return 0;
  if (gap > pitchesRemaining * 10) return 0;

  const reachability = 1 - gap / (pitchesRemaining * 10);
  const urgency = (3 - pitchesRemaining) / 2;
  return Math.min(1, 0.45 + reachability * 0.35 + urgency * 0.2);
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * 单次投掷结算后，单个宾客在该时刻唯一的反应状态。
 * 同一输入 + 同一宾客配置始终得到同一结果；调用方负责在新结果
 * 到来时整体替换旧反应（见 store 的 settlePitch / clearReactions），
 * 因此反应切换可随时被打断，不会出现叠加或残留。
 */
export function resolveGuestReaction(
  guest: GuestSeat,
  context: ReactionContext
): GuestReaction {
  const tension = evaluateTension(
    context.totalScore,
    context.pitchesRemaining
  );
  const favored = guest.favored === context.result;

  if (context.result === 'hit' || context.result === 'ear') {
    if (favored) {
      if (guest.style === 'lively') {
        return {
          type: 'cheer',
          intensity: clamp01(
            0.65 + 0.15 * (context.consecutiveSuccesses - 1) - tension * 0.2
          ),
        };
      }
      if (guest.style === 'conservative') {
        return {
          type: 'cheer',
          intensity: clamp01(
            0.85 - 0.2 * (context.consecutiveSuccesses - 1) - tension * 0.2
          ),
        };
      }
      return {
        type: 'cheer',
        intensity: clamp01(0.7 - tension * 0.15),
      };
    }

    if (tension > 0) {
      return { type: 'nervous', intensity: clamp01(tension) };
    }
    return guest.style === 'conservative'
      ? { type: 'shake', intensity: 0.5 }
      : { type: 'watch', intensity: 0.45 };
  }

  if (tension > 0) {
    return { type: 'nervous', intensity: clamp01(tension) };
  }
  return guest.style === 'lively'
    ? { type: 'laugh', intensity: 0.6 }
    : { type: 'shake', intensity: 0.55 };
}

/**
 * 一次投掷的全体宾客反应；保证每位宾客同一时刻只有一种反应。
 */
export function resolveRoundReactions(
  guests: GuestSeat[],
  context: ReactionContext
): GuestReaction[] {
  return guests.map((guest) => resolveGuestReaction(guest, context));
}

export function createIdleReaction(): GuestReaction {
  return { type: 'idle', intensity: 0 };
}
