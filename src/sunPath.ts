import { Season, SunPosition } from './types';

const SEASON_COLORS: Record<Season, string> = {
  spring: '#7fff7f',
  summer: '#ff6b6b',
  autumn: '#ffd93d',
  winter: '#6bcfff'
};

export class SunPathRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private centerX: number;
  private centerY: number;
  private radius: number;

  private lastRenderTime: number = 0;
  private renderInterval: number = 100;

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Canvas element with id "${canvasId}" not found`);
    }
    this.canvas = canvas;
    this.ctx = this.canvas.getContext('2d')!;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) * 0.42;
  }

  public update(
    currentPosition: SunPosition,
    currentSeason: Season,
    pathPoints: Record<Season, { x: number; y: number }[]>
  ): void {
    const now = performance.now();
    if (now - this.lastRenderTime < this.renderInterval) {
      return;
    }
    this.lastRenderTime = now;
    this.render(currentPosition, currentSeason, pathPoints);
  }

  private render(
    currentPosition: SunPosition,
    currentSeason: Season,
    pathPoints: Record<Season, { x: number; y: number }[]>
  ): void {
    const ctx = this.ctx;
    
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawSkyDome();
    this.drawCompass();

    const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];
    seasons.forEach(season => {
      this.drawPath(pathPoints[season], SEASON_COLORS[season], season === currentSeason);
    });

    this.drawSun(currentPosition, SEASON_COLORS[currentSeason]);
  }

  private drawSkyDome(): void {
    const ctx = this.ctx;
    
    const gradient = ctx.createRadialGradient(
      this.centerX, this.centerY, 0,
      this.centerX, this.centerY, this.radius
    );
    gradient.addColorStop(0, 'rgba(100, 150, 255, 0.3)');
    gradient.addColorStop(0.5, 'rgba(60, 100, 200, 0.2)');
    gradient.addColorStop(1, 'rgba(30, 50, 100, 0.1)');

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = 'rgba(142, 45, 226, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    for (let i = 1; i < 4; i++) {
      const r = (this.radius * i) / 3;
      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(this.centerX - this.radius, this.centerY);
    ctx.lineTo(this.centerX + this.radius, this.centerY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(this.centerX, this.centerY - this.radius);
    ctx.lineTo(this.centerX, this.centerY + this.radius);
    ctx.stroke();
  }

  private drawCompass(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('N', this.centerX, this.centerY - this.radius - 10);
    ctx.fillText('S', this.centerX, this.centerY + this.radius + 10);
    ctx.fillText('E', this.centerX + this.radius + 10, this.centerY);
    ctx.fillText('W', this.centerX - this.radius - 10, this.centerY);
  }

  private drawPath(points: { x: number; y: number }[], color: string, isActive: boolean): void {
    if (points.length < 2) return;

    const ctx = this.ctx;
    
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 2.5 : 1.5;
    ctx.globalAlpha = isActive ? 0.9 : 0.5;

    const firstPoint = points[0];
    ctx.moveTo(
      this.centerX + (firstPoint.x - 0.5) * this.radius * 2,
      this.centerY + (firstPoint.y - 0.5) * this.radius * 2
    );

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      ctx.lineTo(
        this.centerX + (p.x - 0.5) * this.radius * 2,
        this.centerY + (p.y - 0.5) * this.radius * 2
      );
    }

    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawSun(position: SunPosition, color: string): void {
    const ctx = this.ctx;
    
    const elevationRad = (position.elevation * Math.PI) / 180;
    const azimuthRad = (position.azimuth * Math.PI) / 180;
    
    const r = (1 - position.elevation / 90) * this.radius;
    const theta = azimuthRad - Math.PI / 2;
    
    const x = this.centerX + r * Math.cos(theta);
    const y = this.centerY + r * Math.sin(theta);

    if (position.elevation <= 0) {
      return;
    }

    const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, 18);
    glowGradient.addColorStop(0, 'rgba(255, 255, 150, 0.8)');
    glowGradient.addColorStop(0.5, 'rgba(255, 220, 100, 0.4)');
    glowGradient.addColorStop(1, 'rgba(255, 200, 50, 0)');

    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = glowGradient;
    ctx.fill();

    const sunGradient = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 8);
    sunGradient.addColorStop(0, '#ffffff');
    sunGradient.addColorStop(0.3, '#ffff88');
    sunGradient.addColorStop(1, color);

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = sunGradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.centerX = width / 2;
    this.centerY = height / 2;
    this.radius = Math.min(width, height) * 0.42;
  }
}
