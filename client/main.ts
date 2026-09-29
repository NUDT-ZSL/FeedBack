import { networkHandler } from './networkHandler.js';
import { GameUI, type PageType } from './gameUI.js';
import type { RoomState, BattleAction } from '../types/index.js';

interface MatchFoundPayload {
  roomId: string;
  room: RoomState;
  yourId: string;
  opponent?: { nickname: string; avatar: string };
}

interface GameStartPayload {
  room: RoomState;
  firstPlayer: string;
}

interface CardPlayedPayload {
  room: RoomState;
  action: BattleAction;
}

interface TurnEndedPayload {
  room: RoomState;
  nextPlayerId: string;
}

interface GameEndPayload {
  winner: string;
  winnerName: string;
  room: RoomState;
}

interface TurnStartPayload {
  playerId: string;
  turnNumber: number;
}

interface RoomCreatedPayload {
  roomId: string;
  room: RoomState;
  yourId: string;
  roomName: string;
}

interface RoomJoinedPayload {
  roomId: string;
  room: RoomState;
  yourId: string;
}

interface ErrorPayload {
  message: string;
}

interface InvalidPlayPayload {
  reason: string;
}

class GameApp {
  private ui: GameUI;
  private playerId: string = '';
  private roomId: string = '';
  private currentRoom: RoomState | null = null;

  constructor() {
    const container = document.getElementById('game-container');
    if (!container) {
      throw new Error('Game container not found');
    }
    this.ui = new GameUI(container);
  }

  init(): void {
    this.setupNetworkCallbacks();
    this.setupUIListeners();
    this.ui.start();
  }

  private setupUIListeners(): void {
    this.ui.setOnNavigate((page: PageType) => {
      if (page === 'menu' && this.roomId) {
        try {
          networkHandler.leaveRoom(this.roomId);
        } catch {
          // ignore error
        }
        this.roomId = '';
        this.currentRoom = null;
      }
      this.ui.navigateTo(page);
    });

    this.ui.setOnQuickMatch(() => {
      this.ensureConnected();
      const nickname = this.ui['nickname'];
      if (nickname?.trim()) {
        localStorage.setItem('player_nickname', nickname.trim());
        networkHandler.joinQueue(nickname.trim());
        this.ui.showToast('正在匹配对手...');
      } else {
        this.ui.showToast('请先输入昵称');
      }
    });

    this.ui.setOnCreateRoom((roomName: string) => {
      this.ensureConnected();
      const nickname = this.ui['nickname'];
      if (nickname?.trim()) {
        localStorage.setItem('player_nickname', nickname.trim());
        networkHandler.createRoom(roomName, nickname.trim());
      } else {
        this.ui.showToast('请先输入昵称');
      }
    });

    this.ui.setOnJoinRoom((roomId: string) => {
      this.ensureConnected();
      const nickname = this.ui['nickname'];
      if (nickname?.trim()) {
        localStorage.setItem('player_nickname', nickname.trim());
        networkHandler.joinRoom(roomId, nickname.trim());
      } else {
        this.ui.showToast('请先输入昵称');
      }
    });

    this.ui.setOnPlayCard((cardId: string, targetId: string) => {
      networkHandler.playCard(cardId, targetId);
    });

    this.ui.setOnEndTurn(() => {
      networkHandler.endTurn();
    });

    const savedNickname = localStorage.getItem('player_nickname');
    if (savedNickname) {
      this.ui.setNickname(savedNickname);
    }
  }

