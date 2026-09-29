import type { Player } from './player';

const CANVAS_SIZE = 400;

export interface Star {
  x: number;
  y: number;
  size: number;
}

export function generateStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * CANVAS_SIZE,
      y: Math.random() * CANVAS_SIZE,
      size: Math.random() * 1.5 + 0.5
    });
  }
  return stars;
}

export function drawBackground(ctx: CanvasRenderingContext2D, stars: Star[]): void {
  const gradient = ctx.createRadialGradient(
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
    0,
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
    CANVAS_SIZE * 0.7
  );
  gradient.addColorStop(0, '#1F2833');
  gradient.addColorStop(1, '#0B0C10');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  for (const star of stars) {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
  }
}

export function drawHUD(ctx: CanvasRenderingContext2D, player: Player): void {
  ctx.font = '14px "Courier New", monospace';

  for (let i = 0; i < player.maxHealth; i++) {
    const x = 15 + i * 24;
    const y = 22;
    if (i < player.health) {
      drawHeart(ctx, x, y, '#FF2A2A');
    } else {
      drawHeart(ctx, x, y, 'rgba(255, 42, 42, 0.25)');
    }
  }

  ctx.fillStyle = '#C5C6C7';
  ctx.textAlign = 'right';
  ctx.fillText(`积分: ${player.score}`, CANVAS_SIZE - 15, 25);

  if (player.shieldCount > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#66FCF1';
    ctx.fillText(`护盾: ${player.shieldCount}`, CANVAS_SIZE - 15, 45);
  }

  const barWidth = 200;
  const barHeight = 10;
  const barX = (CANVAS_SIZE - barWidth) / 2;
  const barY = CANVAS_SIZE - 22;

  ctx.fillStyle = 'rgba(31, 40, 51, 0.8)';
  ctx.fillRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);

  const fuelRatio = player.fuel / player.maxFuel;
  const fuelGradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
  fuelGradient.addColorStop(0, '#00B4D8');
  fuelGradient.addColorStop(1, '#03045E');
  ctx.fillStyle = fuelGradient;
  ctx.fillRect(barX, barY, barWidth * fuelRatio, barHeight);

  ctx.strokeStyle = '#45A29E';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  ctx.fillStyle = '#C5C6C7';
  ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('燃料', CANVAS_SIZE / 2, barY - 4);
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.beginPath();
  const size = 8;
  ctx.moveTo(cx, cy + size / 4);
  ctx.bezierCurveTo(cx, cy, cx - size / 2, cy, cx - size / 2, cy + size / 4);
  ctx.bezierCurveTo(cx - size / 2, cy + size / 2, cx, cy + size * 0.7, cx, cy + size);
  ctx.bezierCurveTo(cx, cy + size * 0.7, cx + size / 2, cy + size / 2, cx + size / 2, cy + size / 4);
  ctx.bezierCurveTo(cx + size / 2, cy, cx, cy, cx, cy + size / 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
