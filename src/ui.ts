import { ElementType } from './elements';
import { SynthesisLog } from './cauldron';

export interface SlotPosition {
  x: number;
  y: number;
  elementType: ElementType;
}

export class UIManager {
  private canvasWidth: number;
  private canvasHeight: number;
  private slotPhase: number = 0;
  private logs: (SynthesisLog & { animProgress: number })[] = [];
  private readonly MAX_LOGS = 8;

  constructor(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  addLog(log: SynthesisLog): void {
    this.logs.push({ ...log, animProgress: 0 });
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
  }

  update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    this.slotPhase += dt * 1.5;

    for (const log of this.logs) {
      log.animProgress = Math.min(1, log.animProgress + dt / 0.3);
    }
  }

  getSlotPositions(): SlotPosition[] {
    const types: ElementType[] = ['fire', 'water', 'wind', 'earth', 'light', 'dark'];
    const startY = this.canvasHeight * 0.2;
    const spacing = 100;
    const x = 90;

    return types.map((type, i) => ({
      x,
      y: startY + i * spacing,
      elementType: type
    }));
  }

  renderBackground(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2a1f14';
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    for (let i = 0; i < 30; i++) {
      const x = (i * 137) % this.canvasWidth;
      const y = (i * 89) % this.canvasHeight;
      const w = 80 + (i % 5) * 30;
      const h = 20 + (i % 3) * 10;
      ctx.fillStyle = `rgba(60, 40, 25, ${0.05 + (i % 3) * 0.02})`;
      ctx.fillRect(x, y, w, h);
    }

    const vignette = ctx.createRadialGradient(
      this.canvasWidth / 2, this.canvasHeight / 2, Math.min(this.canvasWidth, this.canvasHeight) * 0.3,
      this.canvasWidth / 2, this.canvasHeight / 2, Math.max(this.canvasWidth, this.canvasHeight) * 0.8
    );
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  renderElementRack(ctx: CanvasRenderingContext2D, occupiedSlots: Set<ElementType>): void {
    const slots = this.getSlotPositions();

    const panelX = 30;
    const panelY = slots[0].y - 60;
    const panelW = 120;
    const panelH = slots.length * 100 + 80;

    const panelGradient = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY);
    panelGradient.addColorStop(0, 'rgba(50, 35, 20, 0.9)');
    panelGradient.addColorStop(0.5, 'rgba(65, 48, 30, 0.95)');
    panelGradient.addColorStop(1, 'rgba(50, 35, 20, 0.9)');
    ctx.fillStyle = panelGradient;
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.fill();

    ctx.strokeStyle = 'rgba(120, 90, 60, 0.6)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.stroke();

    ctx.fillStyle = '#d4b896';
    ctx.font = 'bold 16px "Georgia", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('元素架', panelX + panelW / 2, panelY + 25);

    for (const slot of slots) {
      this.renderSlot(ctx, slot.x, slot.y, occupiedSlots.has(slot.elementType));
    }
  }

