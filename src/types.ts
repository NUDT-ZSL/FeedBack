export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  speed: number;
  stamina: number;
  maxStamina: number;
  morale: number;
  isUser: boolean;
  color: string;
  height: number;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotation: number;
  isMoving: boolean;
  isBouncing: boolean;
}

export interface GameEvent {
  id: string;
  type: 'ball_out' | 'player_fall' | 'crowd_noise';
  message: string;
  effect: {
    stamina?: number;
    morale?: number;
  };
  duration: number;
}

export type GamePhase = 'select' | 'playing' | 'halftime' | 'finished';
export type Half = 'first' | 'second';
export type BackgroundTime = 'day' | 'dusk';

export interface PlayerTemplate {
  id: string;
  name: string;
  speed: number;
  maxStamina: number;
  tacklePower: number;
  description: string;
}

export interface Footprint {
  id: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface Confetti {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
}

export const PLAYER_TEMPLATES: PlayerTemplate[] = [
  {
    id: 'zhang-jun',
    name: '张俊',
    speed: 3,
    maxStamina: 100,
    tacklePower: 50,
    description: '攻守兼备，经验丰富的老将'
  },
  {
    id: 'li-qing',
    name: '李清',
    speed: 4,
    maxStamina: 70,
    tacklePower: 35,
    description: '速度奇快，擅长快速突破'
  },
  {
    id: 'wang-gang',
    name: '王刚',
    speed: 2.5,
    maxStamina: 130,
    tacklePower: 70,
    description: '体力充沛，抢断能力极强'
  }
];

export const RANDOM_EVENTS: Omit<GameEvent, 'id'>[] = [
  {
    type: 'ball_out',
    message: '鞠飞出场地外！侍从连忙捡回...',
    effect: { stamina: -5 },
    duration: 2000
  },
  {
    type: 'player_fall',
    message: '军士不慎滑倒，稍作休整再战！',
    effect: { stamina: -10, morale: -10 },
    duration: 2000
  },
  {
    type: 'crowd_noise',
    message: '场边观众高声喝彩，士气大振！',
    effect: { morale: 15 },
    duration: 2000
  },
  {
    type: 'crowd_noise',
    message: '御驾亲临观赛，众将士奋勇争先！',
    effect: { morale: 20 },
    duration: 2000
  },
  {
    type: 'ball_out',
    message: '大风忽起，鞠偏离方向...',
    effect: { stamina: -3, morale: -5 },
    duration: 2000
  }
];
