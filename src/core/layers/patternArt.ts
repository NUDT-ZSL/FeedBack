/**
 * 纹样矢量素材：8 种古风印花全部以过程式图元生成（100x100 坐标系，中心为 0,0）。
 * 不依赖任何外部 SVG/网络资源；带随机感的纹样（冰裂纹）使用固定种子，逐次一致。
 */

import { seededRandom } from '../rng';
import type { DrawOp, Point } from '../displayList';
import type { PatternType } from '../types';

const INK = '#5c3a21';
const JADE = '#3f6b57';
const BLUE_INK = '#34506e';

function polygonPoints(cx: number, cy: number, radius: number, sides: number, rotation = 0): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (Math.PI * 2 * i) / sides;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

function plum(): DrawOp[] {
  const ops: DrawOp[] = [];
  const petalCount = 5;
  for (let i = 0; i < petalCount; i += 1) {
    const angle = (Math.PI * 2 * i) / petalCount - Math.PI / 2;
    ops.push({
      kind: 'ellipse',
      cx: 16 * Math.cos(angle),
      cy: 16 * Math.sin(angle),
      rx: 12,
      ry: 16,
      rotation: (angle * 180) / Math.PI + 90,
      fill: INK,
    });
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6;
    ops.push({ kind: 'line', x1: 0, y1: 0, x2: 10 * Math.cos(angle), y2: 10 * Math.sin(angle), stroke: INK, lineWidth: 1.4 });
  }
  ops.push({ kind: 'polygon', points: polygonPoints(0, 0, 7, 5, -Math.PI / 2), fill: '#8a5a2b' });
  // 梅枝
  ops.push({ kind: 'line', x1: -46, y1: 46, x2: -8, y2: 8, stroke: INK, lineWidth: 4 });
  ops.push({ kind: 'line', x1: -30, y1: 32, x2: -44, y2: 18, stroke: INK, lineWidth: 2.4 });
  return ops;
}

function orchid(): DrawOp[] {
  const ops: DrawOp[] = [];
  // 兰叶：狭长椭圆按角度散开
  const leaves = [-42, -20, 2, 24, 46];
  leaves.forEach((deg, i) => {
    ops.push({
      kind: 'ellipse',
      cx: Math.sin((deg * Math.PI) / 180) * 18,
      cy: -Math.cos((deg * Math.PI) / 180) * 18 + 6,
      rx: 6,
      ry: 34,
      rotation: deg,
      fill: JADE,
      alpha: 0.9 - i * 0.08,
    });
  });
  // 兰花
  for (let i = 0; i < 5; i += 1) {
    const angle = (Math.PI * 2 * i) / 5;
    ops.push({ kind: 'ellipse', cx: 10 * Math.cos(angle), cy: 22 + 10 * Math.sin(angle), rx: 7, ry: 9, rotation: (angle * 180) / Math.PI, fill: '#7d4e57' });
  }
  return ops;
}

function bamboo(): DrawOp[] {
  const ops: DrawOp[] = [];
  // 竹干三节
  for (let i = 0; i < 3; i += 1) {
    const y = -34 + i * 30;
    ops.push({ kind: 'rect', x: -8, y, w: 16, h: 26, fill: JADE });
    ops.push({ kind: 'line', x1: -8, y1: y + 26, x2: 8, y2: y + 26, stroke: INK, lineWidth: 1.6 });
  }
  // 竹叶
  const leaf = (cx: number, cy: number, deg: number): DrawOp => ({
    kind: 'ellipse',
    cx,
    cy,
    rx: 4.5,
    ry: 17,
    rotation: deg,
    fill: JADE,
  });
  ops.push(leaf(-18, -28, -45), leaf(20, -30, 40), leaf(-22, 4, -50), leaf(22, 6, 48), leaf(-14, 34, -38));
  return ops;
}

