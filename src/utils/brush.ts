import type { DrawPoint, BrushType } from '../types';

export function calculatePressure(currentPoint: DrawPoint, prevPoint: DrawPoint | null, baseSize: number): number {
  if (!prevPoint) return 0.5;

  const dx = currentPoint.x - prevPoint.x;
  const dy = currentPoint.y - prevPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const dt = currentPoint.timestamp - prevPoint.timestamp;

  if (dt === 0) return 0.5;

  const speed = distance / dt;
  const maxSpeed = 2;
  const normalizedSpeed = Math.min(speed / maxSpeed, 1);
  const pressure = 1 - normalizedSpeed * 0.6;

  return Math.max(0.2, Math.min(1, pressure));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function drawBrushStroke(
  ctx: CanvasRenderingContext2D,
  points: DrawPoint[],
  color: string,
  baseSize: number,
  type: BrushType
) {
  if (points.length < 2) return;

  const { r, g, b } = hexToRgb(color);

  switch (type) {
    case 'brush':
      drawCalligraphyStroke(ctx, points, r, g, b, baseSize);
      break;
    case 'pencil':
      drawPencilStroke(ctx, points, r, g, b, baseSize);
      break;
    case 'spray':
      drawSprayStroke(ctx, points, r, g, b, baseSize);
      break;
  }
}

function drawCalligraphyStroke(
  ctx: CanvasRenderingContext2D,
  points: DrawPoint[],
  r: number,
  g: number,
  b: number,
  baseSize: number
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];

    const size0 = baseSize * (0.4 + p0.pressure * 0.8);
    const size1 = baseSize * (0.4 + p1.pressure * 0.8);

    const steps = Math.ceil(Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)));
    const stepCount = Math.max(steps, 1);

    for (let j = 0; j < stepCount; j++) {
      const t = j / stepCount;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      const size = size0 + (size1 - size0) * t;
      const alpha = 0.3 + (p0.pressure + (p1.pressure - p0.pressure) * t) * 0.5;

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.9})`);
      gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPencilStroke(
  ctx: CanvasRenderingContext2D,
  points: DrawPoint[],
  r: number,
  g: number,
  b: number,
  baseSize: number
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length >= 2) {
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.7)`;
    ctx.lineWidth = baseSize * 0.6;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const size = baseSize * 0.4;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
    for (let j = 0; j < 8; j++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * size * 0.5;
      const px = p.x + Math.cos(angle) * dist;
      const py = p.y + Math.sin(angle) * dist;
      ctx.beginPath();
      ctx.arc(px, py, 0.5 + Math.random() * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSprayStroke(
  ctx: CanvasRenderingContext2D,
  points: DrawPoint[],
  r: number,
  g: number,
  b: number,
  baseSize: number
) {
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const size = baseSize * 2;
    const particleCount = 20;

    for (let j = 0; j < particleCount; j++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * size;
      const px = p.x + Math.cos(angle) * dist;
      const py = p.y + Math.sin(angle) * dist;
      const alpha = Math.random() * 0.6 * (1 - dist / size);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawBrushPreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
  type: BrushType
) {
  const { r, g, b } = hexToRgb(color);

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  switch (type) {
    case 'brush': {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.8)`);
      gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.4)`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'pencil': {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.7)`;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'spray': {
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * size * 1.5;
        const px = x + Math.cos(angle) * dist;
        const py = y + Math.sin(angle) * dist;
        const alpha = Math.random() * 0.5;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 0.5 + Math.random() * 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}
