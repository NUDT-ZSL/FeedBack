import Phaser from 'phaser';
import { NetworkManager, PlayerData, BlockData } from '../network/NetworkManager';

const TILE_SIZE = 32;
const GRID_WIDTH = 50;
const GRID_HEIGHT = 50;

const COLOR_PALETTE = [
  '#FF0000', '#FF7F00', '#FFFF00', '#00FF00',
  '#00FFFF', '#0000FF', '#8B00FF', '#FF00FF',
  '#FFFFFF', '#C0C0C0', '#808080', '#404040',
  '#8B4513', '#FFC0CB', '#A52A2A', '#228B22'
];

const PREFABS: Record<string, { dx: number; dy: number; color: string }[]> = {
  house: [
    { dx: -3, dy: 0, color: '#8B4513' }, { dx: -2, dy: 0, color: '#8B4513' }, { dx: -1, dy: 0, color: '#8B4513' }, { dx: 0, dy: 0, color: '#8B4513' }, { dx: 1, dy: 0, color: '#8B4513' }, { dx: 2, dy: 0, color: '#8B4513' }, { dx: 3, dy: 0, color: '#8B4513' },
    { dx: -3, dy: -1, color: '#8B4513' }, { dx: 3, dy: -1, color: '#8B4513' },
    { dx: -3, dy: -2, color: '#8B4513' }, { dx: -1, dy: -2, color: '#00FFFF' }, { dx: 1, dy: -2, color: '#00FFFF' }, { dx: 3, dy: -2, color: '#8B4513' },
    { dx: -3, dy: -3, color: '#8B4513' }, { dx: 0, dy: -3, color: '#FFFF00' }, { dx: 3, dy: -3, color: '#8B4513' },
    { dx: -3, dy: -4, color: '#8B4513' }, { dx: 3, dy: -4, color: '#8B4513' },
    { dx: -3, dy: -5, color: '#FF0000' }, { dx: -2, dy: -5, color: '#FF0000' }, { dx: -1, dy: -5, color: '#FF0000' }, { dx: 0, dy: -5, color: '#FF0000' }, { dx: 1, dy: -5, color: '#FF0000' }, { dx: 2, dy: -5, color: '#FF0000' }, { dx: 3, dy: -5, color: '#FF0000' },
    { dx: -2, dy: -6, color: '#FF0000' }, { dx: -1, dy: -6, color: '#FF0000' }, { dx: 0, dy: -6, color: '#FF0000' }, { dx: 1, dy: -6, color: '#FF0000' }, { dx: 2, dy: -6, color: '#FF0000' },
    { dx: -1, dy: -7, color: '#FF0000' }, { dx: 0, dy: -7, color: '#FF0000' }, { dx: 1, dy: -7, color: '#FF0000' }
  ],
  bridge: [
    { dx: -4, dy: 0, color: '#8B4513' }, { dx: -3, dy: 0, color: '#8B4513' }, { dx: -2, dy: 0, color: '#8B4513' }, { dx: -1, dy: 0, color: '#8B4513' }, { dx: 0, dy: 0, color: '#8B4513' }, { dx: 1, dy: 0, color: '#8B4513' }, { dx: 2, dy: 0, color: '#8B4513' }, { dx: 3, dy: 0, color: '#8B4513' }, { dx: 4, dy: 0, color: '#8B4513' },
    { dx: -4, dy: -1, color: '#A52A2A' }, { dx: -2, dy: -1, color: '#A52A2A' }, { dx: 0, dy: -1, color: '#A52A2A' }, { dx: 2, dy: -1, color: '#A52A2A' }, { dx: 4, dy: -1, color: '#A52A2A' },
    { dx: -4, dy: -2, color: '#8B4513' }, { dx: 4, dy: -2, color: '#8B4513' }
  ],
  tower: [
    { dx: -2, dy: 0, color: '#808080' }, { dx: -1, dy: 0, color: '#808080' }, { dx: 0, dy: 0, color: '#808080' }, { dx: 1, dy: 0, color: '#808080' }, { dx: 2, dy: 0, color: '#808080' },
    { dx: -2, dy: -1, color: '#808080' }, { dx: 2, dy: -1, color: '#808080' },
    { dx: -2, dy: -2, color: '#808080' }, { dx: 0, dy: -2, color: '#00FFFF' }, { dx: 2, dy: -2, color: '#808080' },
    { dx: -2, dy: -3, color: '#808080' }, { dx: 2, dy: -3, color: '#808080' },
    { dx: -2, dy: -4, color: '#808080' }, { dx: 0, dy: -4, color: '#00FFFF' }, { dx: 2, dy: -4, color: '#808080' },
    { dx: -2, dy: -5, color: '#808080' }, { dx: 2, dy: -5, color: '#808080' },
    { dx: -2, dy: -6, color: '#808080' }, { dx: -1, dy: -6, color: '#808080' }, { dx: 0, dy: -6, color: '#808080' }, { dx: 1, dy: -6, color: '#808080' }, { dx: 2, dy: -6, color: '#808080' },
    { dx: -1, dy: -7, color: '#FF0000' }, { dx: 0, dy: -7, color: '#FF0000' }, { dx: 1, dy: -7, color: '#FF0000' },
    { dx: 0, dy: -8, color: '#FF0000' }
  ]
};

