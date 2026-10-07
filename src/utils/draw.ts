import {
  Branch,
  Rock,
  WaterFlow,
  Calligraphy,
  Point,
  POT_RADIUS,
  POT_CENTER,
  getLeafMarks
} from './pots';

export function drawPot(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = '#6b4423';
  ctx.beginPath();
  ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3e2723';
  ctx.beginPath();
  ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 6, 0, Math.PI * 2);
  ctx.stroke();

  const gradient = ctx.createRadialGradient(
    POT_CENTER.x, POT_CENTER.y, 0,
    POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 12
  );
  gradient.addColorStop(0, 'rgba(139, 119, 101, 0.3)');
  gradient.addColorStop(1, 'rgba(62, 39, 35, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawBranch(
  ctx: CanvasRenderingContext2D,
  branch: Branch,
  isSelected: boolean,
  isHovered: boolean
): void {
  ctx.save();

  ctx.strokeStyle = branch.color;
  ctx.lineWidth = branch.thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isSelected) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 15;
  } else if (isHovered) {
    ctx.shadowColor = '#81c784';
    ctx.shadowBlur = 10;
  }

  ctx.beginPath();
  ctx.moveTo(branch.startX, branch.startY);
  ctx.lineTo(branch.endX, branch.endY);
  ctx.stroke();

  if (branch.hasLeaves) {
    ctx.fillStyle = '#4caf50';
    ctx.shadowBlur = 0;

    for (const mark of getLeafMarks(branch)) {
      ctx.beginPath();
      ctx.ellipse(mark.x, mark.y, mark.rx, mark.ry, mark.rotation, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawRock(
  ctx: CanvasRenderingContext2D,
  rock: Rock,
  isSelected: boolean,
  isHovered: boolean
): void {
  ctx.save();

  if (isSelected) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 15;
  } else if (isHovered) {
    ctx.shadowColor = '#90a4ae';
    ctx.shadowBlur = 10;
  }

  const gradient = ctx.createRadialGradient(
    rock.x - rock.diameter * 0.2,
    rock.y - rock.diameter * 0.2,
    0,
    rock.x,
    rock.y,
    rock.diameter / 2
  );
  gradient.addColorStop(0, rock.color === '#607d8b' ? '#90a4ae' : '#a1887f');
  gradient.addColorStop(0.7, rock.color);
  gradient.addColorStop(1, rock.color === '#607d8b' ? '#455a64' : '#6d4c41');

  ctx.fillStyle = gradient;
  ctx.beginPath();

  const points = 8;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = (rock.diameter / 2) * (0.8 + Math.sin(angle * 3 + rock.id.charCodeAt(0)) * 0.2);
    const px = rock.x + Math.cos(angle) * r;
    const py = rock.y + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rock.color === '#607d8b' ? '#37474f' : '#5d4037';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function tracePath(ctx: CanvasRenderingContext2D, path: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
}

export function drawWaterFlow(
  ctx: CanvasRenderingContext2D,
  flow: WaterFlow,
  time: number
): void {
  if (flow.path.length < 2) return;

  ctx.save();
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (flow.blocked) {
    const pulse = 0.5 + 0.3 * Math.sin(time * 6);

    ctx.strokeStyle = '#c62828';
    ctx.globalAlpha = pulse;
    ctx.setLineDash([6, 8]);
    tracePath(ctx, flow.path);
    ctx.stroke();

    const middle = flow.path[Math.floor(flow.path.length / 2)];
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(198, 40, 40, ${Math.min(1, pulse + 0.3)})`;
    ctx.beginPath();
    ctx.arc(middle.x, middle.y, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', middle.x, middle.y + 0.5);
    ctx.restore();
    return;
  }

  ctx.strokeStyle = '#1e88e5';
  ctx.globalAlpha = 0.8;
  tracePath(ctx, flow.path);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 15]);
  ctx.lineDashOffset = -time * 30;
  tracePath(ctx, flow.path);
  ctx.stroke();

  const progress = (flow.flowProgress + time * 0.5) % 1;
  const totalLength = flow.path.reduce((sum, p, i) => {
    if (i === 0) return 0;
    const dx = p.x - flow.path[i - 1].x;
    const dy = p.y - flow.path[i - 1].y;
    return sum + Math.sqrt(dx * dx + dy * dy);
  }, 0);

  const targetDist = progress * totalLength;
  let currentDist = 0;
  for (let i = 1; i < flow.path.length; i++) {
    const dx = flow.path[i].x - flow.path[i - 1].x;
    const dy = flow.path[i].y - flow.path[i - 1].y;
    const segLength = Math.sqrt(dx * dx + dy * dy);

    if (currentDist + segLength >= targetDist) {
      const t = (targetDist - currentDist) / segLength;
      const x = flow.path[i - 1].x + dx * t;
      const y = flow.path[i - 1].y + dy * t;

      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    currentDist += segLength;
  }

  ctx.restore();
}

export function drawCalligraphy(
  ctx: CanvasRenderingContext2D,
  calligraphy: Calligraphy
): void {
  if (calligraphy.points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = calligraphy.color;
  ctx.lineWidth = calligraphy.thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;

  ctx.beginPath();
  ctx.moveTo(calligraphy.points[0].x, calligraphy.points[0].y);

  for (let i = 1; i < calligraphy.points.length; i++) {
    const prev = calligraphy.points[i - 1];
    const curr = calligraphy.points[i];
    const cpx = (prev.x + curr.x) / 2;
    const cpy = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
  }

  if (calligraphy.points.length >= 2) {
    const last = calligraphy.points[calligraphy.points.length - 1];
    const prev = calligraphy.points[calligraphy.points.length - 2];
    ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
  }

  ctx.stroke();
  ctx.restore();
}
