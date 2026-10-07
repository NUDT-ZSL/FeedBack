import { RANDOM_EVENTS, PLAYER_TEMPLATES } from '../types';
import {
  FIELD_WIDTH,
  FIELD_HEIGHT,
  PLAYER_MARGIN,
  BALL_OUT_MARGIN,
  GRAVITY,
  BALL_DRAG,
  BALL_BOUNCE_DAMPING,
  WALL_BOUNCE_DAMPING,
  BALL_STOP_SPEED,
  NET_OFFSET,
  NET_HEIGHT,
  MAX_CHARGE_TIME,
  STAR_DURATION,
  HALF_DURATION,
  HALFTIME_PAUSE,
  TRANSITION_PAUSE,
  EVENT_DURATION,
  ZOOM_DURATION,
  NET_BULGE_DURATION,
  CELEBRATION_DURATION,
  HAZE_DURATION,
  EVENT_INTERVAL_MIN,
  EVENT_INTERVAL_MAX,
  OPPONENT_KICK_CHANCE,
} from './constants';
import { createRng, nextRandom, pickIndex } from './rng';
import { centerBall } from './state';
import type { SimAction, SimState } from './types';

const FOOTPRINT_INTERVAL = 200;
const FOOTPRINT_TTL = 2000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rngOf(state: SimState) {
  return createRng(state.rngState);
}

function commitRng(state: SimState, rng: { state: number }): void {
  state.rngState = rng.state;
}

export function chargePowerAt(clock: number, chargeStartClock: number): number {
  const elapsed = clock - chargeStartClock;
  if (elapsed <= 0) return 0;
  if (elapsed <= MAX_CHARGE_TIME) {
    return (elapsed / MAX_CHARGE_TIME) * 100;
  }
  return Math.max(20, 100 - ((elapsed - MAX_CHARGE_TIME) / MAX_CHARGE_TIME) * 50);
}

export function setKey(state: SimState, key: string, pressed: boolean): SimState {
  const next = structuredClone(state);
  const normalized = key.toLowerCase();
  const keys = new Set(next.keys);
  if (pressed) {
    keys.add(normalized);
  } else {
    keys.delete(normalized);
  }
  next.keys = [...keys];
  return next;
}

export function startCharge(state: SimState): SimState {
  if (state.phase !== 'playing' || state.isTransitioning || state.isCharging) return state;
  const next = structuredClone(state);
  next.isCharging = true;
  next.chargeStartClock = next.clock;
  next.shotPower = 0;
  return next;
}

export function shoot(state: SimState): SimState {
  if (state.phase !== 'playing' || state.isTransitioning) return state;
  const next = structuredClone(state);
  const rng = rngOf(next);

  const power = next.isCharging ? chargePowerAt(next.clock, next.chargeStartClock) : next.shotPower || 30;
  const angle = (next.player.rotation * Math.PI) / 180;
  const speed = 200 + (power / 100) * 300;

  const moraleFactor = next.player.morale / 100;
  const accuracyBonus = moraleFactor > 0.8 ? 0.2 : moraleFactor < 0.3 ? -0.15 : 0;
  const finalAngle = angle + (nextRandom(rng) - 0.5) * (0.3 - accuracyBonus * 0.3);
  commitRng(next, rng);

  next.ball = {
    ...next.ball,
    vx: Math.cos(finalAngle) * speed,
    vy: Math.sin(finalAngle) * speed,
    vz: 150 + (power / 100) * 100,
    isMoving: true,
  };
  next.isCharging = false;
  next.shotPower = 0;
  next.isZooming = true;
  next.zoomEndsAt = next.clock + ZOOM_DURATION;
  next.player = {
    ...next.player,
    stamina: Math.max(0, next.player.stamina - 5),
  };
  return next;
}