interface PlayerSprite {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  hat: Phaser.GameObjects.Rectangle;
  nameText: Phaser.GameObjects.Text;
  isMoving: boolean;
  targetX: number;
  targetY: number;
  moveTween: Phaser.Tweens.Tween | null;
  containerX: number;
  containerY: number;
}

interface BlockSprite {
  rect: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  isIndestructible: boolean;
}

export class GameScene extends Phaser.Scene {
  private networkManager: NetworkManager | null = null;
  private blocks: Map<string, BlockSprite> = new Map();
  private players: Map<string, PlayerSprite> = new Map();
  private currentPlayerId = '';
  private currentColor = COLOR_PALETTE[0];
  private selectedColorIndex = 0;
  private cursorBlock: Phaser.GameObjects.Rectangle | null = null;
  private paletteContainer: Phaser.GameObjects.Container | null = null;
  private playerListContainer: Phaser.GameObjects.Container | null = null;
  private prefabButtons: Phaser.GameObjects.Container | null = null;
  private gridGraphics: Phaser.GameObjects.Graphics | null = null;
  private cameraTargetX = 0;
  private cameraTargetY = 0;
  private lastMoveTime = 0;
  private audioContext: AudioContext | null = null;
  private keys: { W?: Phaser.Input.Keyboard.Key; A?: Phaser.Input.Keyboard.Key; S?: Phaser.Input.Keyboard.Key; D?: Phaser.Input.Keyboard.Key } = {};
  private longPressTimer: number | null = null;
  private longPressTarget: { x: number; y: number } | null = null;
  private paletteBlocks: Phaser.GameObjects.Rectangle[] = [];
  private prefabPlacing = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  setNetworkManager(manager: NetworkManager): void {
    this.networkManager = manager;
    this.networkManager.connect({
      onPlayerJoin: (player) => this.handlePlayerJoin(player),
      onPlayerLeave: (playerId) => this.handlePlayerLeave(playerId),
      onPlayerMove: (playerId, x, y) => this.handlePlayerMove(playerId, x, y),
      onBlockPlace: (x, y, color) => this.handleBlockPlace(x, y, color),
      onBlockBreak: (x, y) => this.handleBlockBreak(x, y),
      onWorldState: (blocks, players) => this.handleWorldState(blocks, players),
      onConnect: () => {
        this.currentPlayerId = manager.getPlayerId();
      }
    });
  }

  preload(): void {
  }

  create(): void {
    this.createGrid();
    this.createUI();
    this.createAudioContext();
    this.setupInput();
    this.scale.on('resize', this.handleResize, this);
  }

