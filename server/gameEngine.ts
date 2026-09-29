import type { Card, PlayerState, RoomState, BattleAction } from '../types/index.js';

export const CARDS: Record<string, Card> = {
  card_001: {
    id: 'card_001',
    name: '火球术',
    cost: 2,
    type: 'attack',
    description: '造成8点伤害',
    effect: { damage: 8 },
  },
  card_002: {
    id: 'card_002',
    name: '快速斩击',
    cost: 1,
    type: 'attack',
    description: '造成5点伤害',
    effect: { damage: 5 },
  },
  card_003: {
    id: 'card_003',
    name: '重击',
    cost: 3,
    type: 'attack',
    description: '造成12点伤害',
    effect: { damage: 12 },
  },
  card_004: {
    id: 'card_004',
    name: '治疗术',
    cost: 2,
    type: 'heal',
    description: '恢复5点生命值',
    effect: { heal: 5 },
  },
  card_005: {
    id: 'card_005',
    name: '强效治疗',
    cost: 3,
    type: 'heal',
    description: '恢复10点生命值',
    effect: { heal: 10 },
  },
  card_006: {
    id: 'card_006',
    name: '战术思考',
    cost: 1,
    type: 'draw',
    description: '抽1张牌',
    effect: { draw: 1 },
  },
  card_007: {
    id: 'card_007',
    name: '知识汲取',
    cost: 2,
    type: 'draw',
    description: '抽2张牌',
    effect: { draw: 2 },
  },
  card_008: {
    id: 'card_008',
    name: '致盲烟雾',
    cost: 2,
    type: 'debuff',
    description: '减少对手下回合抽牌1张',
    effect: { debuff: { type: 'reduceDraw', value: 1 } },
  },
  card_009: {
    id: 'card_009',
    name: '连击',
    cost: 1,
    type: 'attack',
    description: '造成5点伤害并抽1张牌',
    effect: { damage: 5, draw: 1 },
  },
  card_010: {
    id: 'card_010',
    name: '能量爆发',
    cost: 3,
    type: 'attack',
    description: '造成8点伤害并恢复3点生命值',
    effect: { damage: 8, heal: 3 },
  },
};

export class GameEngine {
  public createPlayerState(
    id: string,
    nickname: string,
    avatar: string
  ): PlayerState {
    const deck = this.createInitialDeck();
    const shuffledDeck = this.shuffleDeck([...deck]);
    const hand = shuffledDeck.splice(0, 5);

    return {
      id,
      nickname,
      avatar,
      hp: 30,
      maxHp: 30,
      energy: 3,
      maxEnergy: 3,
      hand,
      deck: shuffledDeck,
      discardPile: [],
      debuffs: { reduceDraw: 0 },
    };
  }

  private createInitialDeck(): Card[] {
    const deck: Card[] = [];
    for (let i = 0; i < 3; i++) {
      deck.push({ ...(CARDS.card_001 as Card) });
      deck.push({ ...(CARDS.card_002 as Card) });
      deck.push({ ...(CARDS.card_004 as Card) });
      deck.push({ ...(CARDS.card_006 as Card) });
    }
    for (let i = 0; i < 2; i++) {
      deck.push({ ...(CARDS.card_003 as Card) });
      deck.push({ ...(CARDS.card_005 as Card) });
      deck.push({ ...(CARDS.card_007 as Card) });
      deck.push({ ...(CARDS.card_008 as Card) });
      deck.push({ ...(CARDS.card_009 as Card) });
      deck.push({ ...(CARDS.card_010 as Card) });
    }
    return deck;
  }

