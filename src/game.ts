import { Maze } from './maze';
import { Player } from './player';
import { GameState, GameStatus, MazeReconstructState } from './types';

const HIGH_SCORE_KEY = 'mazeTreasureHighScore';
const RECONSTRUCT_INTERVAL = 30000;
const RECONSTRUCT_DURATION = 1000;
const MAX_TRAP_HITS = 3;
const TREASURE_SCORE = 100;
const TIME_SCORE_PER_SECOND = 10;

export class Game {
  state: GameState;
  status: GameStatus | null;
  maze: Maze;
  player: Player;
  score: number;
  treasuresCollected: number;
  totalTreasures: number;
  survivalTime: number;
  highScore: number;
  gameStartTime: number;
  lastReconstructTime: number;
  reconstructInterval: number;
  screenFlashEndTime: number;
  fadeOutStartTime: number;
  reconstructState: MazeReconstructState | null;

  constructor() {
    this.state = GameState.MENU;
    this.status = null;
    this.maze = new Maze(10);
    this.player = new Player(0, 0, MAX_TRAP_HITS);
    this.score = 0;
    this.treasuresCollected = 0;
    this.totalTreasures = 5;
    this.survivalTime = 0;
    this.highScore = this.loadHighScore();
    this.gameStartTime = 0;
    this.lastReconstructTime = 0;
    this.reconstructInterval = RECONSTRUCT_INTERVAL;
    this.screenFlashEndTime = 0;
    this.fadeOutStartTime = 0;
    this.reconstructState = null;
  }

  loadHighScore(): number {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_KEY);
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  }

  saveHighScore(score: number): void {
    try {
      if (score > this.highScore) {
        this.highScore = score;
        localStorage.setItem(HIGH_SCORE_KEY, score.toString());
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  startGame(currentTime: number): void {
    this.state = GameState.PLAYING;
    this.status = null;
    this.maze = new Maze(10);
    this.player.reset(0, 0);
    this.score = 0;
    this.treasuresCollected = 0;
    this.totalTreasures = this.maze.getTotalTreasureCount();
    this.survivalTime = 0;
    this.gameStartTime = currentTime;
    this.lastReconstructTime = currentTime;
    this.screenFlashEndTime = 0;
    this.fadeOutStartTime = 0;
    this.reconstructState = null;
  }

  update(deltaTime: number, currentTime: number): void {
    if (this.state !== GameState.PLAYING) return;
    
    this.survivalTime = (currentTime - this.gameStartTime) / 1000;
    
    this.player.update(deltaTime, currentTime);
    
    if (this.reconstructState && this.reconstructState.active) {
      if (currentTime >= this.reconstructState.startTime + this.reconstructState.duration) {
        this.reconstructState.active = false;
      }
    }
    
    if (currentTime - this.lastReconstructTime >= this.reconstructInterval && 
        (!this.reconstructState || !this.reconstructState.active)) {
      this.triggerReconstruct(currentTime);
    }
    
    if (!this.player.isMoving) {
      this.checkCollisions(currentTime);
    }
  }

  checkCollisions(currentTime: number): void {
    const pos = this.player.getGridPosition();
    
    if (this.maze.collectTreasure(pos.x, pos.y)) {
      this.treasuresCollected++;
      this.player.activateHalo(currentTime);
    }
    
    if (this.maze.triggerTrap(pos.x, pos.y)) {
      this.player.applySlow(currentTime);
      this.screenFlashEndTime = currentTime + 500;
      
      if (this.player.isGameOver()) {
        this.endGame(GameStatus.LOSE, currentTime);
      }
    }
    
    if (pos.x === this.maze.end.x && pos.y === this.maze.end.y) {
      this.endGame(GameStatus.WIN, currentTime);
    }
  }

  triggerReconstruct(currentTime: number): void {
    const playerPos = this.player.getGridPosition();
    const result = this.maze.reconstructRegion3x3(playerPos.x, playerPos.y);
    
    if (result) {
      this.reconstructState = {
        active: true,
        regionX: result.regionX,
        regionY: result.regionY,
        regionSize: 3,
        oldMaze: result.oldMaze,
        newMaze: result.newMaze,
        startTime: currentTime,
        duration: RECONSTRUCT_DURATION
      };
      this.lastReconstructTime = currentTime;
      this.totalTreasures = this.maze.getTotalTreasureCount();
    } else {
      this.lastReconstructTime = currentTime;
    }
  }

  endGame(status: GameStatus, currentTime: number): void {
    this.state = GameState.GAMEOVER;
    this.status = status;
    this.fadeOutStartTime = currentTime;
    this.score = this.calculateScore();
    this.saveHighScore(this.score);
  }

  calculateScore(): number {
    return this.treasuresCollected * TREASURE_SCORE + Math.floor(this.survivalTime) * TIME_SCORE_PER_SECOND;
  }

  handleKeyDown(key: string, currentTime: number): void {
    if (this.state !== GameState.PLAYING) return;
    
    if (this.player.isMoving) return;
    
    let dx = 0;
    let dy = 0;
    
    switch (key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        dy = -1;
        break;
      case 's':
      case 'arrowdown':
        dy = 1;
        break;
      case 'a':
      case 'arrowleft':
        dx = -1;
        break;
      case 'd':
      case 'arrowright':
        dx = 1;
        break;
      default:
        return;
    }
    
    if (dx !== 0 || dy !== 0) {
      this.player.tryMove(dx, dy, (x, y) => this.maze.canMoveTo(x, y), currentTime);
    }
  }

  handleClick(x: number, y: number, canvasWidth: number, canvasHeight: number, currentTime: number): void {
    if (this.state === GameState.MENU) {
      const centerX = canvasWidth / 2;
      const centerY = canvasHeight / 2;
      const buttonWidth = 200;
      const buttonHeight = 60;
      
      if (this.isPointInButton(x, y, centerX, centerY, buttonWidth, buttonHeight)) {
        this.startGame(currentTime);
      }
    } else if (this.state === GameState.GAMEOVER) {
      const centerX = canvasWidth / 2;
      const buttonY = canvasHeight / 2 + 140;
      const buttonWidth = 200;
      const buttonHeight = 60;
      
      if (this.isPointInButton(x, y, centerX, buttonY, buttonWidth, buttonHeight)) {
        this.startGame(currentTime);
      }
    }
  }

  isPointInButton(px: number, py: number, centerX: number, centerY: number, buttonWidth: number, buttonHeight: number): boolean {
    const buttonX = centerX - buttonWidth / 2;
    const buttonY = centerY - buttonHeight / 2;
    return px >= buttonX && px <= buttonX + buttonWidth &&
           py >= buttonY && py <= buttonY + buttonHeight;
  }

  getSurvivalTime(): number {
    return this.survivalTime;
  }

  getScore(): number {
    return this.score;
  }

  getHighScore(): number {
    return this.highScore;
  }
}
