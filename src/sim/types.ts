import type { Ball, GameEvent, GamePhase, Half, BackgroundTime } from '../types';

export interface SimPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  speed: number;
  baseSpeed: number;
  stamina: number;
  maxStamina: number;
  morale: number;
  isUser: boolean;
  color: string;
  height: number;
}

export interface ActiveEvent extends GameEvent {
  id: string;
  startedAt: number;
  expiresAt: number;
}

export interface GoalRecord {
  side: 'user' | 'opponent';
  clock: number;
  half: Half;
}

export type MatchResult = 'user' | 'opponent' | 'draw' | null;

export interface SimState {
  seed: number;
  rngState: number;
  clock: number;
  phase: GamePhase;
  currentHalf: Half;
  score: { user: number; opponent: number };
  timeRemaining: number;
  stars: number;
  player: SimPlayer;
  opponent: SimPlayer;
  ball: Ball;
  keys: string[];
  currentEvent: ActiveEvent | null;
  eventLog: { clock: number; type: GameEvent['type']; message: string }[];
  goals: GoalRecord[];
  shotPower: number;
  isCharging: boolean;
  chargeStartClock: number;
  backgroundTime: BackgroundTime;
  isTransitioning: boolean;
  transitionEndsAt: number;
  nextEventAt: number;
  footprints: { id: number; x: number; y: number; timestamp: number }[];
  netBulge: number;
  netBulgeEndsAt: number;
  isZooming: boolean;
  zoomEndsAt: number;
  showConfetti: boolean;
  showHaze: boolean;
  effectEndsAt: number;
  result: MatchResult;
}

export type SimAction =
  | { type: 'keyDown'; key: string }
  | { type: 'keyUp'; key: string }
  | { type: 'startCharge' }
  | { type: 'shoot' }
  | { type: 'pass' }
  | { type: 'tackle' };
