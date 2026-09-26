import { MazeData } from './maze';

export class UIManager {
  private score: number = 0;
  private time: number = 0;
  private totalGems: number = 6;
  private collectedGems: boolean[] = [];
  private gemColors: string[] = [];
  private mazeData: MazeData | null = null;

  private scoreElement: HTMLElement | null = null;
  private timerElement: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private hudContainer: HTMLElement | null = null;
  private startScreen: HTMLElement | null = null;
  private winScreen: HTMLElement | null = null;
  private finalStats: HTMLElement | null = null;

  private isRunning: boolean = false;

  constructor() {
    this.scoreElement = document.getElementById('score-value');
    this.timerElement = document.getElementById('timer-value');
    this.progressBar = document.getElementById('gem-progress-bar');
    this.minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.hudContainer = document.getElementById('hud-container');
    this.startScreen = document.getElementById('start-screen');
    this.winScreen = document.getElementById('win-screen');
    this.finalStats = document.getElementById('final-stats');

    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }
  }

  init(mazeData: MazeData, gemColors: string[]): void {
    this.mazeData = mazeData;
    this.totalGems = mazeData.gems.length;
    this.gemColors = gemColors;
    this.collectedGems = new Array(this.totalGems).fill(false);
    this.score = 0;
    this.time = 0;

    this.initProgressBar();
    this.updateScore();
    this.updateTimer();
  }

  private initProgressBar(): void {
    if (!this.progressBar) return;
    this.progressBar.innerHTML = '';

    for (let i = 0; i < this.totalGems; i++) {
      const segment = document.createElement('div');
      segment.className = 'gem-segment';
      segment.style.backgroundColor = this.gemColors[i] || '#333';
      segment.style.opacity = '0.3';
      this.progressBar.appendChild(segment);
    }
  }

  showStartScreen(): void {
    if (this.startScreen) {
      this.startScreen.classList.remove('hidden');
    }
    if (this.hudContainer) {
      this.hudContainer.style.display = 'none';
    }
  }

  hideStartScreen(): void {
    if (this.startScreen) {
      this.startScreen.classList.add('hidden');
    }
    if (this.hudContainer) {
      this.hudContainer.style.display = 'block';
    }
    this.isRunning = true;
  }

  showWinScreen(finalTime: number, finalScore: number): void {
    if (!this.winScreen || !this.finalStats) return;

    this.isRunning = false;
    this.finalStats.innerHTML = `
      <div>最终得分: ${finalScore}</div>
      <div>通关时间: ${this.formatTime(finalTime)}</div>
    `;

    this.winScreen.classList.add('show');
  }

  hideWinScreen(): void {
    if (this.winScreen) {
      this.winScreen.classList.remove('show');
    }
  }

  update(deltaTime: number, playerPos: { x: number; z: number }): void {
    if (!this.isRunning) return;

    this.time += deltaTime;
    this.updateTimer();
    this.drawMinimap(playerPos);
  }

  private updateScore(): void {
    if (this.scoreElement) {
      this.scoreElement.textContent = this.score.toString();
    }
  }

  private updateTimer(): void {
    if (this.timerElement) {
      this.timerElement.textContent = this.formatTime(this.time);
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  collectGem(index: number, scoreValue: number = 100): void {
    if (index < 0 || index >= this.totalGems) return;
    if (this.collectedGems[index]) return;

    this.collectedGems[index] = true;
    this.score += scoreValue;
    this.updateScore();
    this.updateProgressBar();
  }

  private updateProgressBar(): void {
    if (!this.progressBar) return;
    const segments = this.progressBar.querySelectorAll('.gem-segment');

    segments.forEach((seg, i) => {
      const element = seg as HTMLElement;
      if (this.collectedGems[i]) {
        element.style.opacity = '1';
        element.classList.add('collected');
        element.style.boxShadow = `0 0 10px ${this.gemColors[i]}, 0 0 20px ${this.gemColors[i]}`;
      }
    });
  }

  private drawMinimap(playerPos: { x: number; z: number }): void {
    if (!this.minimapCtx || !this.minimapCanvas || !this.mazeData) return;

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const gridSize = this.mazeData.gridSize;
    const cellSize = this.mazeData.cellSize;
    const totalSize = gridSize * cellSize;

    ctx.clearRect(0, 0, w, h);

    const centerX = w / 2;
    const centerY = h / 2;
    const scale = (w - 20) / totalSize;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, w / 2 - 5, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = 'rgba(192, 192, 192, 0.3)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= gridSize; i++) {
      const offset = -totalSize / 2;
      const x1 = centerX + offset * scale;
      const y1 = centerY + (offset + i * cellSize) * scale;
      const x2 = centerX + (offset + totalSize) * scale;
      const y2 = centerY + (offset + i * cellSize) * scale;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const x3 = centerX + (offset + i * cellSize) * scale;
      const y3 = centerY + offset * scale;
      const x4 = centerX + (offset + i * cellSize) * scale;
      const y4 = centerY + (offset + totalSize) * scale;
      ctx.beginPath();
      ctx.moveTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)';
    ctx.lineWidth = 2;

    for (const wall of this.mazeData.walls) {
      const wx = centerX + wall.x * scale;
      const wz = centerY + wall.z * scale;
      const ww = wall.width * scale;
      const wd = wall.depth * scale;

      ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
      ctx.fillRect(wx - ww / 2, wz - wd / 2, ww, wd);
    }

    for (let i = 0; i < this.mazeData.gems.length; i++) {
      const gem = this.mazeData.gems[i];
      const gx = centerX + gem.x * scale;
      const gy = centerY + gem.z * scale;

      if (this.collectedGems[i]) {
        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
      } else {
        ctx.fillStyle = gem.color;
        ctx.shadowColor = gem.color;
        ctx.shadowBlur = 8;
      }

      ctx.beginPath();
      ctx.arc(gx, gy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const exitX = centerX + this.mazeData.exitX * scale;
    const exitY = centerY + this.mazeData.exitZ * scale;
    const allCollected = this.collectedGems.every(g => g);

    if (allCollected) {
      ctx.fillStyle = '#00ff88';
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
    }
    ctx.beginPath();
    ctx.arc(exitX, exitY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    const px = centerX + playerPos.x * scale;
    const py = centerY + playerPos.z * scale;

    ctx.fillStyle = '#2ed573';
    ctx.shadowColor = '#2ed573';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  getScore(): number {
    return this.score;
  }

  getTime(): number {
    return this.time;
  }

  reset(): void {
    this.score = 0;
    this.time = 0;
    this.isRunning = false;
    this.collectedGems = new Array(this.totalGems).fill(false);
    this.hideWinScreen();
    this.showStartScreen();
  }
}
