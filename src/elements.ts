export type ElementType = 'fire' | 'water' | 'wind' | 'earth' | 'light' | 'dark';

export interface ElementConfig {
  type: ElementType;
  name: string;
  colorStart: string;
  colorEnd: string;
  nameCN: string;
}

export const ELEMENT_CONFIGS: Record<ElementType, ElementConfig> = {
  fire: { type: 'fire', name: 'Fire', colorStart: '#ff4500', colorEnd: '#ffa500', nameCN: '火元素' },
  water: { type: 'water', name: 'Water', colorStart: '#00bfff', colorEnd: '#1e90ff', nameCN: '水元素' },
  wind: { type: 'wind', name: 'Wind', colorStart: '#98fb98', colorEnd: '#3cb371', nameCN: '风元素' },
  earth: { type: 'earth', name: 'Earth', colorStart: '#8b4513', colorEnd: '#d2691e', nameCN: '土元素' },
  light: { type: 'light', name: 'Light', colorStart: '#ffffe0', colorEnd: '#fffacd', nameCN: '光元素' },
  dark: { type: 'dark', name: 'Dark', colorStart: '#4b0082', colorEnd: '#8a2be2', nameCN: '暗元素' }
};

export class ElementBall {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  isDragging: boolean;
  isHovered: boolean;
  floatOffset: number;
  floatSpeed: number;
  floatPhase: number;
  homeX: number;
  homeY: number;
  inCauldron: boolean;
  config: ElementConfig;
  glowIntensity: number;

  constructor(type: ElementType, x: number, y: number) {
    this.id = Math.random().toString(36).slice(2);
    this.type = type;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.baseRadius = 30;
    this.isDragging = false;
    this.isHovered = false;
    this.floatOffset = 0;
    this.floatSpeed = 1.5 + Math.random();
    this.floatPhase = Math.random() * Math.PI * 2;
    this.homeX = x;
    this.homeY = y;
    this.inCauldron = false;
    this.config = ELEMENT_CONFIGS[type];
    this.glowIntensity = 0;
  }

  get displayRadius(): number {
    if (this.isDragging) return this.baseRadius * 1.2;
    if (this.isHovered) return this.baseRadius * 1.1;
    return this.baseRadius;
  }

  update(deltaTime: number, _time: number): void {
    const dt = deltaTime / 1000;

    if (!this.isDragging && !this.inCauldron) {
      this.floatPhase += dt * this.floatSpeed;
      this.floatOffset = Math.sin(this.floatPhase) * 3;
    }

    if (this.isDragging) {
      this.glowIntensity = Math.min(1, this.glowIntensity + dt * 3);
    } else {
      this.glowIntensity = Math.max(0, this.glowIntensity - dt * 3);
    }
  }

  containsPoint(px: number, py: number): boolean {
    const dx = px - this.x;
    const dy = py - (this.y + this.floatOffset);
    return dx * dx + dy * dy <= this.displayRadius * this.displayRadius;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const cy = this.y + this.floatOffset;
    const r = this.displayRadius;

    ctx.save();

    if (this.isDragging && this.glowIntensity > 0) {
      const glowR = r * (1.5 + this.glowIntensity * 0.5);
      const gradient = ctx.createRadialGradient(this.x, cy, r * 0.5, this.x, cy, glowR);
      gradient.addColorStop(0, this.config.colorEnd + '80');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = this.glowIntensity * 0.6;
      ctx.beginPath();
      ctx.arc(this.x, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const gradient = ctx.createRadialGradient(
      this.x - r * 0.3, cy - r * 0.3, 0,
      this.x, cy, r
    );
    gradient.addColorStop(0, this.config.colorEnd + 'cc');
    gradient.addColorStop(0.5, this.config.colorStart + '99');
    gradient.addColorStop(1, this.config.colorStart + '66');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.x, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = this.config.colorEnd + 'aa';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.x - r * 0.25, cy - r * 0.3, r * 0.3, 0, Math.PI * 2);
    const highlight = ctx.createRadialGradient(
      this.x - r * 0.25, cy - r * 0.3, 0,
      this.x - r * 0.25, cy - r * 0.3, r * 0.3
    );
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlight;
    ctx.fill();

    if (this.isHovered && !this.isDragging) {
      this.renderTooltip(ctx, cy, r);
    }

    ctx.restore();
  }

  private renderTooltip(ctx: CanvasRenderingContext2D, cy: number, r: number): void {
    const text = this.config.nameCN;
    ctx.font = '14px "Georgia", serif';
    const metrics = ctx.measureText(text);
    const padding = 8;
    const boxWidth = metrics.width + padding * 2;
    const boxHeight = 26;
    const boxX = this.x - boxWidth / 2;
    const boxY = cy - r - boxHeight - 8;
    const radius = 6;

    ctx.fillStyle = 'rgba(20, 15, 10, 0.85)';
    ctx.strokeStyle = this.config.colorEnd + '80';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX + radius, boxY);
    ctx.lineTo(boxX + boxWidth - radius, boxY);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    ctx.lineTo(boxX + radius, boxY + boxHeight);
    ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    ctx.lineTo(boxX, boxY + radius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f0e6d2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.x, boxY + boxHeight / 2 + 1);
  }

  reset(): void {
    this.x = this.homeX;
    this.y = this.homeY;
    this.vx = 0;
    this.vy = 0;
    this.inCauldron = false;
    this.isDragging = false;
  }
}
