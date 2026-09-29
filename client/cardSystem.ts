import type { Card } from '../types/index.js';

const CARDS: Card[] = [
  {
    id: 'card_001',
    name: '火球术',
    cost: 2,
    type: 'attack',
    description: '造成8点伤害',
    effect: { damage: 8 },
  },
  {
    id: 'card_002',
    name: '快速斩击',
    cost: 1,
    type: 'attack',
    description: '造成5点伤害',
    effect: { damage: 5 },
  },
  {
    id: 'card_003',
    name: '重击',
    cost: 3,
    type: 'attack',
    description: '造成12点伤害',
    effect: { damage: 12 },
  },
  {
    id: 'card_004',
    name: '治疗术',
    cost: 2,
    type: 'heal',
    description: '恢复5点生命',
    effect: { heal: 5 },
  },
  {
    id: 'card_005',
    name: '强效治疗',
    cost: 3,
    type: 'heal',
    description: '恢复10点生命',
    effect: { heal: 10 },
  },
  {
    id: 'card_006',
    name: '战术思考',
    cost: 1,
    type: 'draw',
    description: '抽1张牌',
    effect: { draw: 1 },
  },
  {
    id: 'card_007',
    name: '知识汲取',
    cost: 2,
    type: 'draw',
    description: '抽2张牌',
    effect: { draw: 2 },
  },
  {
    id: 'card_008',
    name: '致盲烟雾',
    cost: 2,
    type: 'debuff',
    description: '对手下回合少抽1张牌',
    effect: { debuff: { type: 'reduceDraw', value: 1 } },
  },
  {
    id: 'card_009',
    name: '连击',
    cost: 1,
    type: 'attack',
    description: '造成5点伤害，抽1张牌',
    effect: { damage: 5, draw: 1 },
  },
  {
    id: 'card_010',
    name: '能量爆发',
    cost: 3,
    type: 'attack',
    description: '造成8点伤害，恢复3点生命',
    effect: { damage: 8, heal: 3 },
  },
];

export function getCardById(id: string): Card | undefined {
  return CARDS.find((card) => card.id === id);
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as Card, shuffled[i] as Card];
  }
  return shuffled;
}

export function createStarterDeck(): Card[] {
  const deck: Card[] = [];
  for (const card of CARDS) {
    deck.push({ ...card }, { ...card });
  }
  return shuffleDeck(deck);
}

export interface ParsedEffect {
  damage: number;
  heal: number;
  draw: number;
  reduceDraw: number;
}

export function parseEffect(card: Card): ParsedEffect {
  const result: ParsedEffect = {
    damage: 0,
    heal: 0,
    draw: 0,
    reduceDraw: 0,
  };

  if (card.effect.damage !== undefined) {
    result.damage = card.effect.damage;
  }
  if (card.effect.heal !== undefined) {
    result.heal = card.effect.heal;
  }
  if (card.effect.draw !== undefined) {
    result.draw = card.effect.draw;
  }
  if (card.effect.debuff?.type === 'reduceDraw') {
    result.reduceDraw = card.effect.debuff.value;
  }

  return result;
}

export function formatEffectDescription(card: Card): string {
  const parts: string[] = [];
  const effect = parseEffect(card);

  if (effect.damage > 0) {
    parts.push(`造成${effect.damage}点伤害`);
  }
  if (effect.heal > 0) {
    parts.push(`恢复${effect.heal}点生命`);
  }
  if (effect.draw > 0) {
    parts.push(`抽${effect.draw}张牌`);
  }
  if (effect.reduceDraw > 0) {
    parts.push(`对手下回合少抽${effect.reduceDraw}张牌`);
  }

  return parts.join('，');
}

export { CARDS };
