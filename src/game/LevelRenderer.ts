import { GridCell, WaterParticle, WaterSplash, COLORS, PipeType, Direction, PIPE_CONNECTIONS } from './types';

export class LevelRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cellSize: number = 0;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private gridSize: number = 0;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private staticCacheDirty: boolean = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;
  }

  resize(width: number, height: number, gridSize: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gridSize = gridSize;

    const maxCellWidth = (width - 40) / gridSize;
    const maxCellHeight = (height - 120) / gridSize;
    this.cellSize = Math.min(maxCellWidth, maxCellHeight, 60);

    const totalWidth = this.cellSize * gridSize;
    const totalHeight = this.cellSize * gridSize;
    this.offsetX = (width - totalWidth) / 2;
    this.offsetY = (height - totalHeight) / 2;

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    this.staticCacheDirty = true;
  }

  getGridPosition(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.offsetX) / this.cellSize);
    const y = Math.floor((clientY - rect.top - this.offsetY) / this.cellSize);

    if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
      return { x, y };
    }
    return null;
  }

  render(
    grid: GridCell[][],
    particles: WaterParticle[],
    splashes: WaterSplash[],
    isWaterFlowing: boolean,
    waterPath: { x: number; y: number }[],
    selectedPipe: PipeType | null,
    waterWheelRotation: number,
    showWaterWheel: boolean
  ): number {
    const startTime = performance.now();

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.offscreenCtx && this.offscreenCanvas && this.staticCacheDirty) {
      this.renderStaticLayer(this.offscreenCtx, grid);
      this.staticCacheDirty = false;
    }

    if (this.offscreenCanvas) {
      this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    }

    this.renderWaterPath(waterPath, isWaterFlowing);
    this.renderPipes(grid);
    this.renderWaterTower(grid);
    this.renderTarget(grid);
    this.renderParticles(particles);
    this.renderSplashes(splashes);

    if (showWaterWheel && waterPath.length > 0) {
      const targetCell = waterPath[waterPath.length - 1];
      this.renderWaterWheel(targetCell.x + 0.5, targetCell.y + 0.5, waterWheelRotation);
    }

    if (selectedPipe) {
      this.renderHoverPreview(selectedPipe);
    }

    return performance.now() - startTime;
  }

  private renderStaticLayer(ctx: CanvasRenderingContext2D, grid: GridCell[][]): void {
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const gradient = ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
    gradient.addColorStop(0, COLORS.grass);
    gradient.addColorStop(1, COLORS.sand);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const cell = grid[y]?.[x];
        if (!cell) continue;

        const px = this.offsetX + x * this.cellSize;
        const py = this.offsetY + y * this.cellSize;

        ctx.fillStyle = cell.terrainType === 'grass' ? COLORS.grass : COLORS.sand;
        ctx.fillRect(px, py, this.cellSize, this.cellSize);

        ctx.strokeStyle = COLORS.gridLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, this.cellSize, this.cellSize);
      }
    }
  }

  private renderWaterPath(path: { x: number; y: number }[], isFlowing: boolean): void {
    if (path.length < 2) return;

    this.ctx.save();

    if (!isFlowing) {
      this.ctx.setLineDash([8, 4]);
      this.ctx.strokeStyle = COLORS.disconnectedPath;
      this.ctx.lineWidth = 4;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    } else {
      this.ctx.strokeStyle = COLORS.waterGlow;
      this.ctx.lineWidth = 12;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.filter = 'blur(8px)';
    }

    this.ctx.beginPath();
    this.ctx.moveTo(
      this.offsetX + (path[0].x + 0.5) * this.cellSize,
      this.offsetY + (path[0].y + 0.5) * this.cellSize
    );

    for (let i = 1; i < path.length; i++) {
      this.ctx.lineTo(
        this.offsetX + (path[i].x + 0.5) * this.cellSize,
        this.offsetY + (path[i].y + 0.5) * this.cellSize
      );
    }

    this.ctx.stroke();

    if (isFlowing) {
      this.ctx.filter = 'none';
      this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.1)';
      this.ctx.lineWidth = 8;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private renderPipes(grid: GridCell[][]): void {
    const now = performance.now();

    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const cell = grid[y]?.[x];
        if (!cell || !cell.pipeType || cell.isWaterSource || cell.isTarget) continue;

        const px = this.offsetX + (x + 0.5) * this.cellSize;
        const py = this.offsetY + (y + 0.5) * this.cellSize;

        let rotation = cell.rotation;
        if (cell.rotationAnimation) {
          const { startTime, startRotation, targetRotation } = cell.rotationAnimation;
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / 200);
          const eased = 1 - Math.pow(1 - progress, 3);
          rotation = ((startRotation + (targetRotation - startRotation) * eased) % 4) as Direction;
        }

        this.drawPipe(this.ctx, cell.pipeType, rotation, px, py, this.cellSize * 0.8, false);
      }
    }
  }

  private drawPipe(
    ctx: CanvasRenderingContext2D,
    type: PipeType,
    rotation: Direction,
    cx: number,
    cy: number,
    size: number,
    isPreview: boolean
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 2);

    const halfSize = size / 2;
    const pipeWidth = size * 0.3;

    ctx.strokeStyle = isPreview ? 'rgba(148, 163, 184, 0.5)' : COLORS.pipeStroke;
    ctx.fillStyle = isPreview ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;

    const connections = PIPE_CONNECTIONS[type];

    ctx.beginPath();

    switch (type) {
      case 'straight':
      case 'valve':
        ctx.rect(-pipeWidth / 2, -halfSize, pipeWidth, size);
        if (type === 'valve') {
          ctx.arc(0, 0, pipeWidth * 0.4, 0, Math.PI * 2);
        }
        break;

      case 'curve':
        ctx.moveTo(-pipeWidth / 2, -halfSize);
        ctx.lineTo(-pipeWidth / 2, -pipeWidth / 2);
        ctx.quadraticCurveTo(-pipeWidth / 2, -pipeWidth / 2, -pipeWidth / 2, -pipeWidth / 2);
        ctx.lineTo(halfSize, -pipeWidth / 2);
        ctx.lineTo(halfSize, pipeWidth / 2);
        ctx.lineTo(pipeWidth / 2, pipeWidth / 2);
        ctx.lineTo(pipeWidth / 2, -halfSize);
        ctx.closePath();
        break;

      case 'tee':
        ctx.rect(-halfSize, -pipeWidth / 2, size, pipeWidth);
        ctx.rect(-pipeWidth / 2, 0, pipeWidth, halfSize);
        break;
    }

    ctx.fill();
    ctx.stroke();

    if (type === 'valve') {
      ctx.strokeStyle = isPreview ? 'rgba(100, 100, 100, 0.5)' : '#666';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-pipeWidth * 0.3, -pipeWidth * 0.3);
      ctx.lineTo(pipeWidth * 0.3, pipeWidth * 0.3);
      ctx.moveTo(pipeWidth * 0.3, -pipeWidth * 0.3);
      ctx.lineTo(-pipeWidth * 0.3, pipeWidth * 0.3);
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderWaterTower(grid: GridCell[][]): void {
    for (const row of grid) {
      for (const cell of row) {
        if (!cell.isWaterSource) continue;

        const px = this.offsetX + (cell.x + 0.5) * this.cellSize;
        const py = this.offsetY + (cell.y + 0.5) * this.cellSize;
        const size = this.cellSize * 0.8;

        this.ctx.save();

        const time = performance.now() / 1000;
        const pulse = 0.8 + Math.sin(time * 3) * 0.2;

        const gradient = this.ctx.createRadialGradient(px, py, 0, px, py, size);
        gradient.addColorStop(0, `rgba(59, 130, 246, ${0.6 * pulse})`);
        gradient.addColorStop(0.5, `rgba(59, 130, 246, ${0.3 * pulse})`);
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(px, py, size, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#4A5568';
        this.ctx.fillRect(px - size * 0.3, py - size * 0.1, size * 0.6, size * 0.5);

        this.ctx.fillStyle = '#2D3748';
        this.ctx.beginPath();
        this.ctx.moveTo(px - size * 0.4, py - size * 0.1);
        this.ctx.lineTo(px, py - size * 0.4);
        this.ctx.lineTo(px + size * 0.4, py - size * 0.1);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.fillStyle = COLORS.sourceBlue;
        this.ctx.globalAlpha = 0.8;
        this.ctx.beginPath();
        this.ctx.arc(px, py - size * 0.05, size * 0.2, 0, Math.PI * 2);
        this.ctx.fill();

        for (let i = 0; i < 5; i++) {
          const angle = (time * 2 + i * 1.256) % (Math.PI * 2);
          const radius = size * 0.3 + (Math.sin(time * 4 + i) + 1) * size * 0.1;
          const px1 = px + Math.cos(angle) * radius;
          const py1 = py - size * 0.05 + Math.sin(angle) * radius * 0.5;

          this.ctx.fillStyle = COLORS.sourceBlue;
          this.ctx.globalAlpha = 0.6 + Math.sin(time * 5 + i) * 0.4;
          this.ctx.beginPath();
          this.ctx.arc(px1, py1, 3, 0, Math.PI * 2);
          this.ctx.fill();
        }

        this.ctx.restore();
        this.drawPipe(this.ctx, cell.pipeType!, cell.rotation, px, py, size, false);
      }
    }
  }

  private renderTarget(grid: GridCell[][]): void {
    for (const row of grid) {
      for (const cell of row) {
        if (!cell.isTarget) continue;

        const px = this.offsetX + (cell.x + 0.5) * this.cellSize;
        const py = this.offsetY + (cell.y + 0.5) * this.cellSize;
        const size = this.cellSize * 0.8;
        const time = performance.now() / 1000;

        this.ctx.save();

        const glowGradient = this.ctx.createRadialGradient(px, py, 0, px, py, size);
        glowGradient.addColorStop(0, 'rgba(255, 215, 0, 0.5)');
        glowGradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.2)');
        glowGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

        this.ctx.fillStyle = glowGradient;
        this.ctx.beginPath();
        this.ctx.arc(px, py, size * (1 + Math.sin(time * 2) * 0.1), 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#C9A96E';
        this.ctx.fillRect(px - size * 0.4, py - size * 0.3, size * 0.8, size * 0.6);

        this.ctx.fillStyle = '#8B4513';
        this.ctx.beginPath();
        this.ctx.moveTo(px - size * 0.45, py - size * 0.3);
        this.ctx.lineTo(px, py - size * 0.55);
        this.ctx.lineTo(px + size * 0.45, py - size * 0.3);
        this.ctx.closePath();
        this.ctx.fill();

        const entranceGradient = this.ctx.createRadialGradient(px, py + size * 0.05, 0, px, py + size * 0.05, size * 0.25);
        entranceGradient.addColorStop(0, COLORS.targetGold);
        entranceGradient.addColorStop(1, '#B8860B');

        this.ctx.fillStyle = entranceGradient;
        this.ctx.beginPath();
        this.ctx.arc(px, py + size * 0.05, size * 0.22, Math.PI, 0);
        this.ctx.rect(px - size * 0.22, py + size * 0.05, size * 0.44, size * 0.2);
        this.ctx.fill();

        this.ctx.fillStyle = COLORS.targetGold;
        this.ctx.globalAlpha = 0.8 + Math.sin(time * 3) * 0.2;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + time;
          const rx = px + Math.cos(angle) * size * 0.35;
          const ry = py + Math.sin(angle) * size * 0.35;
          this.ctx.beginPath();
          this.ctx.arc(rx, ry, 2, 0, Math.PI * 2);
          this.ctx.fill();
        }

        this.ctx.restore();
        this.drawPipe(this.ctx, cell.pipeType!, cell.rotation, px, py, size, false);
      }
    }
  }

  private renderParticles(particles: WaterParticle[]): void {
    for (const p of particles) {
      const px = this.offsetX + p.x * this.cellSize;
      const py = this.offsetY + p.y * this.cellSize;

      this.ctx.save();

      const glowGradient = this.ctx.createRadialGradient(px, py, 0, px, py, 8);
      glowGradient.addColorStop(0, p.color);
      glowGradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

      this.ctx.fillStyle = glowGradient;
      this.ctx.globalAlpha = 0.3;
      this.ctx.beginPath();
      this.ctx.arc(px, py, 8, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = p.color;
      this.ctx.globalAlpha = 0.9;
      this.ctx.beginPath();
      this.ctx.arc(px, py, 2, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }
  }

  private renderSplashes(splashes: WaterSplash[]): void {
    for (const s of splashes) {
      const px = this.offsetX + (s.x + 0.5) * this.cellSize;
      const py = this.offsetY + (s.y + 0.5) * this.cellSize;

      this.ctx.save();
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      this.ctx.globalAlpha = s.life / s.maxLife;
      this.ctx.beginPath();
      this.ctx.arc(px, py, s.size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  private renderWaterWheel(cx: number, cy: number, rotation: number): void {
    const px = this.offsetX + cx * this.cellSize;
    const py = this.offsetY + cy * this.cellSize - this.cellSize * 0.8;
    const radius = this.cellSize * 0.5;

    this.ctx.save();

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    this.ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const offset = (i * 8) % 20;
      this.ctx.beginPath();
      this.ctx.moveTo(px + radius * 0.3 - 10 + offset, py - radius * 0.5);
      this.ctx.quadraticCurveTo(
        px + radius * 0.3 - 5 + offset,
        py + radius * 0.3,
        px + radius * 0.3 + offset,
        py + radius * 0.8
      );
      this.ctx.stroke();
    }

    this.ctx.translate(px, py);
    this.ctx.rotate(rotation);

    this.ctx.fillStyle = '#8B4513';
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius * 0.15, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = '#A0522D';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      this.ctx.save();
      this.ctx.rotate(angle);
      this.ctx.fillStyle = '#654321';
      this.ctx.fillRect(radius * 0.15, -4, radius * 0.85, 8);
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private renderHoverPreview(pipeType: PipeType): void {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = this.lastMouseX - rect.left;
    const mouseY = this.lastMouseY - rect.top;

    const gridPos = this.getGridPosition(this.lastMouseX, this.lastMouseY);
    if (!gridPos) return;

    const px = this.offsetX + (gridPos.x + 0.5) * this.cellSize;
    const py = this.offsetY + (gridPos.y + 0.5) * this.cellSize;

    this.ctx.save();
    this.ctx.globalAlpha = 0.5;
    this.drawPipe(this.ctx, pipeType, 0, px, py, this.cellSize * 0.8, true);
    this.ctx.restore();

    this.lastMouseX = mouseX + rect.left;
    this.lastMouseY = mouseY + rect.top;
  }

  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  updateMousePosition(x: number, y: number): void {
    this.lastMouseX = x;
    this.lastMouseY = y;
  }

  invalidateStaticCache(): void {
    this.staticCacheDirty = true;
  }
}