function chrysanthemum(): DrawOp[] {
  const ops: DrawOp[] = [];
  for (let ring = 0; ring < 2; ring += 1) {
    const count = ring === 0 ? 14 : 9;
    const radius = ring === 0 ? 24 : 13;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + (ring ? Math.PI / count : 0);
      ops.push({
        kind: 'ellipse',
        cx: radius * Math.cos(angle),
        cy: radius * Math.sin(angle),
        rx: 5,
        ry: 14,
        rotation: (angle * 180) / Math.PI + 90,
        fill: BLUE_INK,
        alpha: ring ? 0.95 : 0.7,
      });
    }
  }
  ops.push({ kind: 'polygon', points: polygonPoints(0, 0, 7, 6), fill: '#8a5a2b' });
  return ops;
}

function cloud(): DrawOp[] {
  const ops: DrawOp[] = [];
  const blobs: [number, number, number][] = [
    [-20, 6, 16],
    [0, -6, 20],
    [22, 6, 15],
  ];
  blobs.forEach(([cx, cy, r]) => {
    ops.push({ kind: 'ellipse', cx, cy, rx: r, ry: r * 0.8, stroke: BLUE_INK, lineWidth: 2.4 });
  });
  // 祥云卷尾
  ops.push({ kind: 'ellipse', cx: -34, cy: 16, rx: 8, ry: 8, stroke: BLUE_INK, lineWidth: 2.4 });
  ops.push({ kind: 'ellipse', cx: 36, cy: 16, rx: 6, ry: 6, stroke: BLUE_INK, lineWidth: 2.4 });
  ops.push({ kind: 'line', x1: -42, y1: 22, x2: 42, y2: 22, stroke: BLUE_INK, lineWidth: 2.4 });
  return ops;
}

function wave(): DrawOp[] {
  // 水纹：三排正弦折线（折线近似弧，无随机，逐次一致）
  const ops: DrawOp[] = [];
  for (let row = -1; row <= 1; row += 1) {
    const baseY = row * 26;
    const points: Point[] = [];
    for (let i = 0; i <= 24; i += 1) {
      const x = -44 + (88 * i) / 24;
      points.push({ x, y: baseY + 7 * Math.sin((i / 24) * Math.PI * 4 + (row + 1)) });
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      ops.push({
        kind: 'line',
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
        stroke: BLUE_INK,
        lineWidth: 2.2,
      });
    }
  }
  return ops;
}

function fret(): DrawOp[] {
  // 回纹：回字形折线
  const pts: Point[] = [
    { x: -42, y: -42 },
    { x: 42, y: -42 },
    { x: 42, y: 42 },
    { x: -42, y: 42 },
    { x: -42, y: -18 },
    { x: 18, y: -18 },
    { x: 18, y: 18 },
    { x: -18, y: 18 },
    { x: -18, y: -6 },
    { x: 6, y: -6 },
  ];
  return pts.slice(0, -1).map((pt, i) => ({
    kind: 'line' as const,
    x1: pt.x,
    y1: pt.y,
    x2: pts[i + 1].x,
    y2: pts[i + 1].y,
    stroke: INK,
    lineWidth: 3,
  }));
}

function ice(): DrawOp[] {
  // 冰裂纹：固定种子的折线网络，逐次渲染完全一致
  const rng = seededRandom('pattern:ice:v1');
  const ops: DrawOp[] = [];
  let x = -44;
  let y = -44;
  for (let i = 0; i < 7; i += 1) {
    const nx = -44 + rng() * 88;
    const ny = -44 + rng() * 88;
    ops.push({ kind: 'line', x1: x, y1: y, x2: nx, y2: ny, stroke: BLUE_INK, lineWidth: 1.6 });
    if (rng() > 0.4) {
      ops.push({ kind: 'line', x1: nx, y1: ny, x2: -44 + rng() * 88, y2: -44 + rng() * 88, stroke: BLUE_INK, lineWidth: 1.2 });
    }
    x = nx;
    y = ny;
  }
  return ops;
}

const GENERATORS: Record<PatternType, () => DrawOp[]> = {
  plum,
  orchid,
  bamboo,
  chrysanthemum,
  cloud,
  wave,
  fret,
  ice,
};

/** 生成某类纹样的图元（100x100 坐标盒，结果冻结） */
export function buildPatternArt(type: PatternType): readonly DrawOp[] {
  const ops = GENERATORS[type]();
  ops.forEach(Object.freeze);
  return Object.freeze(ops);
}