  private createAudioContext(): void {
    try {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  private playClickSound(): void {
    if (!this.audioContext) return;
    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(600 + Math.random() * 200, this.audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.08, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.05);
      oscillator.start();
      oscillator.stop(this.audioContext.currentTime + 0.05);
    } catch (e) {
    }
  }

  private createGrid(): void {
    this.gridGraphics = this.add.graphics();
    this.drawGrid();
  }

  private drawGrid(): void {
    if (!this.gridGraphics) return;
    this.gridGraphics.clear();
    this.gridGraphics.lineStyle(1, 0x2a2a4e, 0.5);

    for (let x = 0; x <= GRID_WIDTH; x++) {
      this.gridGraphics.beginPath();
      this.gridGraphics.moveTo(x * TILE_SIZE, 0);
      this.gridGraphics.lineTo(x * TILE_SIZE, GRID_HEIGHT * TILE_SIZE);
      this.gridGraphics.strokePath();
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      this.gridGraphics.beginPath();
      this.gridGraphics.moveTo(0, y * TILE_SIZE);
      this.gridGraphics.lineTo(GRID_WIDTH * TILE_SIZE, y * TILE_SIZE);
      this.gridGraphics.strokePath();
    }
  }

  private createUI(): void {
    this.createPlayerList();
    this.createPalette();
    this.createPrefabButtons();
    this.createCursorBlock();
  }

  private createPlayerList(): void {
    this.playerListContainer = this.add.container(20, 20);
    this.playerListContainer.setDepth(100);
    this.playerListContainer.setScrollFactor(0);

    const bg = this.add.rectangle(0, 0, 200, 50, 0x000000, 0.6);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(2, 0x4a4a6e);
    this.playerListContainer.add(bg);

    const title = this.add.text(10, 8, '玩家列表', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#FFFFFF'
    });
    title.setOrigin(0, 0);
    this.playerListContainer.add(title);
  }

  private updatePlayerList(): void {
    if (!this.playerListContainer) return;

    const container = this.playerListContainer;
    container.removeAll(true);

    const bgHeight = 40 + this.players.size * 28;
    const bg = this.add.rectangle(0, 0, 200, bgHeight, 0x000000, 0.6);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(2, 0x4a4a6e);
    container.add(bg);

    const title = this.add.text(10, 8, '玩家列表', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#FFFFFF'
    });
    title.setOrigin(0, 0);
    container.add(title);

