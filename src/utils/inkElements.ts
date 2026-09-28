import type { ImageryMatch } from '../types';

type DrawFn = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) => void;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function inkColor(opacity: number): string {
  return hexToRgba('#1a1a1a', opacity);
}

function lightInkColor(opacity: number): string {
  return hexToRgba('#5a5a5a', opacity * 0.6);
}

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const r = 35 * scale;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 1.5);
  gradient.addColorStop(0, hexToRgba('#f5f0e1', opacity * 0.9));
  gradient.addColorStop(0.6, hexToRgba('#e8e0c8', opacity * 0.3));
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#f0ead6', opacity);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#d4cfb8', opacity * 0.3);
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.2, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y + r * 0.3, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
}

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const r = 30 * scale;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
  gradient.addColorStop(0, hexToRgba('#d4a017', opacity * 0.6));
  gradient.addColorStop(0.5, hexToRgba('#cc3d0f', opacity * 0.2));
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.8);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const positions = [
    { dx: 0, dy: 0, r: 3 },
    { dx: -20, dy: -15, r: 2 },
    { dx: 25, dy: -10, r: 2.5 },
    { dx: -15, dy: 20, r: 2 },
    { dx: 20, dy: 25, r: 1.5 },
    { dx: -30, dy: 5, r: 1.8 },
  ];
  positions.forEach(({ dx, dy, r }) => {
    const px = x + dx * scale;
    const py = y + dy * scale;
    const size = r * scale;
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, size * 3);
    gradient.addColorStop(0, hexToRgba('#ffffff', opacity * 0.9));
    gradient.addColorStop(0.5, hexToRgba('#f5f0e1', opacity * 0.4));
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, size * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexToRgba('#ffffff', opacity);
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = lightInkColor(opacity);
  const baseR = 25 * scale;
  ctx.beginPath();
  ctx.arc(x - baseR * 0.8, y, baseR * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y - baseR * 0.3, baseR * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + baseR * 0.8, y, baseR * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + baseR * 0.3, y + baseR * 0.2, baseR * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawRain(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = lightInkColor(opacity);
  ctx.lineWidth = 1.5 * scale;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const dx = (Math.random() - 0.5) * 80 * scale;
    const dy = (Math.random() - 0.5) * 60 * scale;
    const length = (10 + Math.random() * 15) * scale;
    const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3;
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx + Math.cos(angle) * length, y + dy + Math.sin(angle) * length);
    ctx.stroke();
  }
}