  private shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled;
  }

  public startGame(room: RoomState): RoomState {
    const playerIds = Object.keys(room.players);
    if (playerIds.length !== 2) {
      throw new Error('Game requires exactly 2 players');
    }

    const firstPlayer = playerIds[Math.floor(Math.random() * 2)]!;

    return {
      ...room,
      phase: 'playing',
      currentTurn: firstPlayer,
      turnNumber: 1,
      battleLog: [],
    };
  }

  public playCard(
    room: RoomState,
    playerId: string,
    cardId: string,
    targetId: string
  ): { room: RoomState; action: BattleAction } {
    if (room.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    if (room.currentTurn !== playerId) {
      throw new Error('Not your turn');
    }

    const player = room.players[playerId];
    if (!player) {
      throw new Error('Player not found');
    }

    const target = room.players[targetId];
    if (!target) {
      throw new Error('Target not found');
    }

    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) {
      throw new Error('Card not in hand');
    }

    const card = player.hand[cardIndex]!;
    if (player.energy < card.cost) {
      throw new Error('Not enough energy');
    }

    const updatedPlayers = { ...room.players };
    const updatedPlayer = { ...player };
    const updatedTarget = { ...target };

    updatedPlayer.energy -= card.cost;
    updatedPlayer.hand = [...updatedPlayer.hand];
    updatedPlayer.hand.splice(cardIndex, 1);
    updatedPlayer.discardPile = [...updatedPlayer.discardPile, card];

    const result = this.executeCardEffect(
      updatedPlayer,
      updatedTarget,
      card
    );

    updatedPlayers[playerId] = result.player;
    updatedPlayers[targetId] = result.target;

    const action: BattleAction = {
      playerId,
      turn: room.turnNumber,
      action: 'playCard',
      card,
      targetId,
      result: result.effectResult,
    };

    const updatedRoom: RoomState = {
      ...room,
      players: updatedPlayers,
      battleLog: [...room.battleLog, action],
    };

    const gameEndResult = this.checkGameEnd(updatedRoom);
    if (gameEndResult) {
      updatedRoom.phase = 'ended';
      updatedRoom.winner = gameEndResult.winner;
    }

    return { room: updatedRoom, action };
  }

  public executeCardEffect(
    player: PlayerState,
    target: PlayerState,
    card: Card
  ): { player: PlayerState; target: PlayerState; effectResult: BattleAction['result'] } {
    const updatedPlayer = { ...player };
    const updatedTarget = { ...target };
    const effectResult: BattleAction['result'] = {};

    if (card.effect.damage) {
      updatedTarget.hp = Math.max(0, updatedTarget.hp - card.effect.damage);
      effectResult.damageDealt = card.effect.damage;
    }

    if (card.effect.heal) {
      updatedPlayer.hp = Math.min(
        updatedPlayer.maxHp,
        updatedPlayer.hp + card.effect.heal
      );
      effectResult.healAmount = card.effect.heal;
    }

    if (card.effect.draw) {
      const drawnCards = this.drawCardsForPlayer(updatedPlayer, card.effect.draw);
      effectResult.cardsDrawn = drawnCards;
    }

    if (card.effect.debuff) {
      if (card.effect.debuff.type === 'reduceDraw') {
        updatedTarget.debuffs = {
          ...updatedTarget.debuffs,
          reduceDraw: updatedTarget.debuffs.reduceDraw + card.effect.debuff.value,
        };
      }
    }

    return { player: updatedPlayer, target: updatedTarget, effectResult };
  }

  private drawCardsForPlayer(player: PlayerState, count: number): Card[] {
    const drawnCards: Card[] = [];
    const updatedPlayer = player;

    for (let i = 0; i < count; i++) {
      if (updatedPlayer.deck.length === 0) {
        if (updatedPlayer.discardPile.length === 0) {
          break;
        }
        updatedPlayer.deck = this.shuffleDeck([...updatedPlayer.discardPile]);
        updatedPlayer.discardPile = [];
      }

      const card = updatedPlayer.deck.shift();
      if (card) {
        updatedPlayer.hand = [...updatedPlayer.hand, card];
        drawnCards.push(card);
      }
    }

    return drawnCards;
  }

  public drawCard(
    room: RoomState,
    playerId: string
  ): { room: RoomState; action: BattleAction } {
    const player = room.players[playerId];
    if (!player) {
      throw new Error('Player not found');
    }

    const updatedPlayer = { ...player };
    const drawCount = Math.max(1, 1 - updatedPlayer.debuffs.reduceDraw);

    const drawnCards = this.drawCardsForPlayer(updatedPlayer, drawCount);

    updatedPlayer.debuffs = { ...updatedPlayer.debuffs, reduceDraw: 0 };

    const updatedPlayers = { ...room.players, [playerId]: updatedPlayer };

    const action: BattleAction = {
      playerId,
      turn: room.turnNumber,
      action: 'draw',
      result: { cardsDrawn: drawnCards },
    };

    return {
      room: { ...room, players: updatedPlayers, battleLog: [...room.battleLog, action] },
      action,
    };
  }

  public endTurn(room: RoomState): { room: RoomState; action: BattleAction } {
    if (room.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    const playerIds = Object.keys(room.players);
    const currentIndex = playerIds.indexOf(room.currentTurn);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIndex]!;

    const updatedPlayers = { ...room.players };
    const nextPlayer = { ...updatedPlayers[nextPlayerId]! };

    nextPlayer.energy = nextPlayer.maxEnergy;

    updatedPlayers[nextPlayerId] = nextPlayer;

    const action: BattleAction = {
      playerId: room.currentTurn,
      turn: room.turnNumber,
      action: 'endTurn',
      result: {},
    };

    let updatedRoom: RoomState = {
      ...room,
      players: updatedPlayers,
      currentTurn: nextPlayerId,
      turnNumber: nextIndex === 0 ? room.turnNumber + 1 : room.turnNumber,
      battleLog: [...room.battleLog, action],
    };

    const drawResult = this.drawCard(updatedRoom, nextPlayerId);
    updatedRoom = drawResult.room;

    return { room: updatedRoom, action };
  }

  public checkGameEnd(room: RoomState): { winner: string; loser: string } | null {
    const playerIds = Object.keys(room.players);
    
    for (const playerId of playerIds) {
      const player = room.players[playerId];
      if (player && player.hp <= 0) {
        const winner = playerIds.find((id) => id !== playerId)!;
        return { winner, loser: playerId };
      }
    }

    return null;
  }
}