export function pass(state: SimState): SimState {
  if (state.phase !== 'playing' || state.isTransitioning) return state;
  const next = structuredClone(state);
  const rng = rngOf(next);

  const dx = next.opponent.x - next.player.x;
  const dy = next.opponent.y - next.player.y;
  const angle = Math.atan2(dy, dx);

  const moraleFactor = next.player.morale / 100;
  const accuracyBonus = moraleFactor > 0.8 ? 0.2 : 0;
  const missChance = moraleFactor < 0.3 ? 0.15 : 0;
  const finalAngle =
    angle + (nextRandom(rng) - 0.5) * (0.2 - accuracyBonus * 0.2 + missChance * 0.3);
  commitRng(next, rng);

  const speed = 150;
  next.ball = {
    ...next.ball,
    vx: Math.cos(finalAngle) * speed,
    vy: Math.sin(finalAngle) * speed,
    vz: 80,
    isMoving: true,
  };
  next.player = {
    ...next.player,
    stamina: Math.max(0, next.player.stamina - 2),
  };
  return next;
}

export function tackle(state: SimState): SimState {
  if (state.phase !== 'playing' || state.isTransitioning) return state;
  const dx = state.ball.x - state.player.x;
  const dy = state.ball.y - state.player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= 50) return state;

  const next = structuredClone(state);
  const angle = Math.atan2(dy, dx);
  const template = PLAYER_TEMPLATES.find((t) => t.id === next.player.id);
  const tacklePower = template?.tacklePower ?? 50;

  next.ball = {
    ...next.ball,
    vx: -Math.cos(angle) * (100 + tacklePower),
    vy: -Math.sin(angle) * (100 + tacklePower),
    vz: 100,
    isMoving: true,
  };
  next.player = {
    ...next.player,
    stamina: Math.max(0, next.player.stamina - 8),
  };
  return next;
}

export function applyAction(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case 'keyDown':
      return setKey(state, action.key, true);
    case 'keyUp':
      return setKey(state, action.key, false);
    case 'startCharge':
      return startCharge(state);
    case 'shoot':
      return shoot(state);
    case 'pass':
      return pass(state);
    case 'tackle':
      return tackle(state);
  }
}

function updatePlayer(state: SimState, dt: number): void {
  const player = state.player;
  const keys = new Set(state.keys);
  const moveSpeed = player.speed * 60 * dt;
  let newX = player.x;
  let newY = player.y;
  let newRotation = player.rotation;
  let isMoving = false;

  if (keys.has('a')) {
    newRotation -= 180 * dt;
    isMoving = true;
  }
  if (keys.has('d')) {
    newRotation += 180 * dt;
    isMoving = true;
  }

  const rad = (newRotation * Math.PI) / 180;
  if (keys.has('w')) {
    newX += Math.cos(rad) * moveSpeed;
    newY += Math.sin(rad) * moveSpeed;
    isMoving = true;
  }
  if (keys.has('s')) {
    newX -= Math.cos(rad) * moveSpeed * 0.5;
    newY -= Math.sin(rad) * moveSpeed * 0.5;
    isMoving = true;
  }

  newX = clamp(newX, PLAYER_MARGIN, FIELD_WIDTH - PLAYER_MARGIN);
  newY = clamp(newY, PLAYER_MARGIN, FIELD_HEIGHT - PLAYER_MARGIN);

  const lastFootprint = state.footprints[state.footprints.length - 1];
  if (isMoving && (!lastFootprint || state.clock - lastFootprint.timestamp > FOOTPRINT_INTERVAL)) {
    state.footprints.push({
      id: Math.round(state.clock),
      x: player.x,
      y: player.y,
      timestamp: state.clock,
    });
  }
  state.footprints = state.footprints.filter((f) => state.clock - f.timestamp < FOOTPRINT_TTL);

  const staminaDrain = isMoving ? player.baseSpeed * dt * 0.5 : 0;
  const newStamina = Math.max(0, player.stamina - staminaDrain);
  const effectiveSpeed = newStamina > 0 ? player.baseSpeed : player.baseSpeed * 0.3;

  state.player = {
    ...player,
    x: newX,
    y: newY,
    rotation: newRotation,
    stamina: newStamina,
    speed: effectiveSpeed,
  };
}

