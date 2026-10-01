// ============================================================
// cardManager.ts - 卡牌管理器
// 依赖：config.ts
// 被依赖：mainScene.ts
// 数据流向：接收玩家卡牌交互 -> 触发onCardSelected事件 -> mainScene处理召唤
// ============================================================

import Phaser from 'phaser';
import {
  UnitData, Race, randomRace, createUnitData,
  INITIAL_HAND_SIZE, RACE_ICONS, RACE_NAMES, COLORS
} from './config';

export interface CardInstance {
  id: string;
  data: UnitData;
  container: Phaser.GameObjects.Container;
}

export class CardManager {
  private scene: Phaser.Scene;
  private nextId = 0;

  public handRed: CardInstance[] = [];
  public handBlue: CardInstance[] = [];

  public selectedCard: CardInstance | null = null;

  public onCardSelected?: (card: CardInstance | null, player: 'red' | 'blue') => void;

  private handAreaHeight = 160;
  private cardWidth = 80;
  private cardHeight = 120;
  private cardGap = 5;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public setCardSize(width: number, height: number, gap: number) {
    this.cardWidth = width;
    this.cardHeight = height;
    this.cardGap = gap;
  }

  public getHandOf(player: 'red' | 'blue'): CardInstance[] {
    return player === 'red' ? this.handRed : this.handBlue;
  }

  public dealInitialHands() {
    for (let i = 0; i < INITIAL_HAND_SIZE; i++) {
      this.createCardInHand('red', true);
      this.createCardInHand('blue', true);
    }
    this.layoutHand('red');
    this.layoutHand('blue');
  }

  public drawCard(player: 'red' | 'blue') {
    const card = this.createCardInHand(player, false);
    if (!card) return null;
    this.layoutHand(player);
    // 飞行动画：从左侧飞入
    const gameWidth = this.scene.scale.width;
    const origX = card.container.x;
    card.container.setX(-100);
    this.scene.sound.play('draw', { volume: 0.2 });
    this.scene.tweens.add({
      targets: card.container,
      x: origX,
      duration: 300,
      ease: 'Cubic.out'
    });
    return card;
  }

  private createCardInHand(player: 'red' | 'blue', silent: boolean): CardInstance | null {
    const hand = this.getHandOf(player);
    if (hand.length >= 15) return null;
    const id = `card_${this.nextId++}`;
    const race: Race = randomRace();
    const data = createUnitData(race);
    const container = this.createCardSprite(data, player);
    const card: CardInstance = { id, data, container };
    container.setData('cardId', id);
    container.setData('owner', player);
    container.on('pointerdown', () => {
      this.scene.sound.play('click', { volume: 0.15 });
      this.handleCardClick(card, player);
    });
    hand.push(card);
    return card;
  }

