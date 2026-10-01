// ============================================================
// mainScene.ts - Phaser主场景（游戏入口）
// 依赖：config.ts, unitManager.ts, cardManager.ts
// 数据流向：
//   用户输入 -> mainScene -> 分发到unitManager/cardManager
//   unitManager事件 -> mainScene -> 更新UI/日志/回合
//   cardManager事件 -> mainScene -> 召唤单位
// ============================================================

import Phaser from 'phaser';
import {
  HEX_SIZE, HEX_GAP, BOARD_COLS, BOARD_ROWS,
  COLORS, Race, RACE_NAMES, MAX_LOG_ENTRIES
} from './config';
import {
  UnitManager, Unit, HexCoord, hexToPixel, pixelToHex
} from './unitManager';
import { CardManager, CardInstance } from './cardManager';

type Player = 'red' | 'blue';

interface LogEntry {
  text: string;
  color: string;
}

export class MainScene extends Phaser.Scene {
  private unitManager!: UnitManager;
  private cardManager!: CardManager;

  private boardGroup!: Phaser.GameObjects.Group;
  private highlightGroup!: Phaser.GameObjects.Group;

  private currentPlayer: Player = 'red';
  private selectedUnit: Unit | null = null;
  private isAnimating: boolean = false;

  private endTurnBtn!: Phaser.GameObjects.Container;
  private turnIndicator!: Phaser.GameObjects.Text;
  private logEntries: LogEntry[] = [];
  private logTexts: Phaser.GameObjects.Text[] = [];
  private logPanel!: Phaser.GameObjects.Rectangle;

  private redStartHex: HexCoord = { col: 0, row: 7 };
  private blueStartHex: HexCoord = { col: 7, row: 0 };

  private winner: Player | null = null;
  private boardScale = 1;

  constructor() {
    super({ key: 'MainScene' });
  }

  preload() {
    // 空实现：使用图形生成，无需预加载资源
  }

  create() {
    this.registerAudioPlaceholders();
    this.createBoard();
    this.createDecorativeBorder();
    this.createLogPanel();
    this.createTurnUI();

    this.unitManager = new UnitManager(this);
    this.cardManager = new CardManager(this);

    this.cardManager.onCardSelected = (card, player) => {
      if (player !== this.currentPlayer || this.isAnimating) return;
      if (card) {
        this.selectedUnit = null;
        this.clearHighlights();
      }
    };
    this.unitManager.onUnitDestroyed = (u) => {
      this.addLog(`${u.owner === 'red' ? '红方' : '蓝方'} ${RACE_NAMES[u.data.race]} 被消灭!`,
        u.owner === 'red' ? '#ff6666' : '#6666ff');
      this.checkVictory();
    };

    this.setupBoardInput();
    this.setupResponsive();

    this.cardManager.dealInitialHands();
    this.cardManager.showHand(this.currentPlayer);
    this.showStartUnits();

    this.updateTurnUI();
    this.addLog('游戏开始！红方先手', '#ffd700');
  }