    let yOffset = 32;
    this.players.forEach((playerSprite, playerId) => {
      const hatColor = playerSprite.hat.fillColor;
      const hexColor = '#' + hatColor.toString(16).padStart(6, '0');
      const isCurrent = playerId === this.currentPlayerId;

      if (isCurrent) {
        const highlightBg = this.add.rectangle(5, yOffset - 2, 190, 24, 0x3a3a5e, 0.5);
        highlightBg.setOrigin(0, 0);
        container.add(highlightBg);
      }

      const hatDot = this.add.rectangle(15, yOffset + 10, 14, 14, Phaser.Display.Color.HexStringToColor(hexColor).color);
      hatDot.setOrigin(0, 0.5);
      hatDot.setStrokeStyle(1, 0xffffff);
      container.add(hatDot);

      const playerName = this.add.text(35, yOffset + 10, playerSprite.nameText.text, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: isCurrent ? '#FFFF00' : '#FFFFFF'
      });
      playerName.setOrigin(0, 0.5);
      container.add(playerName);

      yOffset += 28;
    });
  }

  private createPalette(): void {
    const { width, height } = this.scale;
    this.paletteContainer = this.add.container(width - 20, height - 20);
    this.paletteContainer.setDepth(100);
    this.paletteContainer.setScrollFactor(0);

    const paletteSize = 4;
    const blockSize = 28;
    const padding = 6;
    const totalSize = paletteSize * blockSize + (paletteSize + 1) * padding + 30;

    const bg = this.add.rectangle(0, 0, totalSize, totalSize + 5, 0x000000, 0.7);
    bg.setOrigin(1, 1);
    bg.setStrokeStyle(2, 0x4a4a6e);
    this.paletteContainer.add(bg);

    const title = this.add.text(-totalSize / 2, -totalSize + 10, '调色板', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#FFFFFF'
    });
    title.setOrigin(0.5, 0);
    this.paletteContainer.add(title);

    this.paletteBlocks = [];
    for (let i = 0; i < COLOR_PALETTE.length; i++) {
      const row = Math.floor(i / paletteSize);
      const col = i % paletteSize;

      const xPos = -totalSize / 2 + padding + col * (blockSize + padding) + blockSize / 2;
      const yPos = -totalSize / 2 + 30 + row * (blockSize + padding) + blockSize / 2;

      const colorRect = this.add.rectangle(xPos, yPos, blockSize, blockSize, Phaser.Display.Color.HexStringToColor(COLOR_PALETTE[i]).color);
      colorRect.setOrigin(0.5);
      colorRect.setStrokeStyle(2, i === this.selectedColorIndex ? 0xffffff : 0x333333);
      colorRect.setInteractive({ useHandCursor: true });

      colorRect.on('pointerdown', () => {
        this.selectColor(i);
      });

      this.paletteContainer.add(colorRect);
      this.paletteBlocks.push(colorRect);
    }
  }

  private selectColor(index: number): void {
    this.selectedColorIndex = index;
    this.currentColor = COLOR_PALETTE[index];

    if (this.cursorBlock) {
      this.cursorBlock.setFillStyle(Phaser.Display.Color.HexStringToColor(this.currentColor).color, 0.8);
    }

    this.paletteBlocks.forEach((block, i) => {
      this.tweens.add({
        targets: block,
        scale: i === index ? 1.2 : 1.0,
        duration: 150,
        ease: 'Quad.easeOut',
        onComplete: () => {
          if (i !== index) block.setScale(1.0);
        }
      });
      block.setStrokeStyle(2, i === index ? 0xffffff : 0x333333);
    });

    this.playClickSound();
  }

  private createPrefabButtons(): void {
    const { width, height } = this.scale;
    this.prefabButtons = this.add.container(width - 20, height - 180);
    this.prefabButtons.setDepth(100);
    this.prefabButtons.setScrollFactor(0);

    const container = this.prefabButtons;

    const bg = this.add.rectangle(0, 0, 200, 130, 0x000000, 0.7);
    bg.setOrigin(1, 1);
    bg.setStrokeStyle(2, 0x4a4a6e);
    container.add(bg);

    const title = this.add.text(-100, -120, '快速建筑', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#FFFFFF'
    });
    title.setOrigin(0.5, 0);
    container.add(title);

    const buttonData = [
      { name: '小屋', type: 'house', y: -90 },
      { name: '桥梁', type: 'bridge', y: -50 },
      { name: '塔楼', type: 'tower', y: -10 }
    ];

    buttonData.forEach(data => {
      const btnBg = this.add.rectangle(-100, data.y, 170, 30, 0x2a2a4e);
      btnBg.setOrigin(0.5);
      btnBg.setStrokeStyle(2, 0x6a6a8e);
      btnBg.setInteractive({ useHandCursor: true });
      container.add(btnBg);

      const btnText = this.add.text(-100, data.y, data.name, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#FFFFFF'
      });
      btnText.setOrigin(0.5);
      container.add(btnText);

      btnBg.on('pointerover', () => {
        btnBg.setFillStyle(0x4a4a6e);
      });

      btnBg.on('pointerout', () => {
        btnBg.setFillStyle(0x2a2a4e);
      });

      btnBg.on('pointerdown', () => {
        this.placePrefab(data.type);
      });
    });
  }

  private createCursorBlock(): void {
    this.cursorBlock = this.add.rectangle(
      -TILE_SIZE, -TILE_SIZE, TILE_SIZE - 2, TILE_SIZE - 2,
      Phaser.Display.Color.HexStringToColor(this.currentColor).color, 0.8
    );
    this.cursorBlock.setStrokeStyle(1, 0xffffff, 0.8);
    this.cursorBlock.setDepth(10);
    this.cursorBlock.setVisible(false);
  }

  private setupInput(): void {
    this.keys = {
      W: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    };

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const gridPos = this.pointerToGrid(pointer);
      if (!gridPos) return;
      if (this.longPressTimer !== null && this.longPressTarget &&
        (this.longPressTarget.x !== gridPos.x || this.longPressTarget.y !== gridPos.y)) {
        this.cancelLongPress();
      }
      if (this.cursorBlock) {
        this.cursorBlock.setPosition(gridPos.x * TILE_SIZE + TILE_SIZE / 2, gridPos.y * TILE_SIZE + TILE_SIZE / 2);
        this.cursorBlock.setVisible(true);
      }
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const gridPos = this.pointerToGrid(pointer);
      if (!gridPos) return;
      if (pointer.rightButtonDown()) {
        this.breakBlockAt(gridPos.x, gridPos.y);
        return;
      }
      if (pointer.leftButtonDown()) {
        this.placeBlockAt(gridPos.x, gridPos.y);
        this.startLongPress(gridPos.x, gridPos.y);
      }
    });

    this.input.on('pointerup', () => {
      this.cancelLongPress();
    });

    this.input.mouse?.disableContextMenu();
  }

  private pointerToGrid(pointer: Phaser.Input.Pointer): { x: number; y: number } | null {
    const worldX = pointer.x + this.cameras.main.scrollX;
    const worldY = pointer.y + this.cameras.main.scrollY;
    const gx = Math.floor(worldX / TILE_SIZE);
    const gy = Math.floor(worldY / TILE_SIZE);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return null;
    return { x: gx, y: gy };
  }

  private startLongPress(x: number, y: number): void {
    this.cancelLongPress();
    this.longPressTarget = { x, y };
    this.longPressTimer = window.setTimeout(() => {
      this.breakBlockAt(x, y);
      this.longPressTimer = null;
      this.longPressTarget = null;
    }, 600);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressTarget = null;
  }

  private placeBlockAt(x: number, y: number): void {
    if (!this.networkManager) return;
    this.networkManager.sendBlockPlace(x, y, this.currentColor);
  }

  private breakBlockAt(x: number, y: number): void {
    const key = `${x},${y}`;
    const existing = this.blocks.get(key);
    if (existing && existing.isIndestructible) return;
    this.networkManager?.sendBlockBreak(x, y);
  }

  private placePrefab(type: string): void {
    if (!this.networkManager || this.prefabPlacing) return;
    const cells = PREFABS[type];
    if (!cells || this.currentPlayerId === '') return;
    const me = this.players.get(this.currentPlayerId);
    if (!me) return;

    const baseX = Math.round(me.containerX);
    const baseY = Math.round(me.containerY);
    const rotated = cells.map(cell => ({ ...cell, dy: -cell.dy }));

    this.prefabPlacing = true;
    rotated.forEach((cell, index) => {
      this.time.delayedCall(index * 50, () => {
        const px = baseX + cell.dx;
        const py = baseY + cell.dy;
        if (px >= 0 && px < GRID_WIDTH && py >= 0 && py < GRID_HEIGHT) {
          this.networkManager?.sendBlockPlace(px, py, cell.color);
          this.playClickSound();
        }
        if (index === rotated.length - 1) {
          this.prefabPlacing = false;
        }
      });
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    if (this.paletteContainer) {
      this.paletteContainer.setPosition(gameSize.width - 20, gameSize.height - 20);
    }
    if (this.prefabButtons) {
      this.prefabButtons.setPosition(gameSize.width - 20, gameSize.height - 180);
    }
  }

  private handleWorldState(blocksData: BlockData[], playersData: PlayerData[]): void {
    this.blocks.forEach(sprite => sprite.rect.destroy());
    this.blocks.clear();
    blocksData.forEach(block => this.addBlockSprite(block.x, block.y, block.color, block.isIndestructible));

    this.players.forEach(sprite => sprite.sprite.destroy());
    this.players.clear();
    playersData.forEach(player => this.handlePlayerJoin(player));

    this.updatePlayerList();
  }

  private handlePlayerJoin(player: PlayerData): void {
    const color = Phaser.Display.Color.HexStringToColor(player.hatColor).color;

    const body = this.add.rectangle(0, 0, 18, 22, 0xf0d0a0);
    body.setOrigin(0.5);
    const hat = this.add.rectangle(0, -14, 16, 8, color);
    hat.setOrigin(0.5);
    const nameText = this.add.text(0, -26, player.name, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: player.isCurrentPlayer ? '#FFFF00' : '#FFFFFF'
    });
    nameText.setOrigin(0.5);

    const container = this.add.container(
      player.x * TILE_SIZE + TILE_SIZE / 2,
      player.y * TILE_SIZE + TILE_SIZE / 2,
      [body, hat, nameText]
    );
    container.setDepth(20);

    this.players.set(player.id, {
      sprite: container,
      body,
      hat,
      nameText,
      isMoving: false,
      targetX: player.x,
      targetY: player.y,
      moveTween: null,
      containerX: player.x,
      containerY: player.y
    });
    this.updatePlayerList();
  }

  private handlePlayerLeave(playerId: string): void {
    const sprite = this.players.get(playerId);
    if (sprite) {
      if (sprite.moveTween) sprite.moveTween.stop();
      sprite.sprite.destroy();
      this.players.delete(playerId);
    }
    this.updatePlayerList();
  }

  private handlePlayerMove(playerId: string, x: number, y: number): void {
    const player = this.players.get(playerId);
    if (!player) return;

    player.targetX = x;
    player.targetY = y;
    if (player.moveTween) player.moveTween.stop();

    const px = x * TILE_SIZE + TILE_SIZE / 2;
    const py = y * TILE_SIZE + TILE_SIZE / 2;
    player.moveTween = this.tweens.add({
      targets: player.sprite,
      x: px,
      y: py,
      duration: 120,
      ease: 'Linear',
      onComplete: () => {
        player.isMoving = false;
        player.containerX = x;
        player.containerY = y;
      }
    });
    player.isMoving = true;
    player.containerX = x;
    player.containerY = y;
  }

  private handleBlockPlace(x: number, y: number, color: string): void {
    const key = `${x},${y}`;
    const existing = this.blocks.get(key);
    if (existing) {
      existing.rect.setFillStyle(Phaser.Display.Color.HexStringToColor(color).color);
      this.playPlaceAnimation(existing.rect);
      return;
    }
    const rect = this.addBlockSprite(x, y, color, false);
    if (rect) {
      this.playPlaceAnimation(rect);
      this.playRippleEffect(x, y);
    }
  }

  private handleBlockBreak(x: number, y: number): void {
    const key = `${x},${y}`;
    const sprite = this.blocks.get(key);
    if (!sprite || sprite.isIndestructible) return;
    this.playBreakParticles(x, y, sprite.rect.fillColor);
    sprite.rect.destroy();
    this.blocks.delete(key);
  }

  private addBlockSprite(x: number, y: number, color: string, isIndestructible: boolean): Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(
      x * TILE_SIZE + TILE_SIZE / 2,
      y * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE - 1,
      TILE_SIZE - 1,
      Phaser.Display.Color.HexStringToColor(color).color
    );
    rect.setStrokeStyle(1, 0x000000, 0.3);
    this.blocks.set(`${x},${y}`, { rect, x, y, isIndestructible });
    return rect;
  }

  private playPlaceAnimation(rect: Phaser.GameObjects.Rectangle): void {
    this.tweens.add({
      targets: rect,
      scaleX: 1.15,
      scaleY: 0.85,
      duration: 100,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
  }

  private playRippleEffect(x: number, y: number): void {
    const ring = this.add.circle(
      x * TILE_SIZE + TILE_SIZE / 2,
      y * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE / 2,
      undefined,
      0
    );
    ring.setStrokeStyle(2, 0xffffff, 0.8);
    ring.setDepth(5);
    this.tweens.add({
      targets: ring,
      scale: 2,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy()
    });
    this.tweens.add({
      targets: ring,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut'
    });
  }

  private playBreakParticles(x: number, y: number, fillColor: number): void {
    const px = x * TILE_SIZE + TILE_SIZE / 2;
    const py = y * TILE_SIZE + TILE_SIZE / 2;
    for (let i = 0; i < 5; i++) {
      const shard = this.add.rectangle(px, py, 6, 6, fillColor);
      shard.setDepth(15);
      const angle = (i / 5) * Math.PI * 2 + Math.random() * 0.6;
      const distance = 10 + Math.random() * 12;
      this.tweens.add({
        targets: shard,
        x: px + Math.cos(angle) * distance,
        y: py + Math.sin(angle) * distance,
        alpha: 0,
        angle: Math.random() * 180,
        duration: 400,
        ease: 'Quad.easeOut',
        onComplete: () => shard.destroy()
      });
    }
  }

  update(): void {
    this.updateCurrentPlayerMovement();
    this.updateCameraFollow();
  }

  private updateCameraFollow(): void {
    if (!this.currentPlayerId) return;
    const me = this.players.get(this.currentPlayerId);
    if (!me) return;
    this.cameraTargetX = me.sprite.x;
    this.cameraTargetY = me.sprite.y;
    this.cameras.main.centerOn(this.cameraTargetX, this.cameraTargetY);
  }

  private updateCurrentPlayerMovement(): void {
    if (!this.currentPlayerId) return;
    const me = this.players.get(this.currentPlayerId);
    if (!me) return;

    const now = performance.now();
    if (now - this.lastMoveTime < 120) return;

    let dx = 0;
    let dy = 0;
    if (this.keys.W?.isDown) dy -= 1;
    if (this.keys.S?.isDown) dy += 1;
    if (this.keys.A?.isDown) dx -= 1;
    if (this.keys.D?.isDown) dx += 1;
    if (dx === 0 && dy === 0) return;

    const nextX = Math.max(0, Math.min(GRID_WIDTH - 1, me.targetX + dx));
    const nextY = Math.max(0, Math.min(GRID_HEIGHT - 1, me.targetY + dy));
    if (nextX === me.targetX && nextY === me.targetY) return;

    this.lastMoveTime = now;
    this.networkManager?.sendPlayerMove(nextX, nextY);
  }
}
