import { Animal, FloatingText, ANIMAL_CONFIG, ALL_ANIMALS } from './types';
import { Ecosystem } from './ecosystem';

const MAP_WIDTH = 800;
const MAP_HEIGHT = 800;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private ecosystem: Ecosystem;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private displayScale: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;

  constructor(canvas: HTMLCanvasElement, ecosystem: Ecosystem) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.ecosystem = ecosystem;

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = MAP_WIDTH;
    this.offscreenCanvas.height = MAP_HEIGHT;
    const offCtx = this.offscreenCanvas.getContext('2d');
    if (!offCtx) throw new Error('Offscreen canvas context not available');
    this.offscreenCtx = offCtx;

    this.renderBackground();
    this.resize(canvas.width, canvas.height);
  }

  resize(width: number, height: number): void {
    const minDim = Math.min(width, height);
    this.displayScale = minDim / MAP_WIDTH;
    this.offsetX = (width - MAP_WIDTH * this.displayScale) / 2;
    this.offsetY = (height - MAP_HEIGHT * this.displayScale) / 2;
  }

  private renderBackground(): void {
    const ctx = this.offscreenCtx;

    const gradient = ctx.createLinearGradient(0, 0, 0, MAP_HEIGHT);
    gradient.addColorStop(0, '#5a8c32');
    gradient.addColorStop(0.5, '#4a7c23');
    gradient.addColorStop(1, '#2d5016');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= MAP_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= MAP_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_WIDTH, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * MAP_WIDTH;
      const y = Math.random() * MAP_HEIGHT;
      const size = 2 + Math.random() * 4;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  render(): void {
    const ctx = this.ctx;
    const canvas = ctx.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.displayScale, this.displayScale);

    ctx.drawImage(this.offscreenCanvas, 0, 0);

    const plantDensity = this.ecosystem.getPlantDensity();
    ctx.fillStyle = `rgba(76, 175, 80, ${plantDensity * 0.3})`;
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    const animals = this.ecosystem.getAnimals();
    for (const animal of animals) {
      this.drawAnimal(ctx, animal);
    }

    const floatingTexts = this.ecosystem.getFloatingTexts();
    for (const ft of floatingTexts) {
      this.drawFloatingText(ctx, ft);
    }

    this.drawBarChart(ctx);

    ctx.restore();
  }

  private drawAnimal(ctx: CanvasRenderingContext2D, animal: Animal): void {
    ctx.save();
    ctx.translate(animal.x, animal.y);

    const config = ANIMAL_CONFIG[animal.type];
    let alpha = 1;

    if (animal.isDying) {
      const flash = Math.sin(animal.deathAnimation * 20) > 0;
      alpha = flash ? 0.3 : 0.8;
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = animal.color;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;

    const size = animal.size;

    switch (config.shape) {
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(-size * 0.3, -size * 0.2, 1.5, 0, Math.PI * 2);
        ctx.arc(size * 0.3, -size * 0.2, 1.5, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size, 0);
        ctx.lineTo(0, size);
        ctx.lineTo(-size, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'rect':
        ctx.beginPath();
        ctx.rect(-size * 0.8, -size * 0.5, size * 1.6, size);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-size * 0.4, -size * 0.5);
        ctx.lineTo(-size * 0.5, -size * 0.9);
        ctx.moveTo(size * 0.4, -size * 0.5);
        ctx.lineTo(size * 0.5, -size * 0.9);
        ctx.strokeStyle = animal.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        break;

      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(-size * 0.25, -size * 0.1, 1, 0, Math.PI * 2);
        ctx.arc(size * 0.25, -size * 0.1, 1, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'pentagon':
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
          const x = Math.cos(angle) * size * 0.8;
          const y = Math.sin(angle) * size * 0.8;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#654321';
        ctx.beginPath();
        ctx.ellipse(0, -size * 0.7, size * 0.25, size * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.8, size * 0.6);
        ctx.lineTo(-size * 0.8, size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.arc(-size * 0.25, 0, 2, 0, Math.PI * 2);
        ctx.arc(size * 0.25, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'trapezoid':
        ctx.beginPath();
        ctx.moveTo(-size * 0.3, -size * 0.7);
        ctx.lineTo(size * 0.3, -size * 0.7);
        ctx.lineTo(size * 0.9, size * 0.5);
        ctx.lineTo(-size * 0.9, size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-size * 0.9, 0);
        ctx.lineTo(-size * 1.4, -size * 0.3);
        ctx.moveTo(size * 0.9, 0);
        ctx.lineTo(size * 1.4, -size * 0.3);
        ctx.strokeStyle = animal.color;
        ctx.lineWidth = 4;
        ctx.stroke();
        break;

      case 'wave':
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          const x = (t - 0.5) * size * 2;
          const y = Math.sin(t * Math.PI * 3) * size * 0.3;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = size * 0.5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = animal.color;
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.stroke();
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(size * 0.8, -size * 0.2, 1.5, 0, Math.PI * 2);
        ctx.fill();
        break;
    }

    ctx.restore();

    if (!animal.isDying) {
      this.drawHungerBar(ctx, animal);
    }
  }

  private drawHungerBar(ctx: CanvasRenderingContext2D, animal: Animal): void {
    const barWidth = animal.size * 2;
    const barHeight = 3;
    const x = animal.x - barWidth / 2;
    const y = animal.y - animal.size - 8;

    const hungerRatio = animal.hunger / animal.maxHunger;
    let barColor = '#4caf50';
    if (hungerRatio > 0.7) barColor = '#f44336';
    else if (hungerRatio > 0.4) barColor = '#ff9800';

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barWidth * (1 - hungerRatio), barHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, barWidth, barHeight);
  }

  private drawFloatingText(ctx: CanvasRenderingContext2D, ft: FloatingText): void {
    ctx.save();
    ctx.globalAlpha = ft.opacity;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 14px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;

    ctx.fillText(ft.text, ft.x, ft.y - ft.offsetY);
    ctx.restore();
  }

  private drawBarChart(ctx: CanvasRenderingContext2D): void {
    const stats = this.ecosystem.getPopulationStats();
    const maxPop = this.ecosystem.getMaxPopulation();

    const chartWidth = MAP_WIDTH - 40;
    const chartHeight = 60;
    const chartX = 20;
    const chartY = MAP_HEIGHT - chartHeight - 15;
    const barWidth = (chartWidth - 40) / ALL_ANIMALS.length;
    const maxBarHeight = chartHeight - 20;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(chartX - 5, chartY - 5, chartWidth + 10, chartHeight + 10);

    ctx.fillStyle = 'rgba(30, 58, 95, 0.7)';
    ctx.fillRect(chartX, chartY, chartWidth, chartHeight);

    ALL_ANIMALS.forEach((type, index) => {
      const config = ANIMAL_CONFIG[type];
      const count = stats[type] || 0;
      const barHeight = maxBarHeight * (count / maxPop);
      const x = chartX + 20 + index * barWidth + barWidth * 0.15;
      const y = chartY + chartHeight - 10 - barHeight;
      const actualBarWidth = barWidth * 0.7;

      ctx.fillStyle = config.color;
      ctx.fillRect(x, y, actualBarWidth, barHeight);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, actualBarWidth, barHeight);

      ctx.fillStyle = 'white';
      ctx.font = '10px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(config.name, x + actualBarWidth / 2, chartY + chartHeight + 12);

      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 10px "Noto Sans SC", sans-serif';
      ctx.fillText(String(count), x + actualBarWidth / 2, y - 5);
    });
  }
}