  private setupNetworkCallbacks(): void {
    networkHandler.on('connect', () => {
      console.log('Connected to server');
    });

    networkHandler.on('disconnect', () => {
      console.log('Disconnected from server');
      this.ui.showToast('与服务器断开连接，正在重连...');
    });

    networkHandler.on('queue_joined', (payload: unknown) => {
      const data = payload as { position: number; avatar: string };
      this.ui.showToast(`已加入匹配队列，当前第 ${data.position} 位`);
      if (data.avatar) {
        // avatar is returned, could use it
      }
    });

    networkHandler.on('match_found', (payload: unknown) => {
      const data = payload as MatchFoundPayload;
      this.playerId = data.yourId;
      this.roomId = data.roomId;
      this.currentRoom = data.room;
      this.ui.setPlayerId(this.playerId);
      this.ui.setRoomState(data.room);
      this.ui.navigateTo('battle');
      this.updateBattleUI(data.room);
      this.ui.showToast('匹配成功！游戏开始！');
    });

    networkHandler.on('room_created', (payload: unknown) => {
      const data = payload as RoomCreatedPayload;
      this.playerId = data.yourId;
      this.roomId = data.roomId;
      this.currentRoom = data.room;
      this.ui.setPlayerId(this.playerId);
      this.ui.setRoomState(data.room);
      this.ui.showToast(`房间已创建，ID: ${data.roomId}`);
      this.copyToClipboard(data.roomId);
    });

    networkHandler.on('room_joined', (payload: unknown) => {
      const data = payload as RoomJoinedPayload;
      this.playerId = data.yourId;
      this.roomId = data.roomId;
      this.currentRoom = data.room;
      this.ui.setPlayerId(this.playerId);
      this.ui.setRoomState(data.room);
    });

    networkHandler.on('player_joined', () => {
      this.ui.showToast('对手已加入');
    });

    networkHandler.on('game_start', (payload: unknown) => {
      const data = payload as GameStartPayload;
      this.currentRoom = data.room;
      this.ui.setRoomState(data.room);
      this.ui.navigateTo('battle');
      this.updateBattleUI(data.room);
    });

    networkHandler.on('turn_start', (payload: unknown) => {
      const data = payload as TurnStartPayload;
      if (this.currentRoom) {
        this.currentRoom.currentTurn = data.playerId;
        this.currentRoom.turnNumber = data.turnNumber;
        this.ui.setRoomState(this.currentRoom);
      }
      if (data.playerId === this.playerId) {
        this.ui.showToast('你的回合');
      }
    });

    networkHandler.on('card_played', (payload: unknown) => {
      const data = payload as CardPlayedPayload;
      this.currentRoom = data.room;
      this.ui.setRoomState(data.room);
      this.updateBattleUI(data.room);

      if (data.action.playerId !== this.playerId) {
        this.animateOpponentCard(data.action);
      }

      if (data.action.result.damageDealt !== undefined && data.action.targetId) {
        const target = this.currentRoom.players[data.action.targetId];
        if (target) {
          this.ui.updateHp(data.action.targetId, target.hp, target.maxHp);
        }
      }
      if (data.action.result.healAmount !== undefined && data.action.playerId) {
        const player = this.currentRoom.players[data.action.playerId];
        if (player) {
          this.ui.updateHp(data.action.playerId, player.hp, player.maxHp);
        }
      }
      if (data.action.result.cardsDrawn && data.action.playerId === this.playerId) {
        const player = this.currentRoom.players[this.playerId];
        if (player) {
          this.ui.updateHand(player.hand);
        }
      }
    });

    networkHandler.on('invalid_play', (payload: unknown) => {
      const data = payload as InvalidPlayPayload;
      this.ui.showToast(`无法出牌：${data.reason}`);
    });

    networkHandler.on('turn_ended', (payload: unknown) => {
      const data = payload as TurnEndedPayload;
      this.currentRoom = data.room;
      this.ui.setRoomState(data.room);

      const nextPlayer = this.currentRoom.players[data.nextPlayerId];
      if (nextPlayer) {
        this.ui.updateEnergy(data.nextPlayerId, nextPlayer.energy, nextPlayer.maxEnergy);
        this.ui.updateHp(data.nextPlayerId, nextPlayer.hp, nextPlayer.maxHp);
        if (data.nextPlayerId === this.playerId) {
          this.ui.updateHand(nextPlayer.hand);
        }
      }
    });

    networkHandler.on('game_end', (payload: unknown) => {
      const data = payload as GameEndPayload;
      this.currentRoom = data.room;
      this.ui.setRoomState(data.room);
      this.ui.showBattleResult(data.winner, data.winnerName);
    });

    networkHandler.on('player_left', () => {
      this.ui.showToast('对手已离开');
    });

    networkHandler.on('error', (payload: unknown) => {
      const data = payload as ErrorPayload;
      this.ui.showToast(`错误：${data.message}`);
    });

    networkHandler.on('chat', (payload: unknown) => {
      const data = payload as { nickname: string; message: string };
      this.ui.showToast(`${data.nickname}: ${data.message}`);
    });
  }

