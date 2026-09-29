export interface Card {
  id: string;
  name: string;
  cost: number;
  type: 'attack' | 'heal' | 'draw' | 'debuff';
  description: string;
  effect: {
    damage?: number;
    heal?: number;
    draw?: number;
    debuff?: { type: 'reduceDraw'; value: number };
  };
}

export interface PlayerState {
  id: string;
  nickname: string;
  avatar: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  hand: Card[];
  deck: Card[];
  discardPile: Card[];
  debuffs: { reduceDraw: number };
}

export interface RoomState {
  id: string;
  name: string;
  players: Record<string, PlayerState>;
  currentTurn: string;
  turnNumber: number;
  phase: 'waiting' | 'playing' | 'ended';
  winner: string | null;
  battleLog: BattleAction[];
}

export interface BattleRecord {
  id: string;
  timestamp: number;
  winner: string;
  loser: string;
  winnerHp: number;
  loserHp: number;
  turns: number;
  keyPlays: BattleAction[];
  winnerDeck: Card[];
  loserDeck: Card[];
}

export interface BattleAction {
  playerId: string;
  turn: number;
  action: 'playCard' | 'draw' | 'endTurn';
  card?: Card;
  targetId?: string;
  result: {
    damageDealt?: number;
    healAmount?: number;
    cardsDrawn?: Card[];
  };
}

export interface WSMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

export type MessageHandler = (payload: unknown) => void;
