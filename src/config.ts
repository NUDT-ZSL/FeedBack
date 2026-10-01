// ============================================================
// config.ts - 游戏常量配置
// 被依赖：mainScene.ts, unitManager.ts, cardManager.ts
// 功能：定义棋盘尺寸、单位数据、种族属性、颜色常量等
// ============================================================

export const HEX_SIZE = 30;
export const HEX_GAP = 1;
export const BOARD_COLS = 8;
export const BOARD_ROWS = 8;

export const COLORS = {
  boardBg: 0x2a2a3a,
  boardBorder: 0xffffff,
  boardBorderAlpha: 0.13,
  gridLine: 0xffffff,
  gridLineAlpha: 0.13,
  moveHighlight: 0x4488ff,
  moveHighlightAlpha: 0.27,
  attackHighlight: 0xff4444,
  attackHighlightAlpha: 0.27,
  playerRed: 0xff4444,
  playerBlue: 0x4444ff,
  cardBg: 0x3a2a4a,
  cardBorder: 0x8866aa,
  logBg: 0x000000,
  logBgAlpha: 0.53,
  gold: 0xffd700
};

export type Race = 'elf' | 'dwarf' | 'undead' | 'orc';

export interface UnitData {
  race: Race;
  name: string;
  initial: string;
  attack: number;
  hp: number;
  maxHp: number;
  move: number;
  attackRange: number;
}

export const RACE_ICONS: Record<Race, string> = {
  elf: 'E',
  dwarf: 'D',
  undead: 'U',
  orc: 'O'
};

export const RACE_NAMES: Record<Race, string> = {
  elf: '精灵',
  dwarf: '矮人',
  undead: '亡灵',
  orc: '兽人'
};

export function createUnitData(race: Race): UnitData {
  const presets: Record<Race, Omit<UnitData, 'hp' | 'maxHp'>> = {
    elf: { race: 'elf', name: '精灵射手', initial: 'E', attack: 5, move: 3, attackRange: 2 },
    dwarf: { race: 'dwarf', name: '矮人战士', initial: 'D', attack: 7, move: 2, attackRange: 1 },
    undead: { race: 'undead', name: '亡灵法师', initial: 'U', attack: 4, move: 3, attackRange: 2 },
    orc: { race: 'orc', name: '兽人狂战士', initial: 'O', attack: 8, move: 2, attackRange: 1 }
  };
  const base = presets[race];
  const hp = 10 + Math.floor(Math.random() * 11);
  return {
    ...base,
    hp,
    maxHp: hp
  };
}

export function randomRace(): Race {
  const races: Race[] = ['elf', 'dwarf', 'undead', 'orc'];
  return races[Math.floor(Math.random() * races.length)];
}

export const INITIAL_HAND_SIZE = 6;
export const MAX_UNITS_PER_PLAYER = 12;
export const MAX_LOG_ENTRIES = 10;