  private registerAudioPlaceholders() {
    // 简单音效占位：使用 WebAudio 合成短促蜂鸣
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const registerBeep = (key: string, freq: number, dur: number) => {
      this.sound.on('boot', () => {
        const audio = new Audio();
        this.cache.audio.add(key, audio);
      });
      const playBeep = () => {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + dur);
        } catch {}
      };
      this.game.events.on('audio-' + key, playBeep);
    };
    registerBeep('click', 800, 0.05);
    registerBeep('draw', 600, 0.1);
    registerBeep('playcard', 500, 0.15);
    registerBeep('attack', 200, 0.2);
    registerBeep('victory', 900, 0.5);
    // 重写sound.play以触发自定义事件
    const origPlay = this.sound.play.bind(this.sound);
    (this.sound as any).play = (key: string, config?: any) => {
      this.game.events.emit('audio-' + key);
      try { origPlay(key, config); } catch {}
    };
  }

  private createBoard() {
    this.boardGroup = this.add.group();
    this.highlightGroup = this.add.group();

    // 绘制棋盘背景矩形
    const boardRect = this.add.rectangle(0, 0, 0, 0, COLORS.boardBg, 1);
    this.boardGroup.add(boardRect);

    // 绘制每个六边形
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        this.createHexCell({ col: c, row: r });
      }
    }
    this.layoutBoardRect();
  }

  private layoutBoardRect() {
    const rect = this.boardGroup.getChildren()[0] as Phaser.GameObjects.Rectangle;
    const bottomRight = hexToPixel({ col: BOARD_COLS - 1, row: BOARD_ROWS - 1 });
    const topLeft = hexToPixel({ col: 0, row: 0 });
    const w = bottomRight.x - topLeft.x + HEX_SIZE * 2;
    const h = bottomRight.y - topLeft.y + HEX_SIZE * 2;
    const cx = (topLeft.x + bottomRight.x) / 2;
    const cy = (topLeft.y + bottomRight.y) / 2;
    rect.setPosition(cx, cy);
    rect.setSize(w, h);
    rect.setStrokeStyle(2, COLORS.boardBorder, COLORS.boardBorderAlpha);
  }

  private createHexCell(hex: HexCoord) {
    const pixel = hexToPixel(hex);
    const size = HEX_SIZE;
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      points.push(new Phaser.Math.Vector2(
        pixel.x + Math.cos(angle) * size,
        pixel.y + Math.sin(angle) * size
      ));
    }
    const poly = this.add.polygon(0, 0, points.map(p => ({ x: p.x - pixel.x, y: p.y - pixel.y })),
      COLORS.boardBg, 1);
    poly.setPosition(pixel.x, pixel.y);
    poly.setStrokeStyle(1, COLORS.gridLine, COLORS.gridLineAlpha);
    poly.setData('hex', hex);
    poly.setInteractive(new Phaser.Geom.Polygon(points.map(p => ({ x: p.x, y: p.y }))),
      Phaser.Geom.Polygon.Contains);
    this.boardGroup.add(poly);

    // 起点标记
    if ((hex.col === this.redStartHex.col && hex.row === this.redStartHex.row) ||
        (hex.col === this.blueStartHex.col && hex.row === this.blueStartHex.row)) {
      const color = hex.col === 0 ? COLORS.playerRed : COLORS.playerBlue;
      const mark = this.add.circle(pixel.x, pixel.y, 6, color, 0.5);
      mark.setDepth(2);
      this.boardGroup.add(mark);
    }
  }

  private createDecorativeBorder() {
    const rect = this.boardGroup.getChildren()[0] as Phaser.GameObjects.Rectangle;
    const padding = 20;
    const w = rect.width + padding * 2;
    const h = rect.height + padding * 2;
    const border = this.add.rectangle(rect.x, rect.y, w, h, 0x000000, 0);
    border.setStrokeStyle(3, 0xffffff, 0.07);
    border.setDepth(-1);
    // 四角符文点
    const corners = [
      { x: rect.x - w / 2, y: rect.y - h / 2 },
      { x: rect.x + w / 2, y: rect.y - h / 2 },
      { x: rect.x - w / 2, y: rect.y + h / 2 },
      { x: rect.x + w / 2, y: rect.y + h / 2 }
    ];
    corners.forEach(c => {
      const r = this.add.circle(c.x, c.y, 8, 0xffffff, 0.1);
      r.setDepth(-1);
    });
  }

  private createLogPanel() {
    const panelW = 200;
    const gameH = this.scale.height;
    this.logPanel = this.add.rectangle(panelW / 2 + 5, gameH / 2, panelW, gameH - 200,
      COLORS.logBg, COLORS.logBgAlpha);
    this.logPanel.setOrigin(0.5);
    const title = this.add.text(10, 30, '战斗日志', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#ffd700', fontStyle: 'bold'
    });
    title.setDepth(10);
    for (let i = 0; i < MAX_LOG_ENTRIES; i++) {
      const t = this.add.text(15, 55 + i * 20, '', {
        fontFamily: 'sans-serif', fontSize: '11px', color: '#cccccc', wordWrap: { width: panelW - 20 }
      });
      t.setAlpha(0);
      t.setDepth(10);
      this.logTexts.push(t);
    }
  }

  private addLog(text: string, color: string = '#cccccc') {
    this.logEntries.unshift({ text, color });
    if (this.logEntries.length > MAX_LOG_ENTRIES) this.logEntries.pop();
    this.updateLogDisplay();
  }

  private updateLogDisplay() {
    for (let i = 0; i < this.logTexts.length; i++) {
      const t = this.logTexts[i];
      if (i < this.logEntries.length) {
        t.setText(this.logEntries[i].text);
        t.setColor(this.logEntries[i].color);
        if (t.alpha === 0) {
          t.setAlpha(0);
          this.tweens.add({ targets: t, alpha: 1, duration: 300 });
        }
      } else {
        t.setText('');
      }
    }
  }

  private createTurnUI() {
    const gameW = this.scale.width;
    this.turnIndicator = this.add.text(gameW / 2, 20, '红方回合', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#ff4444',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    this.turnIndicator.setDepth(50);

    this.endTurnBtn = this.createEndTurnButton();
  }

  private createEndTurnButton(): Phaser.GameObjects.Container {
    const w = 120, h = 40;
    const container = this.add.container(this.scale.width - w / 2 - 20, 40);
    const bg = this.add.rectangle(0, 0, w, h, COLORS.moveHighlight, 1);
    bg.setStrokeStyle(2, 0xffffff, 0.3);
    // 使用圆角效果
    const maskRect = this.add.rectangle(0, 0, w, h, 0xffffff, 1);
    // 简单模拟圆角：用4个小圆角补圆
    const corners = [
      { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 },
      { x: -w / 2, y: h / 2 }, { x: w / 2, y: h / 2 }
    ];
    corners.forEach(c => {
      const r = this.add.circle(c.x, c.y, 8, COLORS.moveHighlight, 1);
      container.add(r);
    });
    const label = this.add.text(0, 0, '结束回合', {
      fontFamily: 'sans-serif', fontSize: '16px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add([bg, maskRect, label]);
    container.setSize(w, h);
    container.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
      Phaser.Geom.Rectangle.Contains);
    container.setDepth(50);
    container.on('pointerover', () => bg.setFillStyle(0x5599ff, 1));
    container.on('pointerout', () => bg.setFillStyle(COLORS.moveHighlight, 1));
    container.on('pointerdown', () => {
      if (this.isAnimating || this.winner) return;
      this.sound.play('click', { volume: 0.15 });
      this.tweens.add({
        targets: container, scale: 0.85, duration: 100, yoyo: true, hold: 0
      });
      this.endTurn();
    });
    return container;
  }

  private updateTurnUI() {
    const color = this.currentPlayer === 'red' ? '#ff4444' : '#4488ff';
    this.turnIndicator.setText((this.currentPlayer === 'red' ? '红方' : '蓝方') + '回合');
    this.turnIndicator.setColor(color);
  }

  private setupBoardInput() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isAnimating || this.winner) return;
      // 检查点击是否在棋盘上
      const hex = pixelToHex(pointer.x, pointer.y);
      if (!hex) {
        this.clearSelection();
        return;
      }
      this.onHexClicked(hex, pointer);
    });
    // 单位点击
    this.input.on('gameobjectdown', (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      if (this.isAnimating || this.winner) return;
      let unit: Unit | null = null;
      for (const u of this.unitManager.units.values()) {
        let cur: Phaser.GameObjects.GameObject | null = obj;
        let found = false;
        while (cur) {
          if (cur === u.sprite) { found = true; break; }
          cur = (cur as any).parentContainer || null;
        }
        if (found) {
          unit = u; break;
        }
      }
      if (unit) {
        this.onUnitClicked(unit);
      }
    });
  }

  private onHexClicked(hex: HexCoord, pointer: Phaser.Input.Pointer) {
    this.playClickRipple(hex);
    // 出牌召唤
    if (this.cardManager.selectedCard) {
      const card = this.cardManager.selectedCard;
      const cardOwner = card.container.getData('owner') as Player;
      if (cardOwner === this.currentPlayer) {
        if (this.isValidSummonHex(hex, this.currentPlayer)) {
          this.summonFromCard(card, hex);
          return;
        } else {
          this.addLog('无法在此位置召唤单位', '#ff9944');
          return;
        }
      }
    }
    // 移动
    if (this.selectedUnit) {
      const moveRange = this.unitManager.getMoveRange(this.selectedUnit);
      if (moveRange.some(h => h.col === hex.col && h.row === hex.row)) {
        this.executeMove(this.selectedUnit, hex);
        return;
      }
      // 攻击
      const attackRange = this.unitManager.getAttackRange(this.selectedUnit);
      if (attackRange.some(h => h.col === hex.col && h.row === hex.row)) {
        const target = this.unitManager.getUnitAt(hex);
        if (target) {
          this.executeAttack(this.selectedUnit, target);
          return;
        }
      }
      // 取消选择
      this.clearSelection();
    }
  }

  private onUnitClicked(unit: Unit) {
    if (this.cardManager.selectedCard) {
      // 使用卡牌召唤模式下点击单位无效
      if (this.isValidSummonHex(unit.hex, this.currentPlayer)) {
        // pass
      }
    }
    // 选中单位可攻击
    if (this.selectedUnit && unit.owner !== this.currentPlayer) {
      const attackRange = this.unitManager.getAttackRange(this.selectedUnit);
      if (attackRange.some(h => h.col === unit.hex.col && h.row === unit.hex.row)) {
        this.executeAttack(this.selectedUnit, unit);
        return;
      }
    }
    // 选中自己单位
    if (unit.owner === this.currentPlayer) {
      this.selectedUnit = unit;
      this.cardManager.deselectCard();
      this.showUnitHighlights(unit);
      this.sound.play('click', { volume: 0.15 });
    } else {
      // 点击敌方：若是攻击范围则攻击
      if (this.selectedUnit) {
        const attackRange = this.unitManager.getAttackRange(this.selectedUnit);
        if (attackRange.some(h => h.col === unit.hex.col && h.row === unit.hex.row)) {
          this.executeAttack(this.selectedUnit, unit);
          return;
        }
      }
    }
  }

  private playClickRipple(hex: HexCoord) {
    const pixel = hexToPixel(hex);
    const ripple = this.add.circle(pixel.x, pixel.y, 3, 0xffffff, 0.6);
    ripple.setDepth(200);
    this.tweens.add({
      targets: ripple,
      scale: HEX_SIZE / 3,
      alpha: 0,
      duration: 200,
      ease: 'Quad.out',
      onComplete: () => ripple.destroy()
    });
  }

  private clearHighlights() {
    this.highlightGroup.clear(true, true);
  }

  private clearSelection() {
    this.selectedUnit = null;
    this.cardManager.deselectCard();
    this.clearHighlights();
  }

  private showUnitHighlights(unit: Unit) {
    this.clearHighlights();
    const moveRange = this.unitManager.getMoveRange(unit);
    moveRange.forEach(h => {
      const pixel = hexToPixel(h);
      const size = HEX_SIZE - 4;
      const circle = this.add.circle(pixel.x, pixel.y, size, COLORS.moveHighlight, COLORS.moveHighlightAlpha);
      circle.setDepth(5);
      this.tweens.add({
        targets: circle,
        alpha: { from: COLORS.moveHighlightAlpha, to: COLORS.moveHighlightAlpha * 0.3 },
        duration: 500,
        yoyo: true,
        repeat: -1
      });
      this.highlightGroup.add(circle);
    });
    const attackRange = this.unitManager.getAttackRange(unit);
    attackRange.forEach(h => {
      const pixel = hexToPixel(h);
      const size = HEX_SIZE - 4;
      const circle = this.add.circle(pixel.x, pixel.y, size, COLORS.attackHighlight, COLORS.attackHighlightAlpha);
      circle.setDepth(5);
      this.tweens.add({
        targets: circle,
        alpha: { from: COLORS.attackHighlightAlpha, to: COLORS.attackHighlightAlpha * 0.3 },
        duration: 300,
        yoyo: true,
        repeat: -1
      });
      this.highlightGroup.add(circle);
    });
  }

  private isValidSummonHex(hex: HexCoord, player: Player): boolean {
    if (this.unitManager.hasUnitAt(hex)) return false;
    if (player === 'red') {
      return hex.row >= 5;
    } else {
      return hex.row <= 2;
    }
  }

  private async summonFromCard(card: CardInstance, hex: HexCoord) {
    if (!this.unitManager.canSummon(this.currentPlayer)) {
      this.addLog('单位数量已达上限', '#ff9944');
      return;
    }
    this.isAnimating = true;
    const pixel = hexToPixel(hex);
    await this.cardManager.playCard(card, pixel);
    const race = card.data.race as Race;
    const unit = this.unitManager.createUnit(this.currentPlayer, hex, race);
    if (unit) {
      // 让单位点击事件可用
      unit.sprite.on('pointerdown', () => this.onUnitClicked(unit));
      this.addLog(`${this.currentPlayer === 'red' ? '红方' : '蓝方'}召唤了 ${RACE_NAMES[race]}`,
        this.currentPlayer === 'red' ? '#ff6666' : '#6666ff');
      this.setupUnitInteractivity(unit);
    }
    this.isAnimating = false;
  }

  private setupUnitInteractivity(unit: Unit) {
    unit.sprite.on('pointerdown', () => {
      if (this.isAnimating || this.winner) return;
      this.onUnitClicked(unit);
    });
  }

  private async executeMove(unit: Unit, to: HexCoord) {
    this.isAnimating = true;
    this.clearHighlights();
    const before = { ...unit.hex };
    await this.unitManager.moveUnit(unit, to);
    this.addLog(`${unit.owner === 'red' ? '红方' : '蓝方'} ${RACE_NAMES[unit.data.race]} 移动`,
      unit.owner === 'red' ? '#ffaaaa' : '#aaaaff');
    this.showUnitHighlights(unit);
    this.isAnimating = false;
    this.checkVictory();
  }

  private async executeAttack(attacker: Unit, target: Unit) {
    this.isAnimating = true;
    this.clearHighlights();
    const result = await this.unitManager.attackUnit(attacker, target);
    this.addLog(
      `${attacker.owner === 'red' ? '红' : '蓝'}方${RACE_NAMES[attacker.data.race]} 攻击 ${target.owner === 'red' ? '红' : '蓝'}方${RACE_NAMES[target.data.race]} 造成 ${result.damage} 伤害`,
      attacker.owner === 'red' ? '#ff8888' : '#8888ff');
    if (result.targetKilled) {
      // onUnitDestroyed 已在 unitManager 中处理日志
    }
    this.selectedUnit = attacker;
    this.showUnitHighlights(attacker);
    this.isAnimating = false;
    this.checkVictory();
  }

  private async endTurn() {
    if (this.isAnimating || this.winner) return;
    this.isAnimating = true;
    this.clearSelection();
    this.currentPlayer = this.currentPlayer === 'red' ? 'blue' : 'red';
    this.unitManager.resetTurn(this.currentPlayer);
    this.cardManager.showHand(this.currentPlayer);
    this.updateTurnUI();
    // 抽牌
    this.cardManager.drawCard(this.currentPlayer);
    this.addLog(`${this.currentPlayer === 'red' ? '红方' : '蓝方'}回合开始`,
      this.currentPlayer === 'red' ? '#ff4444' : '#4488ff');
    this.isAnimating = false;
  }

  private showStartUnits() {
    const u1 = this.unitManager.createUnit('red', { col: 1, row: 7 }, 'orc');
    const u2 = this.unitManager.createUnit('red', { col: 0, row: 6 }, 'elf');
    const u3 = this.unitManager.createUnit('blue', { col: 6, row: 0 }, 'dwarf');
    const u4 = this.unitManager.createUnit('blue', { col: 7, row: 1 }, 'undead');
    [u1, u2, u3, u4].forEach(u => u && this.setupUnitInteractivity(u));
  }

  private checkVictory() {
    if (this.winner) return;
    // 1. 占领敌方起点
    const redOnBlueStart = this.unitManager.getUnitAt(this.blueStartHex);
    if (redOnBlueStart && redOnBlueStart.owner === 'red') {
      this.triggerVictory('red', '占领蓝方基地');
      return;
    }
    const blueOnRedStart = this.unitManager.getUnitAt(this.redStartHex);
    if (blueOnRedStart && blueOnRedStart.owner === 'blue') {
      this.triggerVictory('blue', '占领红方基地');
      return;
    }
    // 2. 消灭全部敌方单位
    const redUnits = this.unitManager.getUnitsOfPlayer('red');
    const blueUnits = this.unitManager.getUnitsOfPlayer('blue');
    if (redUnits.length === 0 && blueUnits.length > 0) {
      this.triggerVictory('blue', '消灭全部红方单位');
      return;
    }
    if (blueUnits.length === 0 && redUnits.length > 0) {
      this.triggerVictory('red', '消灭全部蓝方单位');
      return;
    }
  }

  private triggerVictory(winner: Player, reason: string) {
    this.winner = winner;
    this.sound.play('victory', { volume: 0.3 });
    const gameW = this.scale.width;
    const gameH = this.scale.height;
    // 遮罩
    const mask = this.add.rectangle(gameW / 2, gameH / 2, gameW, gameH, 0x000000, 0.7);
    mask.setDepth(1000);
    // 胜利文字
    const title = this.add.text(gameW / 2, gameH / 2 - 40,
      (winner === 'red' ? '红方' : '蓝方') + '胜利!', {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '64px',
      color: '#ffd700',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(1001);
    title.setAlpha(0).setScale(0.3);
    this.tweens.add({
      targets: title,
      alpha: 1,
      scale: 1,
      duration: 800,
      ease: 'Back.out'
    });
    const reasonText = this.add.text(gameW / 2, gameH / 2 + 30, reason, {
      fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff'
    }).setOrigin(0.5).setDepth(1001);
    reasonText.setAlpha(0);
    this.tweens.add({
      targets: reasonText,
      alpha: 1,
      duration: 500,
      delay: 500
    });
    // 烟花粒子
    for (let i = 0; i < 40; i++) {
      this.time.delayedCall(Math.random() * 1500, () => {
        const x = 100 + Math.random() * (gameW - 200);
        const y = 100 + Math.random() * (gameH - 200);
        const color = [0xffd700, 0xff4444, 0x4488ff, 0x44ff44][Math.floor(Math.random() * 4)];
        for (let j = 0; j < 20; j++) {
          const angle = (Math.PI * 2 * j) / 20;
          const speed = 50 + Math.random() * 80;
          const p = this.add.circle(x, y, 3, color, 1);
          p.setDepth(999);
          this.tweens.add({
            targets: p,
            x: x + Math.cos(angle) * speed,
            y: y + Math.sin(angle) * speed,
            alpha: 0,
            scale: 0.2,
            duration: 1000,
            ease: 'Quad.out',
            onComplete: () => p.destroy()
          });
        }
      });
    }
    this.addLog(`=====${winner === 'red' ? '红方' : '蓝方'}胜利：${reason}=====`, '#ffd700');
  }

  private setupResponsive() {
    this.scale.on('resize', () => {
      this.handleResize();
    });
    this.handleResize();
  }

  private handleResize() {
    const gameW = this.scale.width;
    const gameH = this.scale.height;
    // 棋盘缩放
    const isSmall = gameW < 768;
    this.boardScale = isSmall ? 0.8 : 1;
    // 卡牌尺寸
    if (isSmall) {
      this.cardManager.setCardSize(60, 90, 4);
    } else {
      this.cardManager.setCardSize(80, 120, 5);
    }
    this.cardManager.resize();
    // UI位置调整
    this.turnIndicator.setPosition(gameW / 2, 20);
    this.endTurnBtn.setPosition(gameW - 80, 40);
    this.logPanel.setPosition(105, gameH / 2);
  }
}

// 启动游戏
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1a0a2e',
  scene: [MainScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: {
    antialias: true,
    pixelArt: false
  },
  fps: {
    target: 60,
    min: 30,
    forceSetTimeOut: true
  }
};

new Phaser.Game(config);