function updateOpponent(state: SimState, dt: number): void {
  const { opponent, ball } = state;
  const opDx = ball.x - opponent.x;
  const opDy = ball.y - opponent.y;
  const opDist = Math.sqrt(opDx * opDx + opDy * opDy);

  if (opDist > 40 && ball.isMoving) {
    const opAngle = Math.atan2(opDy, opDx);
    const opMoveSpeed = opponent.speed * 60 * dt * 0.6;
    state.opponent = {
      ...opponent,
      x: clamp(
        opponent.x + Math.cos(opAngle) * opMoveSpeed,
        FIELD_WIDTH / 2 + PLAYER_MARGIN,
        FIELD_WIDTH - PLAYER_MARGIN
      ),
      y: clamp(opponent.y + Math.sin(opAngle) * opMoveSpeed, PLAYER_MARGIN, FIELD_HEIGHT - PLAYER_MARGIN),
      rotation: (opAngle * 180) / Math.PI,
    };
    return;
  }

  if (opDist < 45 && ball.isMoving) {
    const rng = rngOf(state);
    const roll = nextRandom(rng);
    if (roll < OPPONENT_KICK_CHANCE) {
      const kickAngle = Math.PI + (nextRandom(rng) - 0.5) * 0.5;
      const kickVy = (nextRandom(rng) - 0.5) * 50;
      state.ball = {
        ...ball,
        vx: Math.cos(kickAngle) * 180,
        vy: Math.sin(kickAngle) * 180 + kickVy,
        vz: 120,
      };
    }
    commitRng(state, rng);
  }
}

function updateBall(state: SimState, dt: number): void {
  const ball = state.ball;
  if (!ball.isMoving) return;

  const newZ = ball.z + ball.vz * dt;
  const newBallX = ball.x + ball.vx * dt;
  const newBallY = ball.y + ball.vy * dt;

  let newVz = ball.vz - GRAVITY * dt;
  let newVx = ball.vx * BALL_DRAG;
  let newVy = ball.vy * BALL_DRAG;
  let isBouncing = false;

  const netX = FIELD_WIDTH / 2;
  if (
    Math.abs(newBallX - netX) < NET_OFFSET &&
    newZ < NET_HEIGHT &&
    newZ > 0 &&
    ball.z < NET_HEIGHT
  ) {
    newVx = -newVx * 0.7;
    state.netBulge = ball.vx > 0 ? -10 : 10;
    state.netBulgeEndsAt = state.clock + NET_BULGE_DURATION;
  }

  if (newZ <= 0) {
    newVz = -newVz * BALL_BOUNCE_DAMPING;
    isBouncing = true;
    if (Math.abs(newVz) < 50) {
      newVz = 0;
    }
  }

  let finalX = newBallX;
  let finalY = newBallY;
  let finalZ = Math.max(0, newZ);

  if (finalY < BALL_OUT_MARGIN) {
    finalY = BALL_OUT_MARGIN;
    newVy = -newVy * WALL_BOUNCE_DAMPING;
  } else if (finalY > FIELD_HEIGHT - BALL_OUT_MARGIN) {
    finalY = FIELD_HEIGHT - BALL_OUT_MARGIN;
    newVy = -newVy * WALL_BOUNCE_DAMPING;
  }

  if (finalX >= FIELD_WIDTH - BALL_OUT_MARGIN) {
    state.score = { ...state.score, user: state.score.user + 1 };
    state.goals.push({ side: 'user', clock: state.clock, half: state.currentHalf });
    state.ball = centerBall();
    state.isTransitioning = true;
    state.transitionEndsAt = state.clock + TRANSITION_PAUSE;
    return;
  }
  if (finalX <= BALL_OUT_MARGIN) {
    state.score = { ...state.score, opponent: state.score.opponent + 1 };
    state.goals.push({ side: 'opponent', clock: state.clock, half: state.currentHalf });
    state.ball = centerBall();
    state.isTransitioning = true;
    state.transitionEndsAt = state.clock + TRANSITION_PAUSE;
    return;
  }

  if (finalZ === 0 && newVz === 0) {
    const horizontalSpeed = Math.sqrt(newVx * newVx + newVy * newVy);
    if (horizontalSpeed < BALL_STOP_SPEED) {
      state.ball = {
        ...ball,
        x: finalX,
        y: finalY,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        isMoving: false,
        isBouncing: false,
      };
      return;
    }
  }

  state.ball = {
    ...ball,
    x: finalX,
    y: finalY,
    z: finalZ,
    vx: newVx,
    vy: newVy,
    vz: newVz,
    isMoving: true,
    isBouncing,
  };
}

