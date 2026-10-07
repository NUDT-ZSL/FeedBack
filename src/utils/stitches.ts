import type { StitchPoint, StitchType, ThreadColor } from '../types/embroidery';

export function drawStraightStitch(
  ctx: CanvasRenderingContext2D,
  points: StitchPoint[],
  color: ThreadColor,
  radius: number
): void {
  if (points.length < 2) return;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 0.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  for (let i = 1; i < points.length; i += 2) {
    const prev = points[i - 1];
    const curr = points[i];
    
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len < 2) continue;
    
    const nx = -dy / len;
    const ny = dx / len;
    
    const stitchLength = radius * 4;
    const steps = Math.ceil(len / stitchLength);
    
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const cx = prev.x + dx * t;
      const cy = prev.y + dy * t;
      
      ctx.beginPath();
      ctx.moveTo(cx - nx * radius * 2, cy - ny * radius * 2);
      ctx.lineTo(cx + nx * radius * 2, cy + ny * radius * 2);
      ctx.stroke();
    }
  }
}

export function drawDiagonalStitch(
  ctx: CanvasRenderingContext2D,
  points: StitchPoint[],
  color: ThreadColor,
  radius: number
): void {
  if (points.length < 2) return;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 0.5;
  ctx.lineCap = 'round';
  
  const angle = Math.PI / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len < 1) continue;
    
    const stitchLength = radius * 5;
    const steps = Math.max(1, Math.ceil(len / stitchLength));
    
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = prev.x + dx * t;
      const cy = prev.y + dy * t;
      
      ctx.beginPath();
      ctx.moveTo(cx - cos * radius * 2.5, cy - sin * radius * 2.5);
      ctx.lineTo(cx + cos * radius * 2.5, cy + sin * radius * 2.5);
      ctx.stroke();
    }
  }
}

export function drawTwistStitch(
  ctx: CanvasRenderingContext2D,
  points: StitchPoint[],
  color: ThreadColor,
  radius: number
): void {
  if (points.length < 2) return;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 0.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len < 1) continue;
    
    const nx = -dy / len;
    const ny = dx / len;
    
    const segments = Math.ceil(len / (radius * 2));
    
    ctx.beginPath();
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const spiralT = t * Math.PI * 4;
      const spiralRadius = radius * (1 + Math.sin(spiralT) * 0.3);
      
      const cx = prev.x + dx * t + nx * Math.cos(spiralT) * spiralRadius;
      const cy = prev.y + dy * t + ny * Math.sin(spiralT) * spiralRadius;
      
      if (s === 0) {
        ctx.moveTo(cx, cy);
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();
  }
}

export function drawSeedStitch(
  ctx: CanvasRenderingContext2D,
  points: StitchPoint[],
  color: ThreadColor,
  radius: number
): void {
  ctx.fillStyle = color;
  
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    
    const dots = 3 + Math.floor(Math.random() * 3);
    for (let d = 0; d < dots; d++) {
      const angle = (d / dots) * Math.PI * 2 + Math.random() * 0.5;
      const dist = radius * (0.3 + Math.random() * 0.5);
      const dotRadius = radius * (0.25 + Math.random() * 0.25);
      
      const cx = point.x + Math.cos(angle) * dist;
      const cy = point.y + Math.sin(angle) * dist;
      
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawStitchByType(
  ctx: CanvasRenderingContext2D,
  type: StitchType,
  points: StitchPoint[],
  color: ThreadColor,
  radius: number
): void {
  switch (type) {
    case 'straight':
      drawStraightStitch(ctx, points, color, radius);
      break;
    case 'diagonal':
      drawDiagonalStitch(ctx, points, color, radius);
      break;
    case 'twist':
      drawTwistStitch(ctx, points, color, radius);
      break;
    case 'seed':
      drawSeedStitch(ctx, points, color, radius);
      break;
  }
}
