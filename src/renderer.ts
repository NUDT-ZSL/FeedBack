import { Maze } from './maze';
import { Player } from './player';
import { GameStatus, MazeCellType, MazeReconstructState } from './types';

const COLORS = {
  bg: '#1a1a2e',
  wall: '#3d2b1f',
  path: '#f5e6cc',
  player: '#00d4ff',
  playerGlow: 'rgba(0, 212, 255, 0.5)',
  treasure: '#ffd700',
  treasureGlow: 'rgba(255, 215, 0, 0.6)',
  trap: '#ff4444',
  trapGlow: 'rgba(255, 68, 68, 0.5)',
  hudBg: 'rgba(26, 26, 46, 0.85)',
  hudText: '#f5e6cc',
  hudAccent: '#00d4ff',
  trail: 'rgba(0, 212, 255, 0.3)',
  borderGlow: 'rgba(0, 212, 255, 0.2)',
  start: '#00ff88',
  end: '#ff6b6b'
};

const MAZE_PADDING = 30;

export class Renderer {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  cellSize: number;
  mazeOffsetX: number;
  mazeOffsetY: number;
  fps: number;
  fpsHistory: number[];

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.cellSize = 0;
    this.mazeOffsetX = 0;
    this.mazeOffsetY = 0;
    this.fps = 60;
    this.fpsHistory = [];
  }

  resize(width: number, height: number, mazeSize: number): void {
    this.width = width;
    this.height = height;
    
    const availableWidth = width - MAZE_PADDING * 2;
    const availableHeight = height - MAZE_PADDING * 2;
    this.cellSize = Math.min(availableWidth / mazeSize, availableHeight / mazeSize);
    
    const mazePixelWidth = this.cellSize * mazeSize;
    const mazePixelHeight = this.cellSize * mazeSize;
    this.mazeOffsetX = (width - mazePixelWidth) / 2;
    this.mazeOffsetY = (height - mazePixelHeight) / 2;
  }

  updateFPS(deltaTime: number): void {
    const currentFps = 1000 / deltaTime;
    this.fpsHistory.push(currentFps);
    if (this.fpsHistory.length > 30) {
      this.fpsHistory.shift();
    }
    this.fps = Math.round(
      this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length
    );
  }

  getFPS(): number {
    return this.fps;
  }

  clear(): void {
    this.ctx.fillStyle = COLORS.bg;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawBackgroundGlow(): void {
    const gradient = this.ctx.createRadialGradient(
      this.width / 2, this.height / 2, 0,
      this.width / 2, this.height / 2, this.width * 0.6
    );
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.05)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawMazeBorder(): void {
    const ctx = this.ctx;
    
    ctx.shadowColor = COLORS.borderGlow;
    ctx.shadowBlur = 20;
    
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
    ctx.lineWidth = 2;
    
    ctx.strokeRect(
      this.mazeOffsetX - 2,
      this.mazeOffsetY - 2,
      this.cellSize * 10 + 4,
      this.cellSize * 10 + 4
    );
    
    ctx.shadowBlur = 0;
  }

  drawMaze(maze: Maze, reconstructState: MazeReconstructState | null, currentTime: number): void {
    for (let y = 0; y < maze.size; y++) {
      for (let x = 0; x < maze.size; x++) {
        const px = this.mazeOffsetX + x * this.cellSize;
        const py = this.mazeOffsetY + y * this.cellSize;
        
        let alpha = 1;
        
        if (reconstructState && reconstructState.active) {
          const inRegion = x >= reconstructState.regionX && 
                          x < reconstructState.regionX + 3 &&
                          y >= reconstructState.regionY && 
                          y < reconstructState.regionY + 3;
          
          if (inRegion) {
            const progress = (currentTime - reconstructState.startTime) / reconstructState.duration;
            const oldVal = reconstructState.oldMaze[y]?.[x];
            const newVal = reconstructState.newMaze[y]?.[x];
            
            if (oldVal !== undefined && newVal !== undefined) {
              if (progress < 0.5) {
                const fadeProgress = progress * 2;
                alpha = 1 - fadeProgress;
                const isWall = oldVal === MazeCellType.WALL;
                this.drawCell(px, py, isWall, alpha);
              } else {
                const fadeInProgress = (progress - 0.5) * 2;
                alpha = fadeInProgress;
                const isWall = newVal === MazeCellType.WALL;
                this.drawCell(px, py, isWall, alpha);
              }
              continue;
            }
          }
        }
        
        const isWall = maze.grid[y][x] === MazeCellType.WALL;
        this.drawCell(px, py, isWall, alpha);
      }
    }
    
    this.drawStartEndMarkers(maze);
  }

  drawCell(px: number, py: number, isWall: boolean, alpha: number): void {
    const ctx = this.ctx;
    
    if (isWall) {
      ctx.fillStyle = this.hexToRgba(COLORS.wall, alpha);
      ctx.fillRect(px, py, this.cellSize, this.cellSize);
      
      ctx.fillStyle = this.hexToRgba('#4a3528', alpha * 0.5);
      ctx.fillRect(px, py, this.cellSize, 2);
      ctx.fillRect(px, py, 2, this.cellSize);
      
      ctx.fillStyle = this.hexToRgba('#2a1d15', alpha * 0.5);
      ctx.fillRect(px, py + this.cellSize - 2, this.cellSize, 2);
      ctx.fillRect(px + this.cellSize - 2, py, 2, this.cellSize);
    } else {
      ctx.fillStyle = this.hexToRgba(COLORS.path, alpha);
      ctx.fillRect(px, py, this.cellSize, this.cellSize);
    }
  }

  drawStartEndMarkers(maze: Maze): void {
    const ctx = this.ctx;
    
    const startPx = this.mazeOffsetX + maze.start.x * this.cellSize;
    const startPy = this.mazeOffsetY + maze.start.y * this.cellSize;
    
    ctx.fillStyle = COLORS.start;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(startPx, startPy, this.cellSize, this.cellSize);
    ctx.globalAlpha = 1;
    
    ctx.fillStyle = COLORS.start;
    ctx.font = `bold ${this.cellSize * 0.3}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('入', startPx + this.cellSize / 2, startPy + this.cellSize / 2);
    
    const endPx = this.mazeOffsetX + maze.end.x * this.cellSize;
    const endPy = this.mazeOffsetY + maze.end.y * this.cellSize;
    
    ctx.fillStyle = COLORS.end;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(endPx, endPy, this.cellSize, this.cellSize);
    ctx.globalAlpha = 1;
    
    ctx.fillStyle = COLORS.end;
    ctx.font = `bold ${this.cellSize * 0.3}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('出', endPx + this.cellSize / 2, endPy + this.cellSize / 2);
  }

  drawTreasures(maze: Maze, currentTime: number): void {
    const ctx = this.ctx;
    
    for (const treasure of maze.treasures) {
      if (treasure.collected) continue;
      
      const px = this.mazeOffsetX + treasure.x * this.cellSize + this.cellSize / 2;
      const py = this.mazeOffsetY + treasure.y * this.cellSize + this.cellSize / 2;
      
      const pulse = Math.sin(currentTime / 300 + treasure.pulsePhase) * 0.2 + 0.8;
      const size = this.cellSize * 0.35 * pulse;
      
      ctx.shadowColor = COLORS.treasureGlow;
      ctx.shadowBlur = 15;
      
      ctx.fillStyle = COLORS.treasure;
      ctx.beginPath();
      ctx.moveTo(px, py - size);
      ctx.lineTo(px + size * 0.6, py);
      ctx.lineTo(px, py + size);
      ctx.lineTo(px - size * 0.6, py);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(px, py - size * 0.5);
      ctx.lineTo(px + size * 0.3, py);
      ctx.lineTo(px, py + size * 0.2);
      ctx.lineTo(px - size * 0.3, py);
      ctx.closePath();
      ctx.fill();
      
      ctx.shadowBlur = 0;
    }
  }

  drawTraps(maze: Maze, currentTime: number): void {
    const ctx = this.ctx;
    
    for (const trap of maze.traps) {
      if (trap.triggered) continue;
      
      const px = this.mazeOffsetX + trap.x * this.cellSize + this.cellSize / 2;
      const py = this.mazeOffsetY + trap.y * this.cellSize + this.cellSize / 2;
      const size = this.cellSize * 0.35;
      
      const pulse = Math.sin(currentTime / 400) * 0.1 + 1;
      
      ctx.shadowColor = COLORS.trapGlow;
      ctx.shadowBlur = 10 * pulse;
      
      ctx.fillStyle = COLORS.trap;
      
      ctx.beginPath();
      ctx.arc(px, py - size * 0.2, size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillRect(px - size * 0.5, py - size * 0.1, size, size * 0.6);
      
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(px - size * 0.2, py - size * 0.3, size * 0.12, 0, Math.PI * 2);
      ctx.arc(px + size * 0.2, py - size * 0.3, size * 0.12, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillRect(px - size * 0.25, py + size * 0.05, size * 0.5, size * 0.1);
      
      for (let i = 0; i < 3; i++) {
        const toothX = px - size * 0.2 + i * size * 0.2;
        ctx.beginPath();
        ctx.moveTo(toothX, py + size * 0.15);
        ctx.lineTo(toothX + size * 0.08, py + size * 0.35);
        ctx.lineTo(toothX + size * 0.16, py + size * 0.15);
        ctx.fill();
      }
      
      ctx.shadowBlur = 0;
    }
  }

  drawPlayer(player: Player, currentTime: number): void {
    const ctx = this.ctx;
    const renderPos = player.getRenderPosition();
    
    const px = this.mazeOffsetX + renderPos.x * this.cellSize + this.cellSize / 2;
    const py = this.mazeOffsetY + renderPos.y * this.cellSize + this.cellSize / 2;
    const radius = this.cellSize * 0.35;
    
    const hasHalo = player.hasHalo(currentTime);
    const isFlashing = player.isFlashingRed(currentTime);
    
    if (hasHalo) {
      const haloPulse = Math.sin(currentTime / 200) * 0.2 + 1;
      const haloRadius = radius * 2 * haloPulse;
      
      const gradient = ctx.createRadialGradient(px, py, radius, px, py, haloRadius);
      gradient.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowColor = isFlashing ? COLORS.trapGlow : COLORS.playerGlow;
    ctx.shadowBlur = 15;
    
    const bodyColor = isFlashing ? COLORS.trap : COLORS.player;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(px - radius * 0.3, py - radius * 0.3, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTrail(player: Player, currentTime: number): void {
    const ctx = this.ctx;
    const trail = player.trail;
    
    if (trail.length < 2 && !player.isMoving) return;
    
    ctx.strokeStyle = COLORS.trail;
    ctx.lineWidth = this.cellSize * 0.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      const alpha = player.getTrailAlpha(point, currentTime);
      
      if (alpha <= 0) continue;
      
      const px = this.mazeOffsetX + point.x * this.cellSize + this.cellSize / 2;
      const py = this.mazeOffsetY + point.y * this.cellSize + this.cellSize / 2;
      
      ctx.globalAlpha = alpha * 0.5;
      
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    
    if (player.isMoving) {
      const renderPos = player.getRenderPosition();
      const px = this.mazeOffsetX + renderPos.x * this.cellSize + this.cellSize / 2;
      const py = this.mazeOffsetY + renderPos.y * this.cellSize + this.cellSize / 2;
      ctx.lineTo(px, py);
    }
    
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawHUD(survivalTime: number, treasuresCollected: number, totalTreasures: number, trapHits: number, maxTrapHits: number): void {
    const ctx = this.ctx;
    const padding = 15;
    const hudWidth = 200;
    const hudHeight = 110;
    const x = 20;
    const y = 20;
    
    ctx.fillStyle = COLORS.hudBg;
    this.roundRect(ctx, x, y, hudWidth, hudHeight, 12);
    ctx.fill();
    
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x, y, hudWidth, hudHeight, 12);
    ctx.stroke();
    
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 16px 'Segoe UI', sans-serif";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    const minutes = Math.floor(survivalTime / 60);
    const seconds = Math.floor(survivalTime % 60);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    ctx.fillText(`⏱  ${timeStr}`, x + padding, y + padding);
    
    ctx.fillStyle = COLORS.treasure;
    ctx.fillText(`◆  ${treasuresCollected} / ${totalTreasures}`, x + padding, y + padding + 30);
    
    ctx.fillStyle = COLORS.hudText;
    ctx.fillText(`🎯  ${this.fps} FPS`, x + padding, y + padding + 60);
    
    const healthX = x + padding;
    const healthY = y + padding + 85;
    const healthWidth = hudWidth - padding * 2;
    const healthHeight = 6;
    
    ctx.fillStyle = 'rgba(255, 68, 68, 0.3)';
    this.roundRect(ctx, healthX, healthY, healthWidth, healthHeight, 3);
    ctx.fill();
    
    const currentHealthWidth = healthWidth * (1 - trapHits / maxTrapHits);
    const healthColor = trapHits >= maxTrapHits - 1 ? COLORS.trap : '#00ff88';
    ctx.fillStyle = healthColor;
    this.roundRect(ctx, healthX, healthY, currentHealthWidth, healthHeight, 3);
    ctx.fill();
  }

  drawScreenFlash(currentTime: number, flashEndTime: number): void {
    if (currentTime >= flashEndTime) return;
    
    const ctx = this.ctx;
    const duration = 500;
    const remaining = flashEndTime - currentTime;
    const progress = 1 - remaining / duration;
    const intensity = Math.sin(progress * Math.PI) * 0.4;
    
    const gradient = ctx.createRadialGradient(
      this.width / 2, this.height / 2, this.width * 0.3,
      this.width / 2, this.height / 2, this.width * 0.7
    );
    gradient.addColorStop(0, `rgba(255, 68, 68, 0)`);
    gradient.addColorStop(1, `rgba(255, 68, 68, ${intensity})`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawMenu(highScore: number): void {
    const ctx = this.ctx;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    
    this.drawBackgroundGlow();
    
    ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
    ctx.shadowBlur = 30;
    
    ctx.fillStyle = COLORS.treasure;
    ctx.font = "bold 48px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('迷宫寻宝', centerX, centerY - 120);
    
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "20px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.fillText('在不断变化的迷宫中收集宝物，躲避陷阱！', centerX, centerY - 60);
    
    const buttonWidth = 200;
    const buttonHeight = 60;
    const buttonX = centerX - buttonWidth / 2;
    const buttonY = centerY;
    
    ctx.shadowColor = 'rgba(0, 212, 255, 0.5)';
    ctx.shadowBlur = 15;
    
    ctx.fillStyle = COLORS.hudAccent;
    this.roundRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 12);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = '#1a1a2e';
    ctx.font = "bold 22px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('开始游戏', centerX, centerY + buttonHeight / 2);
    
    if (highScore > 0) {
      ctx.fillStyle = COLORS.treasure;
      ctx.font = "18px 'Segoe UI', 'Microsoft YaHei', sans-serif";
      ctx.fillText(`🏆 最高分: ${highScore}`, centerX, centerY + 100);
    }
    
    ctx.fillStyle = 'rgba(245, 230, 204, 0.6)';
    ctx.font = "14px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.fillText('使用 WASD 键移动', centerX, centerY + 140);
  }

  drawGameOver(status: GameStatus, score: number, survivalTime: number, treasuresCollected: number): void {
    const ctx = this.ctx;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    
    const isWin = status === GameStatus.WIN;
    const titleColor = isWin ? COLORS.treasure : COLORS.trap;
    const titleText = isWin ? '🎉 胜利！' : '💀 Game Over';
    
    ctx.shadowColor = isWin ? 'rgba(255, 215, 0, 0.5)' : 'rgba(255, 68, 68, 0.5)';
    ctx.shadowBlur = 30;
    
    ctx.fillStyle = titleColor;
    ctx.font = "bold 48px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, centerX, centerY - 100);
    
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "24px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.fillText(`最终得分`, centerX, centerY - 40);
    
    ctx.fillStyle = COLORS.treasure;
    ctx.font = "bold 56px 'Segoe UI', sans-serif";
    ctx.fillText(score.toString(), centerX, centerY + 20);
    
    ctx.fillStyle = 'rgba(245, 230, 204, 0.7)';
    ctx.font = "16px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.fillText(`宝物: ${treasuresCollected} 个 | 生存: ${Math.floor(survivalTime)} 秒`, centerX, centerY + 70);
    
    const buttonWidth = 200;
    const buttonHeight = 60;
    const buttonX = centerX - buttonWidth / 2;
    const buttonY = centerY + 110;
    
    ctx.shadowColor = 'rgba(0, 212, 255, 0.5)';
    ctx.shadowBlur = 15;
    
    ctx.fillStyle = COLORS.hudAccent;
    this.roundRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 12);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = '#1a1a2e';
    ctx.font = "bold 22px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('重新开始', centerX, buttonY + buttonHeight / 2);
  }

  drawFadeOut(currentTime: number, startTime: number, duration: number = 1000): void {
    if (startTime === 0 || currentTime < startTime) return;
    
    const progress = Math.min((currentTime - startTime) / duration, 1);
    
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(0, 0, 0, ${progress * 0.7})`;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  isPointInButton(px: number, py: number, buttonCenterX: number, buttonCenterY: number, buttonWidth: number, buttonHeight: number): boolean {
    const buttonX = buttonCenterX - buttonWidth / 2;
    const buttonY = buttonCenterY - buttonHeight / 2;
    return px >= buttonX && px <= buttonX + buttonWidth &&
           py >= buttonY && py <= buttonY + buttonHeight;
  }

  roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