  private renderSlot(ctx: CanvasRenderingContext2D, x: number, y: number, occupied: boolean): void {
    ctx.save();

    const depthGradient = ctx.createRadialGradient(x, y, 0, x, y, 45);
    depthGradient.addColorStop(0, 'rgba(10, 8, 5, 0.9)');
    depthGradient.addColorStop(0.7, 'rgba(30, 22, 15, 0.7)');
    depthGradient.addColorStop(1, 'rgba(50, 38, 25, 0.5)');
    ctx.fillStyle = depthGradient;
    ctx.beginPath();
    ctx.arc(x, y, 42, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(80, 60, 40, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 42, 0, Math.PI * 2);
    ctx.stroke();

    if (!occupied) {
      const pulseAlpha = 0.3 + Math.sin(this.slotPhase) * 0.15;
      ctx.strokeStyle = `rgba(100, 180, 255, ${pulseAlpha})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = `rgba(100, 180, 255, ${pulseAlpha})`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  renderSynthesisLog(ctx: CanvasRenderingContext2D): void {
    const panelX = this.canvasWidth - 300;
    const panelY = 30;
    const panelW = 270;
    const titleHeight = 45;
    const logHeight = 50;
    const padding = 10;
    const maxVisibleLogs = 5;
    const visibleLogs = this.logs.slice(-maxVisibleLogs);
    const panelH = titleHeight + visibleLogs.length * (logHeight + padding) + padding;

    ctx.save();

    const panelGradient = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY);
    panelGradient.addColorStop(0, 'rgba(50, 35, 20, 0.85)');
    panelGradient.addColorStop(0.5, 'rgba(65, 48, 30, 0.92)');
    panelGradient.addColorStop(1, 'rgba(50, 35, 20, 0.85)');
    ctx.fillStyle = panelGradient;
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.fill();

    ctx.strokeStyle = 'rgba(120, 90, 60, 0.6)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.stroke();

    ctx.fillStyle = '#d4b896';
    ctx.font = 'bold 16px "Georgia", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('合成日志', panelX + panelW / 2, panelY + titleHeight / 2);

    ctx.strokeStyle = 'rgba(120, 90, 60, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + 15, panelY + titleHeight);
    ctx.lineTo(panelX + panelW - 15, panelY + titleHeight);
    ctx.stroke();

    visibleLogs.forEach((log, index) => {
      const logY = panelY + titleHeight + padding + index * (logHeight + padding);
      this.renderLogItem(ctx, panelX + padding, logY, panelW - padding * 2, logHeight, log);
    });

    ctx.restore();
  }

  private renderLogItem(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    log: SynthesisLog & { animProgress: number }
  ): void {
    const offsetY = (1 - log.animProgress) * 20;
    const alpha = log.animProgress;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, offsetY);

    const itemGradient = ctx.createLinearGradient(x, y, x, y + h);
    itemGradient.addColorStop(0, 'rgba(80, 60, 40, 0.6)');
    itemGradient.addColorStop(1, 'rgba(60, 45, 30, 0.6)');
    ctx.fillStyle = itemGradient;
    this.roundRect(ctx, x, y, w, h, 6);
    ctx.fill();

    ctx.fillStyle = log.color;
    ctx.shadowColor = log.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x + 15, y + h / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    const timestamp = new Date(log.timestamp);
    const timeStr = `${timestamp.getHours().toString().padStart(2, '0')}:${timestamp.getMinutes().toString().padStart(2, '0')}:${timestamp.getSeconds().toString().padStart(2, '0')}`;
    ctx.fillStyle = '#a08870';
    ctx.font = '11px "Consolas", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(timeStr, x + 30, y + 6);

    ctx.fillStyle = '#e8dcc8';
    ctx.font = '12px "Georgia", serif';
    const maxTextWidth = w - 40;
    const text = this.truncateText(ctx, log.result, maxTextWidth);
    ctx.fillText(text, x + 30, y + 24);

    ctx.restore();
  }

  private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '…';
  }

  renderTitle(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#d4b896';
    ctx.font = 'bold 28px "Georgia", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('魔法元素调和实验台', this.canvasWidth / 2, 25);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#8a7560';
    ctx.font = '13px "Georgia", serif';
    ctx.fillText('拖拽元素球到坩埚中观察魔法反应', this.canvasWidth / 2, 60);

    ctx.restore();
  }

  renderFpsCounter(ctx: CanvasRenderingContext2D, fps: number, particleCount: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(20, 15, 10, 0.7)';
    this.roundRect(ctx, 10, this.canvasHeight - 35, 160, 25, 5);
    ctx.fill();

    ctx.fillStyle = fps >= 50 ? '#7fff7f' : fps >= 30 ? '#ffcc66' : '#ff6666';
    ctx.font = '12px "Consolas", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`FPS: ${fps.toFixed(0)} | 粒子: ${particleCount}`, 20, this.canvasHeight - 22);

    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