function drawSnow(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = hexToRgba('#ffffff', opacity);
  for (let i = 0; i < 20; i++) {
    const dx = (Math.random() - 0.5) * 100 * scale;
    const dy = (Math.random() - 0.5) * 80 * scale;
    const r = (1.5 + Math.random() * 2.5) * scale;
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWind(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = lightInkColor(opacity * 0.5);
  ctx.lineWidth = 2 * scale;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const dy = (i - 2) * 12 * scale;
    const startX = x - 50 * scale;
    const endX = x + 50 * scale;
    ctx.beginPath();
    ctx.moveTo(startX, y + dy);
    ctx.quadraticCurveTo(x, y + dy - 8 * scale, endX, y + dy + 3 * scale);
    ctx.stroke();
  }
}

function drawFrost(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = hexToRgba('#e8f0f8', opacity * 0.8);
  for (let i = 0; i < 15; i++) {
    const dx = (Math.random() - 0.5) * 70 * scale;
    const dy = (Math.random() - 0.5) * 50 * scale;
    const size = (3 + Math.random() * 5) * scale;
    ctx.save();
    ctx.translate(x + dx, y + dy);
    ctx.rotate(Math.random() * Math.PI);
    for (let j = 0; j < 6; j++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -size);
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = hexToRgba('#d0e0f0', opacity * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDew(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const positions = [
    { dx: -15, dy: 10, r: 5 },
    { dx: 12, dy: -8, r: 4 },
    { dx: -5, dy: -15, r: 6 },
    { dx: 20, dy: 15, r: 3.5 },
    { dx: -25, dy: 5, r: 4.5 },
  ];
  positions.forEach(({ dx, dy, r }) => {
    const px = x + dx * scale;
    const py = y + dy * scale;
    const size = r * scale;
    const gradient = ctx.createRadialGradient(
      px - size * 0.3, py - size * 0.3, 0,
      px, py, size
    );
    gradient.addColorStop(0, hexToRgba('#ffffff', opacity * 0.9));
    gradient.addColorStop(0.5, hexToRgba('#c8e0f0', opacity * 0.5));
    gradient.addColorStop(1, hexToRgba('#80a0c0', opacity * 0.2));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(px, py, size, size * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawWillow(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 6 * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x, y + 50 * scale);
  ctx.quadraticCurveTo(x - 5 * scale, y + 20 * scale, x, y - 20 * scale);
  ctx.stroke();

  ctx.strokeStyle = inkColor(opacity * 0.5);
  ctx.lineWidth = 2 * scale;
  const branchAngles = [-0.6, -0.3, 0, 0.3, 0.6];
  branchAngles.forEach((angle, i) => {
    const startY = y - 10 * scale - i * 12 * scale;
    const length = (30 + Math.abs(angle) * 20) * scale;
    const endX = x + Math.sin(angle) * length;
    const endY = startY + length * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.quadraticCurveTo(x + Math.sin(angle) * length * 0.5, startY + length * 0.3, endX, endY);
    ctx.stroke();

    for (let j = 0; j < 5; j++) {
      const t = (j + 1) / 6;
      const lx = x + (endX - x) * t + Math.sin(angle) * 5 * scale;
      const ly = startY + (endY - startY) * t;
      ctx.fillStyle = lightInkColor(opacity * 0.4);
      ctx.beginPath();
      ctx.ellipse(lx, ly, 3 * scale, 1.5 * scale, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawPlum(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = inkColor(opacity * 0.8);
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x, y + 40 * scale);
  ctx.lineTo(x, y - 10 * scale);
  ctx.stroke();

  const branches = [
    { angle: -0.8, length: 30, yOffset: -10 },
    { angle: 0.6, length: 25, yOffset: -25 },
    { angle: -0.4, length: 20, yOffset: 5 },
  ];
  branches.forEach(({ angle, length, yOffset }) => {
    const bx = x + Math.cos(angle) * length * scale;
    const by = y + yOffset * scale + Math.sin(angle) * length * scale;
    ctx.beginPath();
    ctx.moveTo(x, y + yOffset * scale);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 * scale,
      y + yOffset * scale + Math.sin(angle) * length * 0.3 * scale,
      bx, by
    );
    ctx.stroke();

    const flowerPositions = [0.3, 0.6, 0.9];
    flowerPositions.forEach((t) => {
      const fx = x + (bx - x) * t;
      const fy = y + yOffset * scale + (by - y - yOffset * scale) * t;
      const r = 6 * scale;
      ctx.fillStyle = hexToRgba('#f5d0d0', opacity * 0.8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(
          fx + Math.cos(a) * r * 0.5,
          fy + Math.sin(a) * r * 0.5,
          r * 0.5, r * 0.35,
          a, 0, Math.PI * 2
        );
        ctx.fill();
      }
      ctx.fillStyle = hexToRgba('#cc3d0f', opacity);
      ctx.beginPath();
      ctx.arc(fx, fy, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = inkColor(opacity * 0.85);
  ctx.lineWidth = 8 * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x, y + 60 * scale);
  ctx.lineTo(x, y - 30 * scale);
  ctx.stroke();

  ctx.fillStyle = inkColor(opacity * 0.6);
  const layers = [
    { y: -20, width: 45 },
    { y: -5, width: 55 },
    { y: 15, width: 60 },
    { y: 35, width: 50 },
  ];
  layers.forEach(({ y: ly, width }) => {
    const layerY = y + ly * scale;
    const w = width * scale;
    ctx.beginPath();
    ctx.moveTo(x, layerY - 20 * scale);
    ctx.lineTo(x - w / 2, layerY + 5 * scale);
    ctx.lineTo(x + w / 2, layerY + 5 * scale);
    ctx.closePath();
    ctx.fill();
  });

  ctx.fillStyle = inkColor(opacity * 0.8);
  ctx.beginPath();
  ctx.moveTo(x, y - 50 * scale);
  ctx.lineTo(x - 15 * scale, y - 25 * scale);
  ctx.lineTo(x + 15 * scale, y - 25 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawBamboo(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const color = inkColor(opacity * 0.7);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5 * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x, y + 55 * scale);
  ctx.lineTo(x, y - 45 * scale);
  ctx.stroke();

  const nodes = [-35, -15, 5, 25, 45];
  nodes.forEach((ny) => {
    ctx.lineWidth = 7 * scale;
    ctx.beginPath();
    ctx.moveTo(x - 2 * scale, y + ny * scale);
    ctx.lineTo(x + 2 * scale, y + ny * scale);
    ctx.stroke();
  });

  ctx.lineWidth = 2 * scale;
  const leafPositions = [
    { x: -8, y: -40, angle: -0.5 },
    { x: 8, y: -30, angle: 0.4 },
    { x: -10, y: -10, angle: -0.6 },
    { x: 12, y: 10, angle: 0.5 },
    { x: -6, y: 30, angle: -0.3 },
  ];
  leafPositions.forEach(({ x: lx, y: ly, angle }) => {
    const leafX = x + lx * scale;
    const leafY = y + ly * scale;
    ctx.save();
    ctx.translate(leafX, leafY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawChrysanthemum(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const petalCount = 16;
  const r = 25 * scale;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const px = x + Math.cos(angle) * r * 0.4;
    const py = y + Math.sin(angle) * r * 0.4;
    ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.7);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < petalCount / 2; i++) {
    const angle = (i / (petalCount / 2)) * Math.PI * 2 + Math.PI / petalCount;
    const px = x + Math.cos(angle) * r * 0.6;
    const py = y + Math.sin(angle) * r * 0.6;
    ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.5);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.45, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = hexToRgba('#7d4e24', opacity * 0.9);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.8);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.6);
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.3);
  ctx.quadraticCurveTo(x + 3 * scale, y + r * 0.8, x, y + r * 1.2);
  ctx.stroke();
}

function drawLotus(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const r = 20 * scale;
  const petalCount = 10;

  ctx.fillStyle = hexToRgba('#4a7c59', opacity * 0.5);
  ctx.beginPath();
  ctx.ellipse(x - r * 1.5, y + r * 1.2, r * 1.2, r * 0.4, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + r * 1.3, y + r * 1.4, r, r * 0.35, 0.2, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const px = x + Math.cos(angle) * r * 0.3;
    const py = y + Math.sin(angle) * r * 0.2;
    ctx.fillStyle = hexToRgba('#f0d0d0', opacity * 0.8);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle - Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.4, r * 0.35, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = hexToRgba('#f0e68c', opacity * 0.9);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.fillStyle = hexToRgba('#cc3d0f', opacity);
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(angle) * r * 0.15,
      y + Math.sin(angle) * r * 0.1,
      r * 0.05, r * 0.08,
      angle, 0, Math.PI * 2
    );
    ctx.fill();
  }
}

function drawPeach(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const r = 22 * scale;
  const petalCount = 5;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * r * 0.5;
    const py = y + Math.sin(angle) * r * 0.5;
    ctx.fillStyle = hexToRgba('#f8b0b0', opacity * 0.7);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.3, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.8);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.5);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.3);
  ctx.lineTo(x - 2 * scale, y + r * 0.8);
  ctx.stroke();
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const petalCount = 6;
  const r = 18 * scale;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const px = x + Math.cos(angle) * r * 0.4;
    const py = y + Math.sin(angle) * r * 0.4;
    ctx.fillStyle = lightInkColor(opacity * 0.5);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.35, r * 0.4, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = inkColor(opacity * 0.7);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrass(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = inkColor(opacity * 0.5);
  ctx.lineWidth = 2 * scale;
  ctx.lineCap = 'round';
  const blades = [
    { dx: -25, h: 30, angle: -0.2 },
    { dx: -15, h: 40, angle: -0.1 },
    { dx: -5, h: 35, angle: 0 },
    { dx: 5, h: 45, angle: 0.1 },
    { dx: 15, h: 32, angle: 0.15 },
    { dx: 25, h: 28, angle: 0.25 },
    { dx: -30, h: 25, angle: -0.3 },
    { dx: 20, h: 38, angle: 0.2 },
  ];
  blades.forEach(({ dx, h, angle }) => {
    const bx = x + dx * scale;
    const by = y + 20 * scale;
    const height = h * scale;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(
      bx + Math.sin(angle) * height * 0.5,
      by - height * 0.6,
      bx + Math.sin(angle) * height,
      by - height
    );
    ctx.stroke();
  });
}

function drawMountain(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = lightInkColor(opacity * 0.3);
  ctx.beginPath();
  ctx.moveTo(x - 80 * scale, y + 30 * scale);
  ctx.quadraticCurveTo(x - 40 * scale, y - 50 * scale, x - 20 * scale, y - 10 * scale);
  ctx.quadraticCurveTo(x + 10 * scale, y - 60 * scale, x + 40 * scale, y - 20 * scale);
  ctx.quadraticCurveTo(x + 60 * scale, y - 40 * scale, x + 80 * scale, y + 30 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.2);
  ctx.beginPath();
  ctx.moveTo(x - 60 * scale, y + 20 * scale);
  ctx.quadraticCurveTo(x - 30 * scale, y - 30 * scale, x - 10 * scale, y + 10 * scale);
  ctx.quadraticCurveTo(x + 20 * scale, y - 40 * scale, x + 50 * scale, y + 20 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.4);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x - 30 * scale, y - 10 * scale);
  ctx.quadraticCurveTo(x - 10 * scale, y - 30 * scale, x + 10 * scale, y - 5 * scale);
  ctx.stroke();
}

function drawWater(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = lightInkColor(opacity * 0.4);
  ctx.lineWidth = 1.5 * scale;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const waveY = y - 20 * scale + i * 12 * scale;
    const startX = x - 50 * scale;
    const endX = x + 50 * scale;
    ctx.beginPath();
    ctx.moveTo(startX, waveY);
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      const wx = startX + (endX - startX) * t;
      const wy = waveY + Math.sin(t * Math.PI * 2 + i) * 5 * scale;
      ctx.lineTo(wx, wy);
    }
    ctx.stroke();
  }
}

function drawWaterfall(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 30 * scale;
  const height = 70 * scale;
  const gradient = ctx.createLinearGradient(x, y - height / 2, x, y + height / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.3, hexToRgba('#ffffff', opacity * 0.6));
  gradient.addColorStop(0.7, hexToRgba('#e0e8f0', opacity * 0.4));
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y - height / 2);
  ctx.quadraticCurveTo(x - width / 3, y, x - width / 2, y + height / 2);
  ctx.lineTo(x + width / 2, y + height / 2);
  ctx.quadraticCurveTo(x + width / 3, y, x + width / 2, y - height / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hexToRgba('#d0e0f0', opacity * 0.4);
  ctx.beginPath();
  ctx.ellipse(x, y + height / 2 + 5 * scale, width * 0.8, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = inkColor(opacity * 0.6);
  ctx.beginPath();
  ctx.moveTo(x - 30 * scale, y + 20 * scale);
  ctx.quadraticCurveTo(x - 40 * scale, y - 5 * scale, x - 20 * scale, y - 25 * scale);
  ctx.quadraticCurveTo(x - 5 * scale, y - 35 * scale, x + 15 * scale, y - 20 * scale);
  ctx.quadraticCurveTo(x + 35 * scale, y - 10 * scale, x + 30 * scale, y + 20 * scale);
  ctx.quadraticCurveTo(x, y + 30 * scale, x - 30 * scale, y + 20 * scale);
  ctx.fill();

  ctx.fillStyle = lightInkColor(opacity * 0.3);
  ctx.beginPath();
  ctx.ellipse(x - 10 * scale, y - 10 * scale, 15 * scale, 8 * scale, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPath(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = lightInkColor(opacity * 0.4);
  ctx.lineWidth = 8 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 50 * scale, y + 30 * scale);
  ctx.quadraticCurveTo(x - 20 * scale, y + 10 * scale, x, y);
  ctx.quadraticCurveTo(x + 20 * scale, y - 10 * scale, x + 50 * scale, y - 25 * scale);
  ctx.stroke();

  ctx.strokeStyle = inkColor(opacity * 0.3);
  ctx.lineWidth = 1.5 * scale;
  ctx.setLineDash([5 * scale, 8 * scale]);
  ctx.beginPath();
  ctx.moveTo(x - 50 * scale, y + 30 * scale);
  ctx.quadraticCurveTo(x - 20 * scale, y + 10 * scale, x, y);
  ctx.quadraticCurveTo(x + 20 * scale, y - 10 * scale, x + 50 * scale, y - 25 * scale);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBoat(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const boatWidth = 50 * scale;
  const boatHeight = 15 * scale;

  ctx.fillStyle = inkColor(opacity * 0.7);
  ctx.beginPath();
  ctx.moveTo(x - boatWidth / 2, y);
  ctx.quadraticCurveTo(x - boatWidth / 2, y + boatHeight, x, y + boatHeight);
  ctx.quadraticCurveTo(x + boatWidth / 2, y + boatHeight, x + boatWidth / 2, y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.5);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x - boatWidth / 3, y);
  ctx.quadraticCurveTo(x, y + boatHeight * 0.4, x + boatWidth / 3, y);
  ctx.stroke();

  ctx.strokeStyle = inkColor(opacity * 0.8);
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(x - 5 * scale, y);
  ctx.lineTo(x - 5 * scale, y - 30 * scale);
  ctx.stroke();

  ctx.fillStyle = hexToRgba('#f0e6d2', opacity * 0.6);
  ctx.beginPath();
  ctx.moveTo(x - 5 * scale, y - 28 * scale);
  ctx.lineTo(x + 18 * scale, y - 20 * scale);
  ctx.lineTo(x - 5 * scale, y - 12 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawBridge(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 70 * scale;
  const height = 20 * scale;

  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(x, y + height, width / 2, Math.PI, 0);
  ctx.stroke();

  ctx.lineWidth = 2 * scale;
  const railingY = y - height * 0.3;
  ctx.beginPath();
  ctx.arc(x, y + height, width / 2 - 5 * scale, Math.PI, 0);
  ctx.stroke();

  const postCount = 5;
  for (let i = 0; i <= postCount; i++) {
    const angle = Math.PI + (i / postCount) * Math.PI;
    const px = x + Math.cos(angle) * (width / 2 - 2 * scale);
    const py = y + height + Math.sin(angle) * (width / 2 - 2 * scale);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + 8 * scale);
    ctx.stroke();
  }

  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y + height);
  ctx.lineTo(x - width / 2 - 8 * scale, y + height + 15 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y + height);
  ctx.lineTo(x + width / 2 + 8 * scale, y + height + 15 * scale);
  ctx.stroke();
}

function drawPavilion(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 50 * scale;
  const height = 45 * scale;

  ctx.fillStyle = inkColor(opacity * 0.7);
  ctx.beginPath();
  ctx.moveTo(x - width / 2 - 8 * scale, y - height / 2);
  ctx.lineTo(x, y - height / 2 - 20 * scale);
  ctx.lineTo(x + width / 2 + 8 * scale, y - height / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.5);
  ctx.fillRect(x - width / 2 - 5 * scale, y - height / 2, width + 10 * scale, 5 * scale);

  ctx.strokeStyle = inkColor(opacity * 0.8);
  ctx.lineWidth = 3 * scale;
  const pillarX = [-width / 3, width / 3];
  pillarX.forEach((dx) => {
    ctx.beginPath();
    ctx.moveTo(x + dx, y - height / 2 + 5 * scale);
    ctx.lineTo(x + dx, y + height / 2);
    ctx.stroke();
  });

  ctx.fillStyle = inkColor(opacity * 0.6);
  ctx.fillRect(x - width / 2, y + height / 2 - 3 * scale, width, 5 * scale);
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 35 * scale;
  const totalHeight = 80 * scale;
  const stories = 4;
  const storyHeight = totalHeight / stories;

  for (let i = 0; i < stories; i++) {
    const storyY = y + totalHeight / 2 - i * storyHeight;
    const storyWidth = width * (1 - i * 0.15);

    ctx.fillStyle = inkColor(opacity * 0.7);
    ctx.beginPath();
    ctx.moveTo(x - storyWidth / 2 - 6 * scale, storyY - storyHeight * 0.3);
    ctx.lineTo(x, storyY - storyHeight * 0.55);
    ctx.lineTo(x + storyWidth / 2 + 6 * scale, storyY - storyHeight * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = inkColor(opacity * 0.5);
    ctx.fillRect(x - storyWidth / 2, storyY - storyHeight * 0.3, storyWidth, storyHeight * 0.5);
  }

  ctx.fillStyle = inkColor(opacity * 0.8);
  ctx.beginPath();
  ctx.moveTo(x - 8 * scale, y - totalHeight / 2 + storyHeight * 0.3);
  ctx.lineTo(x, y - totalHeight / 2 - 10 * scale);
  ctx.lineTo(x + 8 * scale, y - totalHeight / 2 + storyHeight * 0.3);
  ctx.closePath();
  ctx.fill();
}

function drawTemple(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 60 * scale;
  const height = 50 * scale;

  ctx.fillStyle = inkColor(opacity * 0.7);
  ctx.beginPath();
  ctx.moveTo(x - width / 2 - 12 * scale, y - height / 2);
  ctx.quadraticCurveTo(x, y - height / 2 - 30 * scale, x + width / 2 + 12 * scale, y - height / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.5);
  ctx.fillRect(x - width / 2, y - height / 2, width, height);

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.6);
  ctx.fillRect(x - 10 * scale, y - 5 * scale, 20 * scale, 25 * scale);

  ctx.strokeStyle = inkColor(opacity * 0.4);
  ctx.lineWidth = 1.5 * scale;
  const windowPositions = [-width / 3, width / 3];
  windowPositions.forEach((wx) => {
    ctx.strokeRect(x + wx - 6 * scale, y - 5 * scale, 12 * scale, 10 * scale);
    ctx.beginPath();
    ctx.moveTo(x + wx, y - 5 * scale);
    ctx.lineTo(x + wx, y + 5 * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + wx - 6 * scale, y);
    ctx.lineTo(x + wx + 6 * scale, y);
    ctx.stroke();
  });
}

function drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 30 * scale;
  const height = 45 * scale;

  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 3 * scale;
  ctx.strokeRect(x - width / 2, y - height / 2, width, height);

  ctx.fillStyle = hexToRgba('#7d4e24', opacity * 0.5);
  ctx.fillRect(x - width / 2, y - height / 2, width / 2 - 1, height);
  ctx.fillRect(x + 1, y - height / 2, width / 2 - 1, height);

  ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.8);
  ctx.beginPath();
  ctx.arc(x - width / 4, y, 2.5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + width / 4, y, 2.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.3);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y - height / 2);
  ctx.lineTo(x, y + height / 2);
  ctx.stroke();
}

function drawBird(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.strokeStyle = inkColor(opacity * 0.8);
  ctx.lineWidth = 2.5 * scale;
  ctx.lineCap = 'round';

  const positions = [
    { dx: 0, dy: 0, size: 1 },
    { dx: -25, dy: -15, size: 0.7 },
    { dx: 20, dy: -10, size: 0.8 },
    { dx: -15, dy: 15, size: 0.6 },
  ];

  positions.forEach(({ dx, dy, size }) => {
    const bx = x + dx * scale;
    const by = y + dy * scale;
    const s = size * scale;
    ctx.beginPath();
    ctx.moveTo(bx - 12 * s, by);
    ctx.quadraticCurveTo(bx - 6 * s, by - 10 * s, bx, by - 2 * s);
    ctx.quadraticCurveTo(bx + 6 * s, by - 10 * s, bx + 12 * s, by);
    ctx.stroke();
  });
}

function drawCrane(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = hexToRgba('#ffffff', opacity * 0.9);
  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 2 * scale;

  ctx.beginPath();
  ctx.ellipse(x, y, 22 * scale, 12 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hexToRgba('#ffffff', opacity);
  ctx.beginPath();
  ctx.arc(x + 20 * scale, y - 12 * scale, 9 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.8);
  ctx.beginPath();
  ctx.moveTo(x + 28 * scale, y - 12 * scale);
  ctx.lineTo(x + 40 * scale, y - 10 * scale);
  ctx.lineTo(x + 28 * scale, y - 8 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.9);
  ctx.beginPath();
  ctx.arc(x + 23 * scale, y - 14 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#2c2c2c', opacity * 0.7);
  ctx.beginPath();
  ctx.moveTo(x - 5 * scale, y - 5 * scale);
  ctx.quadraticCurveTo(x - 20 * scale, y - 25 * scale, x - 30 * scale, y - 15 * scale);
  ctx.quadraticCurveTo(x - 20 * scale, y - 10 * scale, x - 5 * scale, y + 3 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.8);
  ctx.lineWidth = 2 * scale;
  const legY = y + 12 * scale;
  ctx.beginPath();
  ctx.moveTo(x - 5 * scale, legY);
  ctx.lineTo(x - 8 * scale, legY + 20 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 5 * scale, legY);
  ctx.lineTo(x + 3 * scale, legY + 20 * scale);
  ctx.stroke();
}

function drawButterfly(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const wingColor = hexToRgba('#c0392b', opacity * 0.6);
  ctx.fillStyle = wingColor;

  ctx.beginPath();
  ctx.ellipse(x - 10 * scale, y - 5 * scale, 12 * scale, 10 * scale, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x + 10 * scale, y - 5 * scale, 12 * scale, 10 * scale, 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.4);
  ctx.beginPath();
  ctx.ellipse(x - 8 * scale, y + 5 * scale, 8 * scale, 6 * scale, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 8 * scale, y + 5 * scale, 8 * scale, 6 * scale, 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.8);
  ctx.beginPath();
  ctx.ellipse(x, y, 2 * scale, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y - 10 * scale);
  ctx.quadraticCurveTo(x - 5 * scale, y - 18 * scale, x - 8 * scale, y - 15 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 10 * scale);
  ctx.quadraticCurveTo(x + 5 * scale, y - 18 * scale, x + 8 * scale, y - 15 * scale);
  ctx.stroke();
}

function drawCicada(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = inkColor(opacity * 0.7);
  ctx.beginPath();
  ctx.ellipse(x, y, 8 * scale, 14 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#4a7c59', opacity * 0.5);
  ctx.beginPath();
  ctx.ellipse(x - 7 * scale, y + 2 * scale, 9 * scale, 6 * scale, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 7 * scale, y + 2 * scale, 9 * scale, 6 * scale, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.9);
  ctx.beginPath();
  ctx.arc(x, y - 12 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = inkColor(opacity * 0.6);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x - 2 * scale, y - 15 * scale);
  ctx.lineTo(x - 4 * scale, y - 22 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 2 * scale, y - 15 * scale);
  ctx.lineTo(x + 4 * scale, y - 22 * scale);
  ctx.stroke();
}

function drawFish(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.7);

  ctx.beginPath();
  ctx.ellipse(x, y, 22 * scale, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + 20 * scale, y);
  ctx.lineTo(x + 35 * scale, y - 8 * scale);
  ctx.lineTo(x + 35 * scale, y + 8 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.5);
  ctx.beginPath();
  ctx.ellipse(x - 5 * scale, y - 2 * scale, 6 * scale, 8 * scale, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#ffffff', opacity);
  ctx.beginPath();
  ctx.arc(x - 14 * scale, y - 2 * scale, 3 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = inkColor(opacity);
  ctx.beginPath();
  ctx.arc(x - 15 * scale, y - 2 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.4);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x + 5 * scale + i * 7 * scale, y + 3 * scale, 2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFirefly(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const positions = [
    { dx: 0, dy: 0, size: 1 },
    { dx: -20, dy: -10, size: 0.7 },
    { dx: 25, dy: 5, size: 0.8 },
    { dx: -10, dy: 20, size: 0.6 },
    { dx: 15, dy: -18, size: 0.9 },
  ];

  positions.forEach(({ dx, dy, size }) => {
    const fx = x + dx * scale;
    const fy = y + dy * scale;
    const r = 4 * scale * size;

    const gradient = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 4);
    gradient.addColorStop(0, hexToRgba('#ffff88', opacity * 0.8));
    gradient.addColorStop(0.5, hexToRgba('#ffee55', opacity * 0.4));
    gradient.addColorStop(1, 'rgba(255,255,100,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(fx, fy, r * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hexToRgba('#ffffaa', opacity);
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawLantern(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const r = 18 * scale;

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.85);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#c0392b', opacity * 0.6);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(x + i * 6 * scale, y, 1.5 * scale, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.9);
  ctx.fillRect(x - r * 0.6, y - r - 5 * scale, r * 1.2, 5 * scale);
  ctx.fillRect(x - r * 0.6, y + r, r * 1.2, 5 * scale);

  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y - r - 10 * scale);
  ctx.lineTo(x, y - r - 20 * scale);
  ctx.stroke();

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
  gradient.addColorStop(0, hexToRgba('#ffeeaa', opacity * 0.3));
  gradient.addColorStop(1, 'rgba(255,255,150,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hexToRgba('#d4a017', opacity * 0.8);
  ctx.lineWidth = 1.5 * scale;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 5 * scale + i * 5 * scale, y + r + 5 * scale);
    ctx.lineTo(x - 6 * scale + i * 5 * scale, y + r + 15 * scale);
    ctx.stroke();
  }
}

function drawBook(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const width = 35 * scale;
  const height = 28 * scale;

  ctx.fillStyle = inkColor(opacity * 0.6);
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y - height / 2);
  ctx.lineTo(x + width / 2, y - height / 2 - 3 * scale);
  ctx.lineTo(x + width / 2, y + height / 2 - 3 * scale);
  ctx.lineTo(x - width / 2, y + height / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.4);
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y - height / 2 - 3 * scale);
  ctx.lineTo(x + width / 2 + 6 * scale, y - height / 2);
  ctx.lineTo(x + width / 2 + 6 * scale, y + height / 2);
  ctx.lineTo(x + width / 2, y + height / 2 - 3 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = lightInkColor(opacity * 0.5);
  ctx.lineWidth = 1 * scale;
  for (let i = 0; i < 4; i++) {
    const ly = y - height / 2 + 5 * scale + i * 6 * scale;
    ctx.beginPath();
    ctx.moveTo(x - width / 2 + 3 * scale, ly);
    ctx.lineTo(x + width / 2 - 2 * scale, ly - 2 * scale);
    ctx.stroke();
  }
}

function drawGuqin(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const length = 70 * scale;
  const width = 15 * scale;

  ctx.fillStyle = inkColor(opacity * 0.6);
  ctx.beginPath();
  ctx.ellipse(x - length / 2 + 8 * scale, y, 8 * scale, width / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + length / 2 - 8 * scale, y, 8 * scale, width / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - length / 2 + 5 * scale, y - width / 2, length - 10 * scale, width);

  ctx.strokeStyle = hexToRgba('#d4a017', opacity * 0.7);
  ctx.lineWidth = 1 * scale;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x - length / 2 + 5 * scale, y + i * 3 * scale);
    ctx.lineTo(x + length / 2 - 5 * scale, y + i * 3 * scale);
    ctx.stroke();
  }

  ctx.fillStyle = inkColor(opacity * 0.8);
  const postPositions = [-length / 3, length / 3];
  postPositions.forEach((px) => {
    ctx.beginPath();
    ctx.arc(x + px, y - width / 2 - 3 * scale, 2 * scale, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawWine(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const r = 12 * scale;
  const height = 25 * scale;

  ctx.fillStyle = inkColor(opacity * 0.5);
  ctx.beginPath();
  ctx.moveTo(x - r - 2 * scale, y + height / 2);
  ctx.lineTo(x - r, y - height / 2);
  ctx.lineTo(x + r, y - height / 2);
  ctx.lineTo(x + r + 2 * scale, y + height / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.6);
  ctx.beginPath();
  ctx.moveTo(x - r + 1 * scale, y + height / 2 - 2 * scale);
  ctx.lineTo(x - r + 2 * scale, y - 2 * scale);
  ctx.lineTo(x + r - 2 * scale, y - 2 * scale);
  ctx.lineTo(x + r - 1 * scale, y + height / 2 - 2 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.6);
  ctx.fillRect(x - r - 1 * scale, y - height / 2 - 4 * scale, r * 2 + 2 * scale, 4 * scale);

  ctx.strokeStyle = hexToRgba('#f5f0e1', opacity * 0.4);
  ctx.lineWidth = 1 * scale;
  for (let i = 0; i < 3; i++) {
    const wx = x - 5 * scale + i * 5 * scale;
    ctx.beginPath();
    ctx.arc(wx, y - height / 2 - 8 * scale - i * 3 * scale, 2 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSword(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  const length = 55 * scale;
  const guardWidth = 12 * scale;

  ctx.fillStyle = hexToRgba('#c0c0c0', opacity * 0.9);
  ctx.beginPath();
  ctx.moveTo(x - 2 * scale, y - length / 2);
  ctx.lineTo(x + 2 * scale, y - length / 2);
  ctx.lineTo(x + 3 * scale, y + length / 2 - 10 * scale);
  ctx.lineTo(x, y + length / 2);
  ctx.lineTo(x - 3 * scale, y + length / 2 - 10 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hexToRgba('#d4a017', opacity * 0.8);
  ctx.fillRect(x - guardWidth / 2, y + length / 2 - 12 * scale, guardWidth, 4 * scale);

  ctx.fillStyle = hexToRgba('#7d4e24', opacity * 0.7);
  ctx.fillRect(x - 4 * scale, y + length / 2 - 8 * scale, 8 * scale, 15 * scale);

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity);
  ctx.beginPath();
  ctx.arc(x, y + length / 2 + 10 * scale, 4 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawCowboy(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = inkColor(opacity * 0.7);

  ctx.beginPath();
  ctx.ellipse(x, y + 10 * scale, 25 * scale, 15 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x + 22 * scale, y - 2 * scale, 10 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.6);
  ctx.beginPath();
  ctx.moveTo(x + 28 * scale, y - 5 * scale);
  ctx.quadraticCurveTo(x + 35 * scale, y - 12 * scale, x + 30 * scale, y - 15 * scale);
  ctx.quadraticCurveTo(x + 25 * scale, y - 12 * scale, x + 26 * scale, y - 5 * scale);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.8);
  const legPositions = [-15, -5, 10, 18];
  legPositions.forEach((lx) => {
    ctx.fillRect(x + lx * scale, y + 20 * scale, 3 * scale, 20 * scale);
  });

  ctx.fillStyle = hexToRgba('#7d4e24', opacity * 0.7);
  ctx.beginPath();
  ctx.ellipse(x - 5 * scale, y - 15 * scale, 10 * scale, 5 * scale, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 10 * scale, y - 15 * scale, 10 * scale, 15 * scale);
}

function drawHermit(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = inkColor(opacity * 0.6);

  ctx.beginPath();
  ctx.moveTo(x, y - 25 * scale);
  ctx.lineTo(x - 18 * scale, y + 30 * scale);
  ctx.lineTo(x + 18 * scale, y + 30 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hexToRgba('#f0e6d2', opacity * 0.8);
  ctx.beginPath();
  ctx.arc(x, y - 20 * scale, 9 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.8);
  ctx.beginPath();
  ctx.arc(x, y - 28 * scale, 7 * scale, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - 10 * scale, y - 28 * scale, 20 * scale, 5 * scale);

  ctx.strokeStyle = inkColor(opacity * 0.7);
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(x + 15 * scale, y - 10 * scale);
  ctx.lineTo(x + 25 * scale, y + 30 * scale);
  ctx.stroke();
}

function drawLady(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number) {
  ctx.fillStyle = hexToRgba('#f8d0d0', opacity * 0.7);

  ctx.beginPath();
  ctx.moveTo(x, y - 20 * scale);
  ctx.quadraticCurveTo(x - 22 * scale, y + 5 * scale, x - 20 * scale, y + 35 * scale);
  ctx.lineTo(x + 20 * scale, y + 35 * scale);
  ctx.quadraticCurveTo(x + 22 * scale, y + 5 * scale, x, y - 20 * scale);
  ctx.fill();

  ctx.fillStyle = hexToRgba('#f0e0c0', opacity);
  ctx.beginPath();
  ctx.arc(x, y - 20 * scale, 11 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.9);
  ctx.beginPath();
  ctx.arc(x, y - 25 * scale, 9 * scale, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - 10 * scale, y - 18 * scale, 3 * scale, 8 * scale, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 10 * scale, y - 18 * scale, 3 * scale, 8 * scale, 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = inkColor(opacity * 0.8);
  ctx.beginPath();
  ctx.ellipse(x - 4 * scale, y - 22 * scale, 1.5 * scale, 2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 4 * scale, y - 22 * scale, 1.5 * scale, 2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hexToRgba('#c0392b', opacity * 0.6);
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.arc(x, y - 17 * scale, 3 * scale, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = hexToRgba('#cc3d0f', opacity * 0.5);
  ctx.beginPath();
  ctx.ellipse(x - 18 * scale, y + 5 * scale, 8 * scale, 4 * scale, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 18 * scale, y + 5 * scale, 8 * scale, 4 * scale, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

const imageryDrawMap: Record<string, DrawFn> = {
  '月亮': drawMoon,
  '太阳': drawSun,
  '星星': drawStars,
  '云朵': drawCloud,
  '细雨': drawRain,
  '雪花': drawSnow,
  '风': drawWind,
  '霜': drawFrost,
  '露水': drawDew,
  '柳树': drawWillow,
  '梅花': drawPlum,
  '松树': drawPine,
  '竹子': drawBamboo,
  '菊花': drawChrysanthemum,
  '荷花': drawLotus,
  '桃花': drawPeach,
  '落花': drawFlower,
  '草': drawGrass,
  '远山': drawMountain,
  '流水': drawWater,
  '瀑布': drawWaterfall,
  '岩石': drawRock,
  '古道': drawPath,
  '孤舟': drawBoat,
  '小桥': drawBridge,
  '古亭': drawPavilion,
  '楼阁': drawTower,
  '古庙': drawTemple,
  '柴门': drawDoor,
  '飞鸟': drawBird,
  '鹤': drawCrane,
  '蝴蝶': drawButterfly,
  '蝉': drawCicada,
  '鱼': drawFish,
  '萤火虫': drawFirefly,
  '灯笼': drawLantern,
  '书': drawBook,
  '琴': drawGuqin,
  '酒': drawWine,
  '剑': drawSword,
  '牧童': drawCowboy,
  '隐士': drawHermit,
  '仕女': drawLady,
};

export function drawImageryElement(
  ctx: CanvasRenderingContext2D,
  keyword: string,
  x: number,
  y: number,
  scale: number,
  opacity: number
) {
  const drawFn = imageryDrawMap[keyword];
  if (drawFn) {
    ctx.save();
    drawFn(ctx, x, y, scale, opacity);
    ctx.restore();
  } else {
    ctx.fillStyle = inkColor(opacity);
    ctx.font = `${16 * scale}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(keyword, x, y);
  }
}

export function drawInkSplash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  opacity: number,
  progress: number
) {
  const r = radius * progress;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, `rgba(26, 26, 26, ${opacity * 0.8 * (1 - progress)})`);
  gradient.addColorStop(0.4, `rgba(42, 42, 42, ${opacity * 0.5 * (1 - progress)})`);
  gradient.addColorStop(0.7, `rgba(90, 90, 90, ${opacity * 0.3 * (1 - progress)})`);
  gradient.addColorStop(1, 'rgba(138, 138, 138, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPaperTexture(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#f5f0e1';
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.03;
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 2 + 0.5;
    ctx.fillStyle = Math.random() > 0.5 ? '#8b7355' : '#c4b896';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(139, 115, 85, 0.02)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 50; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const length = Math.random() * 100 + 20;
    const angle = Math.random() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(angle) * length, y1 + Math.sin(angle) * length);
    ctx.stroke();
  }
}