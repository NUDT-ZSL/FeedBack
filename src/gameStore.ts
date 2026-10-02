import { create } from 'zustand';
import type {
  Player,
  Ball,
  GameEvent,
  GamePhase,
  Half,
  BackgroundTime,
  PlayerTemplate,
  Footprint,
  Confetti,
} from './types';
import { PLAYER_TEMPLATES, RANDOM_EVENTS } from './types';

const FIELD_WIDTH = 800;
const FIELD_HEIGHT = 500;
const GRAVITY = 500;
const MAX_CHARGE_TIME = 1500;
const STAR_DURATION = 30000;

interface GameState {
  phase: GamePhase;
  currentHalf: Half;
  score: { user: number; opponent: number };
  timeRemaining: number;
  stars: number;
  player: Player;
  opponent: Player;
  ball: Ball;
  currentEvent: GameEvent | null;
  shotPower: number;
  isCharging: boolean;
  chargeStartTime: number;
  backgroundTime: BackgroundTime;
  isTransitioning: boolean;
  footprints: Footprint[];
  confetti: Confetti[];
  showConfetti: boolean;
  showHaze: boolean;
  netBulge: number;
  isZooming: boolean;
  selectedTemplate: PlayerTemplate | null;
  keys: Set<string>;
  lastFootprintTime: number;
  nextEventTime: number;

  selectPlayer: (templateId: string) => void;
  startGame: () => void;
  setKey: (key: string, pressed: boolean) => void;
  startCharge: () => void;
  updateCharge: () => void;
  shoot: () => void;
  pass: () => void;
  tackle: () => void;
  update: (deltaTime: number) => void;
  triggerRandomEvent: () => void;
  resetGame: () => void;
  addFootprint: (x: number, y: number) => void;
  generateConfetti: () => void;
}

const createOpponent = (): Player => {
  const heights = [75, 80, 85];
  const randomHeight = heights[Math.floor(Math.random() * heights.length)];
  return {
    id: 'opponent',
    name: '禁军军士',
    x: FIELD_WIDTH * 0.75,
    y: FIELD_HEIGHT / 2,
    rotation: 180,
    speed: 2.5 + Math.random(),
    stamina: 100,
    maxStamina: 100,
    morale: 50,
    isUser: false,
    color: '#27ae60',
    height: randomHeight,
  };
};

