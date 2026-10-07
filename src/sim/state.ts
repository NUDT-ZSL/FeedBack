import type { Ball } from '../types';
import { PLAYER_TEMPLATES } from '../types';
import {
  FIELD_WIDTH,
  FIELD_HEIGHT,
  TOTAL_DURATION,
  EVENT_INTERVAL_MIN,
  EVENT_INTERVAL_MAX,
} from './constants';
import { createRng, nextRandom, randomRange, pickIndex } from './rng';
import type { SimPlayer, SimState } from './types';

export function centerBall(): Ball {
  return {
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rotation: 0,
    isMoving: false,
    isBouncing: false,
  };
}

export function createOpponent(rngState: number): { opponent: SimPlayer; rngState: number } {
  const rng = createRng(rngState);
  const heights = [75, 80, 85];
  const height = heights[pickIndex(rng, heights.length)];
  const speed = 2.5 + nextRandom(rng);
  return {
    opponent: {
      id: 'opponent',
      name: '禁军军士',
      x: FIELD_WIDTH * 0.75,
      y: FIELD_HEIGHT / 2,
      rotation: 180,
      speed,
      baseSpeed: speed,
      stamina: 100,
      maxStamina: 100,
      morale: 50,
      isUser: false,
      color: '#27ae60',
      height,
    },
    rngState: rng.state,
  };
}

export function createPlayerFromTemplate(templateId: string): SimPlayer {
  const template = PLAYER_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`unknown player template: ${templateId}`);
  }
  return {
    id: template.id,
    name: template.name,
    x: FIELD_WIDTH * 0.25,
    y: FIELD_HEIGHT / 2,
    rotation: 0,
    speed: template.speed,
    baseSpeed: template.speed,
    stamina: template.maxStamina,
    maxStamina: template.maxStamina,
    morale: 50,
    isUser: true,
    color: '#c0392b',
    height: 80,
  };
}

export function createMatch(seed: number, templateId: string): SimState {
  const rng = createRng(seed);
  const { opponent, rngState } = createOpponent(rng.state);
  const rng2 = createRng(rngState);
  const nextEventAt = randomRange(rng2, EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
  return {
    seed,
    rngState: rng2.state,
    clock: 0,
    phase: 'playing',
    currentHalf: 'first',
    score: { user: 0, opponent: 0 },
    timeRemaining: TOTAL_DURATION,
    stars: 3,
    player: createPlayerFromTemplate(templateId),
    opponent,
    ball: centerBall(),
    keys: [],
    currentEvent: null,
    eventLog: [],
    goals: [],
    shotPower: 0,
    isCharging: false,
    chargeStartClock: 0,
    backgroundTime: 'day',
    isTransitioning: false,
    transitionEndsAt: 0,
    nextEventAt,
    footprints: [],
    netBulge: 0,
    netBulgeEndsAt: 0,
    isZooming: false,
    zoomEndsAt: 0,
    showConfetti: false,
    showHaze: false,
    effectEndsAt: 0,
    result: null,
  };
}
