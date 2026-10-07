import type { Piece, Particle, HaloEffect } from './types';
import {
  BOARD_SIZE,
  CELL_SIZE,
  PIECE_RADIUS,
  COLORS,
  PIECE_STATS,
} from './types';

export function drawFeltBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.fillStyle = COLORS.parchment;
  ctx.fillRect(0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const noise1 = (Math.random() - 0.5) * 15;
    const noise2 = (Math.random() - 0.5) * 10;
    const noise3 = (Math.random() - 0.5) * 8;

    data[i] = Math.min(255, Math.max(0, data[i] + noise1));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise2));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise3));
  }

  ctx.putImageData(imageData, 0, 0);

  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    width * 0.7
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(43, 26, 14, 0.2)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  scale: number = 1
): void {
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5 / scale;

  const totalWidth = BOARD_SIZE * CELL_SIZE;
  const totalHeight = BOARD_SIZE * CELL_SIZE;

  for (let i = 0; i <= BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL_SIZE, 0);
    ctx.lineTo(i * CELL_SIZE, totalHeight);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * CELL_SIZE);
    ctx.lineTo(totalWidth, i * CELL_SIZE);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  opacity: number = 1
): void {
  if (piece.status === 'dead') return;

  ctx.save();
  ctx.globalAlpha = opacity;

  const borderColor = piece.side === 'player' ? COLORS.player : COLORS.ai;
  const fillColor = piece.side === 'player' ? '#dbeafe' : '#fee2e2';

  ctx.beginPath();
  ctx.arc(piece.x, piece.y, PIECE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(piece.x, piece.y, PIECE_RADIUS - 4, 0, Math.PI * 2);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  const icon = PIECE_STATS[piece.type].icon;
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = borderColor;
  ctx.fillText(icon, piece.x, piece.y + 1);

  ctx.restore();
}

export function drawHalo(
  ctx: CanvasRenderingContext2D,
  halo: HaloEffect,
  currentTime: number
): void {
  const elapsed = currentTime - halo.startTime;
  const progress = Math.min(1, elapsed / halo.duration);

  if (progress >= 1) return;

  ctx.save();
  const alpha = (1 - progress) * 0.8;
  const radius = halo.radius * (0.5 + progress * 0.5);

  const gradient = ctx.createRadialGradient(
    halo.x,
    halo.y,
    0,
    halo.x,
    halo.y,
    radius
  );
  gradient.addColorStop(0, `${hexToRgba(halo.color, alpha * 0.8)}`);
  gradient.addColorStop(0.5, `${hexToRgba(halo.color, alpha * 0.4)}`);
  gradient.addColorStop(1, `${hexToRgba(halo.color, 0)}`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(halo.x, halo.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawParticle(
  ctx: CanvasRenderingContext2D,
  particle: Particle,
  currentTime: number
): void {
  const progress = 1 - particle.life / particle.maxLife;
  const alpha = 1 - progress;
  const size = particle.size * (1 + progress * 0.5);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = particle.color;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number = 20
): void {
  ctx.save();
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x - size / 2, y - size / 2);
  ctx.lineTo(x + size / 2, y + size / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + size / 2, y - size / 2);
  ctx.lineTo(x - size / 2, y + size / 2);
  ctx.stroke();
  ctx.restore();
}

export function drawFormationText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  progress: number
): void {
  const alpha = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;
  const scale = 1 + Math.sin(progress * Math.PI) * 0.1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = 'bold 72px "Ma Shan Zheng", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = COLORS.darkBrown;
  ctx.fillText(text, 3, 3);

  ctx.fillStyle = COLORS.gold;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function drawResultBanner(
  ctx: CanvasRenderingContext2D,
  text: string,
  subText: string,
  width: number,
  progress: number
): void {
  const y = 60;
  const alpha = Math.min(1, progress * 2);

  ctx.save();
  ctx.globalAlpha = alpha;

  const gradient = ctx.createLinearGradient(0, y - 40, 0, y + 40);
  gradient.addColorStop(0, 'rgba(43, 26, 14, 0.95)');
  gradient.addColorStop(0.5, 'rgba(43, 26, 14, 0.9)');
  gradient.addColorStop(1, 'rgba(43, 26, 14, 0.95)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y - 40, width, 80);

  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, y - 40, width, 80);

  ctx.font = 'bold 36px "Ma Shan Zheng", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.gold;
  ctx.fillText(text, width / 2, y - 10);

  ctx.font = '20px "Ma Shan Zheng", serif';
  ctx.fillStyle = COLORS.parchment;
  ctx.fillText(subText, width / 2, y + 20);

  ctx.restore();
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function createInkParticles(
  x: number,
  y: number,
  count: number = 15
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 60;
    particles.push({
      id: `particle-${Date.now()}-${i}`,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 20,
      life: 800,
      maxLife: 800,
      size: 2 + Math.random() * 4,
      color: COLORS.ink,
    });
  }
  return particles;
}

export function updateParticles(
  particles: Particle[],
  deltaTime: number
): Particle[] {
  return particles
    .map((p) => ({
      ...p,
      x: p.x + p.vx * deltaTime,
      y: p.y + p.vy * deltaTime,
      vy: p.vy + 100 * deltaTime,
      life: p.life - deltaTime * 1000,
    }))
    .filter((p) => p.life > 0);
}
