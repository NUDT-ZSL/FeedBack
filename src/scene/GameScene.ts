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
}

interface BlockSprite {
  rect: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
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
        btnBg.setFillStyle(0x4a4a6