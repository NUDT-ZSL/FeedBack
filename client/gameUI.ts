import type { Card, PlayerState, RoomState, BattleRecord } from '../types/index.js';

type PageType = 'menu' | 'battle' | 'history';

interface UIPendingUpdate {
  type: 'cardFly' | 'hpUpdate' | 'energyUpdate' | 'handLayout';
  timestamp: number;
  data: unknown;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
}

interface FlyingCard {
  id: string;
  card: Card;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  duration: number;
}

const HISTORY_STORAGE_KEY = 'card_battle_history';

export class GameUI {
  private container: HTMLElement;
  private currentPage: PageType = 'menu';
  private pendingUpdates: UIPendingUpdate[] = [];
  private lastFrameTime: number = 0;
  private animationFrameId: number | null = null;
  private particleCanvas: HTMLCanvasElement | null = null;
  private particles: Particle[] = [];
  private flyingCards: FlyingCard[] = [];
  private playerId: string = '';
  private nickname: string = '';
  private roomState: RoomState | null = null;
  private onNavigate: ((page: PageType) => void) | null = null;
  private onQuickMatch: (() => void) | null = null;
  private onCreateRoom: ((name: string) => void) | null = null;
  private onJoinRoom: ((roomId: string) => void) | null = null;
  private onPlayCard: ((cardId: string, targetId: string) => void) | null = null;
  private onEndTurn: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.checkMobileOrientation();
    window.addEventListener('resize', () => this.checkMobileOrientation());
  }

  setPlayerId(id: string): void {
    this.playerId = id;
  }

  setNickname(name: string): void {
    this.nickname = name;
  }

  setRoomState(state: RoomState): void {
    this.roomState = state;
    this.scheduleUpdate({ type: 'handLayout', timestamp: performance.now(), data: null });
  }

  setOnNavigate(callback: (page: PageType) => void): void {
    this.onNavigate = callback;
  }

  setOnQuickMatch(callback: () => void): void {
    this.onQuickMatch = callback;
  }

  setOnCreateRoom(callback: (name: string) => void): void {
    this.onCreateRoom = callback;
  }

  setOnJoinRoom(callback: (roomId: string) => void): void {
    this.onJoinRoom = callback;
  }

  setOnPlayCard(callback: (cardId: string, targetId: string) => void): void {
    this.onPlayCard = callback;
  }

  setOnEndTurn(callback: () => void): void {
    this.onEndTurn = callback;
  }

  start(): void {
    this.startAnimationLoop();
    this.renderMenu();
  }

  navigateTo(page: PageType): void {
    this.currentPage = page;
    this.container.innerHTML = '';
    if (page === 'menu') {
      this.renderMenu();
    } else if (page === 'battle') {
      this.renderBattle();
    } else if (page === 'history') {
      this.renderHistory();
    }
  }

  private scheduleUpdate(update: UIPendingUpdate): void {
    this.pendingUpdates.push(update);
  }

  private startAnimationLoop(): void {
    const loop = (timestamp: number): void => {
      if (timestamp - this.lastFrameTime >= 16) {
        this.processUpdates(timestamp);
        this.updateParticles();
        this.updateFlyingCards(timestamp);
        this.lastFrameTime = timestamp;
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private processUpdates(timestamp: number): void {
    const updates = this.pendingUpdates.filter(u => timestamp - u.timestamp < 100);
    this.pendingUpdates = [];
    for (const update of updates) {
      if (update.type === 'handLayout' && this.currentPage === 'battle') {
        this.updateHandLayout();
      }
    }
  }

  private checkMobileOrientation(): void {
    const warning = document.getElementById('landscape-warning');
    if (window.innerWidth < 768) {
      if (!warning) {
        const warn = document.createElement('div');
        warn.id = 'landscape-warning';
        warn.className = 'landscape-warning';
        warn.innerHTML = `
          <div class="warning-content">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="#e94560">
              <path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14zM12 7h2v2h-2V7zm0 4h2v6h-2v-6z"/>
            </svg>
            <p>请横屏以获得最佳体验</p>
            <p class="warning-sub">Please rotate your device</p>
          </div>
        `;
        document.body.appendChild(warn);
      }
    } else if (warning) {
      warning.remove();
    }
  }

  private renderMenu(): void {
    this.container.innerHTML = `
      <canvas id="particle-canvas" class="particle-canvas"></canvas>
      <div class="menu-container fade-in">
        <div class="menu-card">
          <h1 class="game-title">卡牌对战</h1>
          <p class="game-subtitle">Card Battle Simulator</p>
          
          <div class="input-group">
            <label for="nickname">昵称</label>
            <input type="text" id="nickname" class="menu-input" placeholder="输入你的昵称" maxlength="20" value="${this.nickname || ''}">
          </div>
          
          <div class="menu-buttons">
            <button class="menu-btn primary" id="btn-quick-match">
              <span class="btn-icon">⚡</span>
              快速匹配
            </button>
            <button class="menu-btn" id="btn-create-room">
              <span class="btn-icon">➕</span>
              创建房间
            </button>
            <button class="menu-btn" id="btn-join-room">
              <span class="btn-icon">🔗</span>
              加入房间
            </button>
            <button class="menu-btn secondary" id="btn-history">
              <span class="btn-icon">📜</span>
              对战历史
            </button>
          </div>
          
          <div class="menu-footer">
            <p>v1.0.0 | 策略卡牌对战</p>
          </div>
        </div>
      </div>
    `;

    this.initParticleCanvas();
    this.bindMenuEvents();
  }

  private initParticleCanvas(): void {
    this.particleCanvas = document.getElementById('particle-canvas') as HTMLCanvasElement;
    if (!this.particleCanvas) return;

    const ctx = this.particleCanvas.getContext('2d');
    if (!ctx) return;

    const resize = (): void => {
      if (this.particleCanvas) {
        this.particleCanvas.width = window.innerWidth;
        this.particleCanvas.height = window.innerHeight;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    this.particles = [];
    for (let i = 0; i < 80; i++) {
      this.particles.push(this.createParticle());
    }
  }

  private createParticle(): Particle {
    const colors = ['#667eea', '#764ba2', '#00d4ff', '#9333ea'];
    return {
      x: Math.random() * (this.particleCanvas?.width || window.innerWidth),
      y: Math.random() * (this.particleCanvas?.height || window.innerHeight),
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: Math.random() * 3 + 1,
      alpha: Math.random() * 0.5 + 0.2,
      color: colors[Math.floor(Math.random() * colors.length)] || '#667eea'
    };
  }

  private updateParticles(): void {
    if (!this.particleCanvas || this.currentPage !== 'menu') return;

    const ctx = this.particleCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p) continue;

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > this.particleCanvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > this.particleCanvas.height) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const p1 = this.particles[i];
        const p2 = this.particles[j];
        if (!p1 || !p2) continue;

        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = '#667eea';
          ctx.globalAlpha = 0.15 * (1 - dist / 120);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  private bindMenuEvents(): void {
    const nicknameInput = document.getElementById('nickname') as HTMLInputElement;
    nicknameInput?.addEventListener('input', (e) => {
      this.nickname = (e.target as HTMLInputElement).value;
    });

    document.getElementById('btn-quick-match')?.addEventListener('click', () => {
      if (!this.nickname.trim()) {
        this.showToast('请输入昵称');
        return;
      }
      this.onQuickMatch?.();
    });

    document.getElementById('btn-create-room')?.addEventListener('click', () => {
      if (!this.nickname.trim()) {
        this.showToast('请输入昵称');
        return;
      }
      const roomName = prompt('输入房间名称:', `${this.nickname}的房间`);
      if (roomName?.trim()) {
        this.onCreateRoom?.(roomName.trim());
      }
    });

    document.getElementById('btn-join-room')?.addEventListener('click', () => {
      if (!this.nickname.trim()) {
        this.showToast('请输入昵称');
        return;
      }
      const roomId = prompt('输入房间ID:');
      if (roomId?.trim()) {
        this.onJoinRoom?.(roomId.trim());
      }
    });

    document.getElementById('btn-history')?.addEventListener('click', () => {
      this.onNavigate?.('history');
    });
  }

  private renderBattle(): void {
    if (!this.roomState) return;

    const playerIds = Object.keys(this.roomState.players);
    const opponentId = playerIds.find(id => id !== this.playerId) || '';
    const me = this.roomState.players[this.playerId];
    const opponent = this.roomState.players[opponentId];

    if (!me || !opponent) return;

    this.container.innerHTML = `
      <div class="battle-container fade-in">
        <div class="battle-top">
          ${this.renderPlayerInfo(opponent, false)}
        </div>
        
        <div class="battle-middle">
          <div class="battlefield">
            <div class="battlefield-grid">
              ${this.renderBattlefieldSlots(opponentId, true)}
              ${this.renderBattlefieldSlots(this.playerId, false)}
            </div>
          </div>
        </div>
        
        <div class="battle-bottom">
          ${this.renderPlayerInfo(me, true)}
          <div class="hand-container" id="hand-container">
            ${this.renderHandCards(me.hand)}
          </div>
        </div>
        
        <div class="battle-controls">
          <button class="control-btn" id="btn-end-turn" ${this.roomState.currentTurn !== this.playerId ? 'disabled' : ''}>
            结束回合 (${this.roomState.turnNumber})
          </button>
          <button class="control-btn secondary" id="btn-leave-room">
            离开房间
          </button>
        </div>
        
        <div class="turn-indicator ${this.roomState.currentTurn === this.playerId ? 'my-turn' : 'opponent-turn'}">
          ${this.roomState.currentTurn === this.playerId ? '你的回合' : '对手回合'}
        </div>
      </div>
    `;

    this.bindBattleEvents(opponentId);
    this.updateHandLayout();
  }

  private renderPlayerInfo(player: PlayerState, isMe: boolean): string {
    const hpPercent = (player.hp / player.maxHp) * 100;
    
    return `
      <div class="player-info ${isMe ? 'player-me' : 'player-opponent'}" data-player-id="${player.id}">
        <div class="player-avatar">
          <span class="avatar-text">${player.avatar || '👤'}</span>
        </div>
        <div class="player-details">
          <div class="player-name">${player.nickname}</div>
          <div class="hp-bar-container">
            <div class="hp-bar" style="width: ${hpPercent}%" data-hp="${player.hp}" data-max-hp="${player.maxHp}"></div>
            <span class="hp-text">${player.hp} / ${player.maxHp}</span>
          </div>
          <div class="energy-bar">
            ${this.renderEnergyDots(player.energy, player.maxEnergy)}
          </div>
          <div class="player-stats">
            <span>牌库: ${player.deck.length}</span>
            <span>弃牌: ${player.discardPile.length}</span>
            <span>手牌: ${player.hand.length}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderEnergyDots(current: number, max: number): string {
    let dots = '';
    for (let i = 0; i < max; i++) {
      const filled = i < current;
      dots += `<span class="energy-dot ${filled ? 'filled' : ''}"></span>`;
    }
    return `<div class="energy-dots">${dots}</div><span class="energy-text">${current}/${max}</span>`;
  }

  private renderBattlefieldSlots(playerId: string, isTop: boolean): string {
    const slots: string[] = [];
    for (let i = 0; i < 5; i++) {
      slots.push(`
        <div class="battlefield-slot" data-slot="${i}" data-owner="${playerId}" data-side="${isTop ? 'top' : 'bottom'}">
          <div class="slot-content"></div>
        </div>
      `);
    }
    return slots.join('');
  }

  private renderHandCards(cards: Card[]): string {
    if (cards.length === 0) {
      return '<div class="empty-hand">没有手牌</div>';
    }

    return cards.map((card, index) => `
      <div class="hand-card" 
           data-card-id="${card.id}" 
           data-index="${index}"
           draggable="true">
        <div class="card-inner">
          <div class="card-cost">${card.cost}</div>
          <div class="card-name">${card.name}</div>
          <div class="card-type ${card.type}">${this.getCardTypeName(card.type)}</div>
          <div class="card-description">${card.description}</div>
          <div class="card-effect">
            ${card.effect.damage ? `⚔️ ${card.effect.damage}` : ''}
            ${card.effect.heal ? `💚 ${card.effect.heal}` : ''}
            ${card.effect.draw ? `📜 ${card.effect.draw}` : ''}
            ${card.effect.debuff ? `🔻 ${card.effect.debuff.value}` : ''}
          </div>
        </div>
      </div>
    `).join('');
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

  private updateHandLayout(): void {
    const container = document.getElementById('hand-container');
    if (!container) return;

    const cards = container.querySelectorAll('.hand-card');
    const cardCount = cards.length;
    const totalAngle = Math.min(cardCount * 4, 40);
    const startAngle = -totalAngle / 2;
    const angleStep = cardCount > 1 ? totalAngle / (cardCount - 1) : 0;

    cards.forEach((card, index) => {
      const angle = startAngle + index * angleStep;
      const tilt = (Math.random() - 0.5) * 10;
      const yOffset = Math.abs(angle) * 0.5;
      
      (card as HTMLElement).style.transform = `rotate(${angle}deg) translateY(${yOffset}px)`;
      (card as HTMLElement).style.setProperty('--tilt', `${tilt}deg`);
      (card as HTMLElement).style.zIndex = `${index}`;
    });
  }

  private bindBattleEvents(opponentId: string): void {
    const handCards = document.querySelectorAll('.hand-card');
    let selectedCardId: string | null = null;

    handCards.forEach(card => {
      card.addEventListener('mouseenter', (e) => {
        const target = e.currentTarget as HTMLElement;
        target.style.transform = `rotate(0deg) scale(1.1) translateY(-20px)`;
        target.style.zIndex = '100';
      });

      card.addEventListener('mouseleave', (e) => {
        const target = e.currentTarget as HTMLElement;
        const index = parseInt(target.dataset.index || '0');
        const cardCount = handCards.length;
        const totalAngle = Math.min(cardCount * 4, 40);
        const startAngle = -totalAngle / 2;
        const angleStep = cardCount > 1 ? totalAngle / (cardCount - 1) : 0;
        const angle = startAngle + index * angleStep;
        const yOffset = Math.abs(angle) * 0.5;
        
        target.style.transform = `rotate(${angle}deg) translateY(${yOffset}px)`;
        target.style.zIndex = `${index}`;
      });

      card.addEventListener('click', (e) => {
        const cardId = (e.currentTarget as HTMLElement).dataset.cardId;
        if (cardId && this.roomState?.currentTurn === this.playerId) {
          selectedCardId = cardId;
          this.showToast(`选择了卡牌，点击对手区域使用`);
        }
      });

      card.addEventListener('dragstart', (e) => {
        const cardId = (e.currentTarget as HTMLElement).dataset.cardId;
        if (cardId) {
          (e as DragEvent).dataTransfer?.setData('text/plain', cardId);
          selectedCardId = cardId;
        }
      });
    });

    const opponentInfo = document.querySelector('.player-opponent');
    opponentInfo?.addEventListener('click', () => {
      if (selectedCardId && this.roomState?.currentTurn === this.playerId) {
        const cardElement = document.querySelector(`[data-card-id="${selectedCardId}"]`);
        if (cardElement) {
          this.animateCardFly(selectedCardId, cardElement as HTMLElement, opponentInfo as HTMLElement);
        }
        this.onPlayCard?.(selectedCardId, opponentId);
        selectedCardId = null;
      }
    });

    opponentInfo?.addEventListener('dragover', (e) => {
      e.preventDefault();
      (opponentInfo as HTMLElement).classList.add('drag-target');
    });

    opponentInfo?.addEventListener('dragleave', () => {
      (opponentInfo as HTMLElement).classList.remove('drag-target');
    });

    opponentInfo?.addEventListener('drop', (e) => {
      e.preventDefault();
      (opponentInfo as HTMLElement).classList.remove('drag-target');
      const cardId = (e as DragEvent).dataTransfer?.getData('text/plain');
      if (cardId && this.roomState?.currentTurn === this.playerId) {
        const cardElement = document.querySelector(`[data-card-id="${cardId}"]`);
        if (cardElement) {
          this.animateCardFly(cardId, cardElement as HTMLElement, opponentInfo as HTMLElement);
        }
        this.onPlayCard?.(cardId, opponentId);
        selectedCardId = null;
      }
    });

    document.getElementById('btn-end-turn')?.addEventListener('click', () => {
      if (this.roomState?.currentTurn === this.playerId) {
        this.onEndTurn?.();
      }
    });

    document.getElementById('btn-leave-room')?.addEventListener('click', () => {
      if (confirm('确定要离开房间吗？')) {
        this.onNavigate?.('menu');
      }
    });
  }

  private animateCardFly(cardId: string, startEl: HTMLElement, endEl: HTMLElement): void {
    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();
    const card = this.roomState?.players[this.playerId]?.hand.find(c => c.id === cardId);
    
    if (!card) return;

    const flyingCard: FlyingCard = {
      id: cardId,
      card,
      startX: startRect.left + startRect.width / 2,
      startY: startRect.top + startRect.height / 2,
      endX: endRect.left + endRect.width / 2,
      endY: endRect.top + endRect.height / 2,
      startTime: performance.now(),
      duration: 400
    };

    this.flyingCards.push(flyingCard);
    this.createFlyingCardElement(flyingCard);
  }

  private createFlyingCardElement(flyingCard: FlyingCard): void {
    const el = document.createElement('div');
    el.className = 'flying-card';
    el.id = `flying-${flyingCard.id}`;
    el.innerHTML = `
      <div class="card-inner">
        <div class="card-cost">${flyingCard.card.cost}</div>
        <div class="card-name">${flyingCard.card.name}</div>
        <div class="card-type ${flyingCard.card.type}">${this.getCardTypeName(flyingCard.card.type)}</div>
      </div>
    `;
    document.body.appendChild(el);
  }

  private updateFlyingCards(timestamp: number): void {
    for (let i = this.flyingCards.length - 1; i >= 0; i--) {
      const fc = this.flyingCards[i];
      if (!fc) continue;

      const elapsed = timestamp - fc.startTime;
      const progress = Math.min(elapsed / fc.duration, 1);
      const eased = this.easeInOut(progress);

      const currentX = fc.startX + (fc.endX - fc.startX) * eased;
      const currentY = fc.startY + (fc.endY - fc.startY) * eased - Math.sin(progress * Math.PI) * 50;
      const scale = 1 + Math.sin(progress * Math.PI) * 0.2;
      const rotation = progress * 360;

      const el = document.getElementById(`flying-${fc.id}`);
      if (el) {
        el.style.left = `${currentX}px`;
        el.style.top = `${currentY}px`;
        el.style.transform = `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`;
        el.style.opacity = `${1 - progress * 0.5}`;
      }

      if (progress >= 1) {
        el?.remove();
        this.flyingCards.splice(i, 1);
      }
    }
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  updateHp(playerId: string, newHp: number, maxHp: number): void {
    const playerInfo = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!playerInfo) return;

    const hpBar = playerInfo.querySelector('.hp-bar') as HTMLElement;
    const hpText = playerInfo.querySelector('.hp-text');
    
    if (hpBar) {
      const percent = (newHp / maxHp) * 100;
      hpBar.style.width = `${percent}%`;
      hpBar.dataset.hp = `${newHp}`;
    }
    if (hpText) {
      hpText.textContent = `${newHp} / ${maxHp}`;
    }
  }

  updateEnergy(playerId: string, newEnergy: number, maxEnergy: number): void {
    const playerInfo = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!playerInfo) return;

    const energyBar = playerInfo.querySelector('.energy-bar');
    if (energyBar) {
      energyBar.innerHTML = this.renderEnergyDots(newEnergy, maxEnergy);
    }
  }

  updateHand(cards: Card[]): void {
    const container = document.getElementById('hand-container');
    if (!container) return;

    container.innerHTML = this.renderHandCards(cards);
    this.updateHandLayout();
    
    if (this.roomState && this.roomState.players[this.playerId]) {
      this.roomState.players[this.playerId].hand = cards;
    }
  }

  showBattleResult(winnerId: string, winnerName: string): void {
    const isWinner = winnerId === this.playerId;
    const overlay = document.createElement('div');
    overlay.className = 'result-overlay fade-in';
    overlay.innerHTML = `
      <div class="result-card">
        <h2 class="${isWinner ? 'winner' : 'loser'}">${isWinner ? '🎉 胜利！' : '💔 失败'}</h2>
        <p>${isWinner ? `恭喜你击败了对手！` : `${winnerName} 获得了胜利`}</p>
        <div class="result-buttons">
          <button class="menu-btn primary" id="btn-result-menu">返回主菜单</button>
          <button class="menu-btn" id="btn-result-again">再来一局</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('btn-result-menu')?.addEventListener('click', () => {
      overlay.remove();
      this.onNavigate?.('menu');
    });

    document.getElementById('btn-result-again')?.addEventListener('click', () => {
      overlay.remove();
      this.onQuickMatch?.();
    });

    if (this.roomState) {
      const opponentId = Object.keys(this.roomState.players).find(id => id !== this.playerId) || '';
      const me = this.roomState.players[this.playerId];
      const opponent = this.roomState.players[opponentId];
      if (me && opponent) {
        this.saveBattleRecord({
          id: Date.now().toString(),
          timestamp: Date.now(),
          winner: winnerName,
          loser: isWinner ? opponent.nickname : me.nickname,
          winnerHp: isWinner ? me.hp : opponent.hp,
          loserHp: isWinner ? opponent.hp : me.hp,
          turns: this.roomState.turnNumber,
          keyPlays: this.roomState.battleLog.slice(-5),
          winnerDeck: isWinner ? [...me.deck, ...me.hand, ...me.discardPile] : [...opponent.deck, ...opponent.hand, ...opponent.discardPile],
          loserDeck: isWinner ? [...opponent.deck, ...opponent.hand, ...opponent.discardPile] : [...me.deck, ...me.hand, ...me.discardPile]
        });
      }
    }
  }

  private saveBattleRecord(record: BattleRecord): void {
    try {
      const existing = this.getBattleHistory();
      existing.unshift(record);
      if (existing.length > 50) existing.length = 50;
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
      console.error('Failed to save battle record:', e);
    }
  }

  getBattleHistory(): BattleRecord[] {
    try {
      const data = localStorage.getItem(HISTORY_STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  clearBattleHistory(): void {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  }

  private renderHistory(): void {
    const history = this.getBattleHistory();

    this.container.innerHTML = `
      <div class="history-container fade-in">
        <div class="history-header">
          <h1>对战历史</h1>
          <div class="history-actions">
            <button class="menu-btn secondary" id="btn-back-menu">返回主菜单</button>
            <button class="menu-btn danger" id="btn-clear-history">清空历史</button>
          </div>
        </div>
        
        <div class="history-content">
          ${history.length === 0 ? `
            <div class="empty-history">
              <p>暂无对战记录</p>
              <p class="empty-sub">开始你的第一场对战吧！</p>
            </div>
          ` : `
            <div class="history-list">
              ${history.map((record, index) => `
                <div class="history-item" data-index="${index}">
                  <div class="history-summary">
                    <span class="history-result ${record.winner === this.nickname ? 'win' : 'lose'}">
                      ${record.winner === this.nickname ? '胜' : '负'}
                    </span>
                    <span class="history-players">${record.winner} vs ${record.loser}</span>
                    <span class="history-turns">${record.turns} 回合</span>
                    <span class="history-hp">${record.winnerHp} : ${record.loserHp}</span>
                    <span class="history-date">${this.formatDate(record.timestamp)}</span>
                    <span class="expand-icon">▼</span>
                  </div>
                  <div class="history-details">
                    <div class="details-section">
                      <h4>关键操作</h4>
                      <ul class="key-plays">
                        ${record.keyPlays.map(play => `
                          <li>
                            <span class="play-turn">回合${play.turn}</span>
                            <span class="play-action">${play.action === 'playCard' ? `使用 ${play.card?.name}` : play.action === 'draw' ? '抽牌' : '结束回合'}</span>
                            ${play.result.damageDealt ? `<span class="play-damage">造成 ${play.result.damageDealt} 伤害</span>` : ''}
                            ${play.result.healAmount ? `<span class="play-heal">恢复 ${play.result.healAmount} 生命</span>` : ''}
                          </li>
                        `).join('')}
                      </ul>
                    </div>
                    <div class="details-section">
                      <h4>胜者卡组 (${record.winnerDeck.length}张)</h4>
                      <div class="deck-preview">
                        ${record.winnerDeck.slice(0, 10).map(card => `
                          <span class="mini-card ${card.type}">${card.name}</span>
                        `).join('')}
                        ${record.winnerDeck.length > 10 ? `<span class="mini-card more">+${record.winnerDeck.length - 10}</span>` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    this.bindHistoryEvents();
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  private bindHistoryEvents(): void {
    document.getElementById('btn-back-menu')?.addEventListener('click', () => {
      this.onNavigate?.('menu');
    });

    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
      if (confirm('确定要清空所有对战历史吗？此操作不可撤销。')) {
        this.clearBattleHistory();
        this.renderHistory();
      }
    });

    document.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.key-plays')) return;
        item.classList.toggle('expanded');
      });
    });
  }

  showToast(message: string, duration: number = 2000): void {
    const toast = document.createElement('div');
    toast.className = 'toast fade-in';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', () => this.checkMobileOrientation());
  }
}

export type { PageType };
