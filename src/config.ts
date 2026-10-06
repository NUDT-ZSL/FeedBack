// 游戏静态配置：动作参数表、舞台几何、观众与铜钱常量。
// 被 store.ts（结算逻辑）与 Stage/ActionPanel/StatusPanel（渲染）共同引用。

import type { ActionId, GameAction } from './types';

export const GAME_DURATION_MS = 60_000;
export const MAX_COINS = 20;
export const COIN_FLIGHT_MS = 500;
export const COIN_BLINK_MS = 600;
export const CHEER_TTL_MS = 1_000;

/** 疲劳达到该值后成功率减半 */
export const FATIGUE_WARNING = 80;
/** 疲劳满 100 后强制罢工时长 */
export const FORCED_REST_MS = 3_000;
/** 罢工结束后恢复到的疲劳值 */
export const FORCED_REST_RECOVERY = 60;

/** 连击达到该值触发“满堂彩” */
export const FULL_HOUSE_COMBO = 3;
/** 招牌技充能上限与消耗 */
export const SIGNATURE_COST = 100;
/** 招牌技失败时返还的充能（失败恢复） */
export const SIGNATURE_REFUND = 50;

export const SILVER_SCORE = 1_000;
export const GOLD_SCORE = 1_800;

export const STAGE_WIDTH = 560;
export const STAGE_HEIGHT = 380;
/** 地面线在舞台内的 y 坐标 */
export const GROUND_Y = 300;
/** 木竿/猴子的中心 x 坐标 */
export const MONKEY_X = 280;
/** 木竿高度 200px，竹黄色 */
export const POLE_HEIGHT = 200;
export const POLE_COLOR = '#d4a76a';

export const ACTIONS: Record<ActionId, GameAction> = {
  flip: {
    id: 'flip',
    name: '翻筋斗',
    desc: '稳健的基本功',
    duration: 2_000,
    fatigue: 15,
    successRate: 0.85,
    moodGain: 8,
    coinMultiplier: 1,
    cooldown: 500,
  },
  tripleFlip: {
    id: 'tripleFlip',
    name: '三连筋斗',
    desc: '成功铜钱 +50%',
    duration: 3_000,
    fatigue: 22,
    successRate: 0.6,
    moodGain: 15,
    coinMultiplier: 1.5,
    cooldown: 1_000,
  },
  climb: {
    id: 'climb',
    name: '爬竿',
    desc: '沿竿而上八尺',
    duration: 2_500,
    fatigue: 10,
    successRate: 0.9,
    moodGain: 6,
    coinMultiplier: 1,
    cooldown: 500,
  },
  handstand: {
    id: 'handstand',
    name: '倒立',
    desc: '纹丝不动',
    duration: 2_000,
    fatigue: 12,
    successRate: 0.8,
    moodGain: 8,
    coinMultiplier: 1.1,
    cooldown: 500,
  },
  jump: {
    id: 'jump',
    name: '腾空跃',
    desc: '短小精悍',
    duration: 1_500,
    fatigue: 12,
    successRate: 0.75,
    moodGain: 10,
    coinMultiplier: 1.2,
    cooldown: 500,
  },
  rest: {
    id: 'rest',
    name: '休息',
    desc: '疲劳 -20',
    duration: 1_500,
    fatigue: -20,
    successRate: 1,
    moodGain: 0,
    coinMultiplier: 0,
    cooldown: 0,
    alwaysSucceeds: true,
  },
  signature: {
    id: 'signature',
    name: '封侯大戏',
    desc: '招牌技 · 双倍赏钱',
    duration: 4_000,
    fatigue: 25,
    successRate: 0.75,
    moodGain: 20,
    coinMultiplier: 2,
    cooldown: 2_000,
  },
};

export const ACTION_ORDER: ActionId[] = [
  'flip',
  'tripleFlip',
  'climb',
  'handstand',
  'jump',
  'rest',
  'signature',
];

export interface Spectator {
  name: string;
  x: number;
  height: number;
  color: string;
}

/** 围观人群：书生、胡商、妇人、老翁、孩童、舞姬 */
export const SPECTATORS: Spectator[] = [
  { name: '书生', x: 60, height: 78, color: '#3a6b8d' },
  { name: '胡商', x: 150, height: 74, color: '#c0392b' },
  { name: '妇人', x: 235, height: 68, color: '#b03a6e' },
  { name: '老翁', x: 330, height: 72, color: '#6e7f3a' },
  { name: '孩童', x: 415, height: 60, color: '#c98a2b' },
  { name: '舞姬', x: 495, height: 76, color: '#7a3a8d' },
];

export const CHEER_TEXTS = ['好！', '赏！', '妙啊！', '绝活儿！', '再来一个！'];

export const COIN_VALUE = 10;
export const FULL_HOUSE_VALUE = 15;