function updateClockAndPhase(state: SimState, dtMs: number): void {
  if (state.isTransitioning) {
    if (state.clock >= state.transitionEndsAt) {
      state.isTransitioning = false;
    }
    return;
  }

  state.timeRemaining = Math.max(0, state.timeRemaining - dtMs);
  state.stars = Math.max(0, Math.ceil(state.timeRemaining / STAR_DURATION));

  if (state.timeRemaining <= 0) {
    state.phase = 'finished';
    state.result =
      state.score.user > state.score.opponent
        ? 'user'
        : state.score.user < state.score.opponent
          ? 'opponent'
          : 'draw';
    if (state.result === 'user') {
      state.showConfetti = true;
      state.effectEndsAt = state.clock + CELEBRATION_DURATION;
    } else {
      state.showHaze = true;
      state.effectEndsAt = state.clock + HAZE_DURATION;
    }
    return;
  }

  if (state.currentHalf === 'first' && state.timeRemaining <= HALF_DURATION) {
    state.currentHalf = 'second';
    state.phase = 'halftime';
    state.backgroundTime = 'dusk';
    state.isTransitioning = true;
    state.transitionEndsAt = state.clock + HALFTIME_PAUSE;
    state.player = {
      ...state.player,
      x: FIELD_WIDTH * 0.25,
      y: FIELD_HEIGHT / 2,
      rotation: 0,
    };
    state.opponent = {
      ...state.opponent,
      x: FIELD_WIDTH * 0.75,
      y: FIELD_HEIGHT / 2,
      rotation: 180,
    };
    state.ball = centerBall();
    return;
  }
}

function updateEvents(state: SimState): void {
  if (state.currentEvent && state.clock >= state.currentEvent.expiresAt) {
    state.currentEvent = null;
  }

  if (state.phase !== 'playing' || state.isTransitioning) return;
  if (state.clock < state.nextEventAt) return;

  const rng = rngOf(state);
  const template = RANDOM_EVENTS[pickIndex(rng, RANDOM_EVENTS.length)];
  state.nextEventAt = state.clock + EVENT_INTERVAL_MIN + nextRandom(rng) * (EVENT_INTERVAL_MAX - EVENT_INTERVAL_MIN);
  commitRng(state, rng);

  const staminaEffect = template.effect.stamina ?? 0;
  const moraleEffect = template.effect.morale ?? 0;
  state.player = {
    ...state.player,
    stamina: clamp(state.player.stamina + staminaEffect, 0, state.player.maxStamina),
    morale: clamp(state.player.morale + moraleEffect, 0, 100),
  };

  state.currentEvent = {
    ...template,
    id: `evt-${Math.round(state.clock)}`,
    startedAt: state.clock,
    expiresAt: state.clock + EVENT_DURATION,
  };
  state.eventLog.push({
    clock: state.clock,
    type: template.type,
    message: template.message,
  });
}

function updateVisualFlags(state: SimState): void {
  if (state.netBulge !== 0 && state.clock >= state.netBulgeEndsAt) {
    state.netBulge = 0;
  }
  if (state.isZooming && state.clock >= state.zoomEndsAt) {
    state.isZooming = false;
  }
  if ((state.showConfetti || state.showHaze) && state.clock >= state.effectEndsAt) {
    state.showConfetti = false;
    state.showHaze = false;
  }
}

export function step(state: SimState, dt: number): SimState {
  const next = structuredClone(state);
  next.clock += dt * 1000;

  if (next.isCharging) {
    next.shotPower = chargePowerAt(next.clock, next.chargeStartClock);
  }

  if (next.phase === 'halftime') {
    if (next.clock >= next.transitionEndsAt) {
      next.phase = 'playing';
      next.isTransitioning = false;
    }
    updateVisualFlags(next);
    return next;
  }

  if (next.phase === 'playing') {
    updateClockAndPhase(next, dt * 1000);
  }

  if (next.phase === 'playing' && !next.isTransitioning) {
    updatePlayer(next, dt);
    updateOpponent(next, dt);
    updateBall(next, dt);
  }

  updateEvents(next);
  updateVisualFlags(next);
  return next;
}