const initialBall: Ball = {
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

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'select',
  currentHalf: 'first',
  score: { user: 0, opponent: 0 },
  timeRemaining: STAR_DURATION * 3,
  stars: 3,
  player: {} as Player,
  opponent: createOpponent(),
  ball: initialBall,
  currentEvent: null,
  shotPower: 0,
  isCharging: false,
  chargeStartTime: 0,
  backgroundTime: 'day',
  isTransitioning: false,
  footprints: [],
  confetti: [],
  showConfetti: false,
  showHaze: false,
  netBulge: 0,
  isZooming: false,
  selectedTemplate: null,
  keys: new Set(),
  lastFootprintTime: 0,
  nextEventTime: 10000 + Math.random() * 15000,

  selectPlayer: (templateId: string) => {
    const template = PLAYER_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    const player: Player = {
      id: template.id,
      name: template.name,
      x: FIELD_WIDTH * 0.25,
      y: FIELD_HEIGHT / 2,
      rotation: 0,
      speed: template.speed,
      stamina: template.maxStamina,
      maxStamina: template.maxStamina,
      morale: 50,
      isUser: true,
      color: '#c0392b',
      height: 80,
    };

    set({ selectedTemplate: template, player, opponent: createOpponent() });
  },

  startGame: () => {
    const { selectedTemplate } = get();
    if (!selectedTemplate) return;

    const player: Player = {
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      x: FIELD_WIDTH * 0.25,
      y: FIELD_HEIGHT / 2,
      rotation: 0,
      speed: selectedTemplate.speed,
      stamina: selectedTemplate.maxStamina,
      maxStamina: selectedTemplate.maxStamina,
      morale: 50,
      isUser: true,
      color: '#c0392b',
      height: 80,
    };

    set({
      phase: 'playing',
      currentHalf: 'first',
      score: { user: 0, opponent: 0 },
      timeRemaining: STAR_DURATION * 3,
      stars: 3,
      player,
      opponent: createOpponent(),
      ball: { ...initialBall, x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 },
      backgroundTime: 'day',
      footprints: [],
      confetti: [],
      showConfetti: false,
      showHaze: false,
      nextEventTime: 10000 + Math.random() * 15000,
    });
  },

  setKey: (key: string, pressed: boolean) => {
    set((state) => {
      const newKeys = new Set(state.keys);
      if (pressed) {
        newKeys.add(key.toLowerCase());
      } else {
        newKeys.delete(key.toLowerCase());
      }
      return { keys: newKeys };
    });
  },

  startCharge: () => {
    if (get().phase !== 'playing') return;
    set({ isCharging: true, chargeStartTime: performance.now(), shotPower: 0 });
  },

  updateCharge: () => {
    const { isCharging, chargeStartTime } = get();
    if (!isCharging) return;

    const elapsed = performance.now() - chargeStartTime;
    let power: number;

    if (elapsed <= MAX_CHARGE_TIME) {
      power = (elapsed / MAX_CHARGE_TIME) * 100;
    } else {
      power = 100 - ((elapsed - MAX_CHARGE_TIME) / MAX_CHARGE_TIME) * 50;
      power = Math.max(power, 20);
    }

    set({ shotPower: power });
  },

  shoot: () => {
    const state = get();
    if (state.phase !== 'playing') return;

    const power = state.shotPower || 30;
    const angle = (state.player.rotation * Math.PI) / 180;
    const speed = 200 + (power / 100) * 300;

    const moraleFactor = state.player.morale / 100;
    const accuracyBonus = moraleFactor > 0.8 ? 0.2 : moraleFactor < 0.3 ? -0.15 : 0;
    const finalAngle = angle + (Math.random() - 0.5) * (0.3 - accuracyBonus * 0.3);

    set({
      ball: {
        ...state.ball,
        vx: Math.cos(finalAngle) * speed,
        vy: Math.sin(finalAngle) * speed,
        vz: 150 + (power / 100) * 100,
        isMoving: true,
      },
      isCharging: false,
      shotPower: 0,
      isZooming: true,
      player: {
        ...state.player,
        stamina: Math.max(0, state.player.stamina - 5),
      },
    });

    setTimeout(() => set({ isZooming: false }), 300);
  },

  pass: () => {
    const state = get();
    if (state.phase !== 'playing') return;

    const dx = state.opponent.x - state.player.x;
    const dy = state.opponent.y - state.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    const moraleFactor = state.player.morale / 100;
    const accuracyBonus = moraleFactor > 0.8 ? 0.2 : 0;
    const missChance = moraleFactor < 0.3 ? 0.15 : 0;
    const finalAngle = angle + (Math.random() - 0.5) * (0.2 - accuracyBonus * 0.2 + missChance * 0.3);

    const speed = 150;

    set({
      ball: {
        ...state.ball,
        vx: Math.cos(finalAngle) * speed,
        vy: Math.sin(finalAngle) * speed,
        vz: 80,
        isMoving: true,
      },
      player: {
        ...state.player,
        stamina: Math.max(0, state.player.stamina - 2),
      },
    });
  },

  tackle: () => {
    const state = get();
    if (state.phase !== 'playing') return;

    const dx = state.ball.x - state.player.x;
    const dy = state.ball.y - state.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 50) {
      const angle = Math.atan2(dy, dx);
      const template = PLAYER_TEMPLATES.find((t) => t.id === state.player.id);
      const tacklePower = template?.tacklePower || 50;

      set({
        ball: {
          ...state.ball,
          vx: -Math.cos(angle) * (100 + tacklePower),
          vy: -Math.sin(angle) * (100 + tacklePower),
          vz: 100,
          isMoving: true,
        },
        player: {
          ...state.player,
          stamina: Math.max(0, state.player.stamina - 8),
        },
      });
    }
  },

  update: (deltaTime: number) => {
    const state = get();
    if (state.phase !== 'playing' || state.isTransitioning) return;

    let { player, opponent, ball, timeRemaining, stars, score, nextEventTime } = state;
    const newFootprints = [...state.footprints];
    let netBulge = state.netBulge;

    const moveSpeed = player.speed * 60 * deltaTime;
    let newX = player.x;
    let newY = player.y;
    let newRotation = player.rotation;
    let isMoving = false;

    if (state.keys.has('a')) {
      newRotation -= 180 * deltaTime;
      isMoving = true;
    }
    if (state.keys.has('d')) {
      newRotation += 180 * deltaTime;
      isMoving = true;
    }

    const rad = (newRotation * Math.PI) / 180;
    if (state.keys.has('w')) {
      newX += Math.cos(rad) * moveSpeed;
      newY += Math.sin(rad) * moveSpeed;
      isMoving = true;
    }
    if (state.keys.has('s')) {
      newX -= Math.cos(rad) * moveSpeed * 0.5;
      newY -= Math.sin(rad) * moveSpeed * 0.5;
      isMoving = true;
    }

    newX = Math.max(30, Math.min(FIELD_WIDTH - 30, newX));
    newY = Math.max(30, Math.min(FIELD_HEIGHT - 30, newY));

    const now = performance.now();
    if (isMoving && now - state.lastFootprintTime > 200) {
      newFootprints.push({
        id: now,
        x: player.x,
        y: player.y,
        timestamp: now,
      });
    }

    const filteredFootprints = newFootprints.filter(
      (f) => now - f.timestamp < 2000
    );

    const staminaDrain = isMoving ? player.speed * deltaTime * 0.5 : 0;
    const newStamina = Math.max(0, player.stamina - staminaDrain);

    const effectiveSpeed = newStamina > 0 ? player.speed : player.speed * 0.3;

    player = {
      ...player,
      x: newX,
      y: newY,
      rotation: newRotation,
      stamina: newStamina,
      speed: effectiveSpeed,
    };

    const opDx = ball.x - opponent.x;
    const opDy = ball.y - opponent.y;
    const opDist = Math.sqrt(opDx * opDx + opDy * opDy);

    if (opDist > 40 && ball.isMoving) {
      const opAngle = Math.atan2(opDy, opDx);
      const opMoveSpeed = opponent.speed * 60 * deltaTime * 0.6;
      opponent = {
        ...opponent,
        x: Math.max(FIELD_WIDTH / 2 + 30, Math.min(FIELD_WIDTH - 30, opponent.x + Math.cos(opAngle) * opMoveSpeed)),
        y: Math.max(30, Math.min(FIELD_HEIGHT - 30, opponent.y + Math.sin(opAngle) * opMoveSpeed)),
        rotation: (opAngle * 180) / Math.PI,
      };
    } else if (opDist < 45 && ball.isMoving && Math.random() < 0.02) {
      const kickAngle = Math.PI + (Math.random() - 0.5) * 0.5;
      ball = {
        ...ball,
        vx: Math.cos(kickAngle) * 180,
        vy: Math.sin(kickAngle) * 180 + (Math.random() - 0.5) * 50,
        vz: 120,
      };
    }

    if (ball.isMoving) {
      const newZ = ball.z + ball.vz * deltaTime;
      const newBallX = ball.x + ball.vx * deltaTime;
      const newBallY = ball.y + ball.vy * deltaTime;

      let newVz = ball.vz - GRAVITY * deltaTime;
      let newVx = ball.vx * 0.99;
      let newVy = ball.vy * 0.99;
      let isBouncing = false;

      const netX = FIELD_WIDTH / 2;
      const netHeight = 80;

      if (
        Math.abs(newBallX - netX) < 10 &&
        newZ < netHeight &&
        newZ > 0 &&
        ball.z < netHeight
      ) {
        newVx = -newVx * 0.7;
        netBulge = ball.vx > 0 ? -10 : 10;
        setTimeout(() => set({ netBulge: 0 }), 200);
      }

      if (newZ <= 0) {
        newVz = -newVz * 0.6;