  private createCardSprite(data: UnitData, owner: 'red' | 'blue'): Phaser.GameObjects.Container {
    const w = this.cardWidth;
    const h = this.cardHeight;
    const container = this.scene.add.container(0, 0);
    const borderColor = owner === 'red' ? COLORS.playerRed : COLORS.playerBlue;
    const bg = this.scene.add.rectangle(0, 0, w, h, COLORS.cardBg, 1);
    bg.setStrokeStyle(3, borderColor, 1);
    const raceText = this.scene.add.text(0, -h * 0.3, RACE_ICONS[data.race], {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '28px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    const nameText = this.scene.add.text(0, -h * 0.08, RACE_NAMES[data.race], {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: '#cccccc'
    }).setOrigin(0.5);
    const stats = this.scene.add.text(0, h * 0.22,
      `⚔${data.attack}  ❤${data.hp}  ⚑${data.move}`, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffffff'
    }).setOrigin(0.5);
    container.add([bg, raceText, nameText, stats]);
    container.setSize(w, h);
    container.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    return container;
  }

  private handleCardClick(card: CardInstance, player: 'red' | 'blue') {
    if (this.selectedCard === card) {
      this.deselectCard();
      return;
    }
    if (this.selectedCard) {
      this.restoreCardVisual(this.selectedCard);
    }
    this.selectedCard = card;
    this.applyCardSelectVisual(card);
    if (this.onCardSelected) this.onCardSelected(card, player);
  }

  public deselectCard() {
    if (this.selectedCard) {
      this.restoreCardVisual(this.selectedCard);
    }
    this.selectedCard = null;
    if (this.onCardSelected) this.onCardSelected(null, 'red');
  }

  private applyCardSelectVisual(card: CardInstance) {
    this.scene.tweens.add({
      targets: card.container,
      scale: 1.1,
      y: card.container.y - 10,
      duration: 200,
      ease: 'Back.out'
    });
  }

  private restoreCardVisual(card: CardInstance) {
    const player = card.container.getData('owner') as 'red' | 'blue';
    const hand = this.getHandOf(player);
    const layout = this.computeHandLayout(player);
    const idx = hand.indexOf(card);
    const targetPos = layout[idx];
    this.scene.tweens.add({
      targets: card.container,
      scale: 1,
      x: targetPos.x,
      y: targetPos.y,
      duration: 200,
      ease: 'Cubic.out'
    });
  }

  private computeHandLayout(player: 'red' | 'blue'): Array<{ x: number; y: number; angle: number }> {
    const gameWidth = this.scene.scale.width;
    const gameHeight = this.scene.scale.height;
    const hand = this.getHandOf(player);
    const n = hand.length;
    const centerX = gameWidth / 2;
    const baseY = gameHeight - this.handAreaHeight / 2 - 10;
    const spread = Math.min(600, gameWidth - 260);
    const result: Array<{ x: number; y: number; angle: number }> = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;
      const x = centerX + t * spread;
      const yOffset = Math.abs(t) * 30;
      const angle = t * 8;
      result.push({ x, y: baseY + yOffset, angle });
    }
    return result;
  }

  public layoutHand(player: 'red' | 'blue') {
    const hand = this.getHandOf(player);
    const layout = this.computeHandLayout(player);
    hand.forEach((card, idx) => {
      const pos = layout[idx];
      card.container.setPosition(pos.x, pos.y);
      card.container.setAngle(pos.angle);
      card.container.setDepth(100 + idx);
    });
  }

  public showHand(player: 'red' | 'blue') {
    this.getHandOf(player).forEach(c => c.container.setVisible(true));
    this.getHandOf(player === 'red' ? 'blue' : 'red').forEach(c => c.container.setVisible(false));
    this.layoutHand(player);
  }

  public playCard(card: CardInstance, targetPixel: { x: number; y: number }): Promise<void> {
    return new Promise((resolve) => {
      const player = card.container.getData('owner') as 'red' | 'blue';
      const hand = this.getHandOf(player);
      const idx = hand.indexOf(card);
      if (idx >= 0) hand.splice(idx, 1);
      if (this.selectedCard === card) this.selectedCard = null;
      this.scene.sound.play('playcard', { volume: 0.2 });
      this.scene.tweens.add({
        targets: card.container,
        x: targetPixel.x,
        y: targetPixel.y,
        scale: 0.2,
        alpha: 0.5,
        angle: 0,
        duration: 300,
        ease: 'Cubic.out',
        onComplete: () => {
          // landing flash
          const flash = this.scene.add.circle(targetPixel.x, targetPixel.y, 20, 0xffffff, 0.8);
          this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2.5,
            duration: 300,
            ease: 'Cubic.out',
            onComplete: () => flash.destroy()
          });
          card.container.destroy();
          this.layoutHand(player);
          resolve();
        }
      });
    });
  }

  public resize() {
    this.layoutHand('red');
    this.layoutHand('blue');
  }

  public clearAll() {
    [...this.handRed, ...this.handBlue].forEach(c => c.container.destroy());
    this.handRed = [];
    this.handBlue = [];
    this.selectedCard = null;
  }
}