  private updateBattleUI(room: RoomState): void {
    const playerIds = Object.keys(room.players);
    const opponentId = playerIds.find(id => id !== this.playerId) || '';
    const me = room.players[this.playerId];
    const opponent = room.players[opponentId];

    if (me) {
      this.ui.updateHp(this.playerId, me.hp, me.maxHp);
      this.ui.updateEnergy(this.playerId, me.energy, me.maxEnergy);
      this.ui.updateHand(me.hand);
    }
    if (opponent) {
      this.ui.updateHp(opponentId, opponent.hp, opponent.maxHp);
      this.ui.updateEnergy(opponentId, opponent.energy, opponent.maxEnergy);
    }
  }

  private animateOpponentCard(action: BattleAction): void {
    if (action.action !== 'playCard' || !action.card) return;

    const opponentId = Object.keys(this.currentRoom?.players || {}).find(id => id !== this.playerId);
    if (!opponentId) return;

    const opponentEl = document.querySelector(`[data-player-id="${opponentId}"]`);
    if (!opponentEl) return;

    const targetEl = action.targetId ? document.querySelector(`[data-player-id="${action.targetId}"]`) : opponentEl;
    if (!targetEl) return;

    const startRect = opponentEl.getBoundingClientRect();
    const endRect = targetEl.getBoundingClientRect();

    const flyingCard = document.createElement('div');
    flyingCard.className = 'flying-card';
    flyingCard.innerHTML = `
      <div class="card-inner">
        <div class="card-cost">${action.card.cost}</div>
        <div class="card-name">${action.card.name}</div>
        <div class="card-type ${action.card.type}">${this.getCardTypeName(action.card.type)}</div>
      </div>
    `;
    flyingCard.style.left = `${startRect.left + startRect.width / 2}px`;
    flyingCard.style.top = `${startRect.top + startRect.height / 2}px`;
    document.body.appendChild(flyingCard);

    const startTime = performance.now();
    const duration = 400;

    const animate = (timestamp: number): void => {
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = this.easeInOut(progress);
      const currentX = startRect.left + startRect.width / 2 + (endRect.left + endRect.width / 2 - startRect.left - startRect.width / 2) * eased;
      const currentY = startRect.top + startRect.height / 2 + (endRect.top + endRect.height / 2 - startRect.top - startRect.height / 2) * eased - Math.sin(progress * Math.PI) * 50;
      const scale = 1 + Math.sin(progress * Math.PI) * 0.2;

      flyingCard.style.left = `${currentX}px`;
      flyingCard.style.top = `${currentY}px`;
      flyingCard.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${progress * 360}deg)`;
      flyingCard.style.opacity = `${1 - progress * 0.5}`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        flyingCard.remove();
      }
    };
    requestAnimationFrame(animate);
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  private getCardTypeName(type: string): string {
    const names: Record<string, string> = {
      attack: '攻击',
      heal: '治疗',
      draw: '抽牌',
      debuff: '减益'
    };
    return names[type] || type;
  }

  private ensureConnected(): void {
    if (!networkHandler.connected) {
      networkHandler.connect();
    }
  }

  private copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.ui.showToast(`房间ID已复制：${text}`);
    }).catch(() => {
      this.ui.showToast(`房间ID：${text}`);
    });
  }

  destroy(): void {
    this.ui.destroy();
    networkHandler.disconnect();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new GameApp();
  app.init();

  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
});

export { GameApp };
