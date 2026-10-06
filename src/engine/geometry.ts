import type { Point, Rect } from '../types.ts';

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * 从矩形中心朝 target 方向发射线，返回与矩形边界的交点。
 * 用于把连线端点吸附到卡片 / 折叠卡组容器的边界上。
 */
export function boundaryPoint(rect: Rect, target: Point): Point {
  const c = rectCenter(rect);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(scaleX, scaleY);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** 判断点是否位于矩形边界上（带容差），供验证脚本断言吸附结果 */
export function isOnRectBoundary(p: Point, rect: Rect, tolerance = 0.5): boolean {
  const onVertical =
    (Math.abs(p.x - rect.x) <= tolerance || Math.abs(p.x - (rect.x + rect.width)) <= tolerance) &&
    p.y >= rect.y - tolerance &&
    p.y <= rect.y + rect.height + tolerance;
  const onHorizontal =
    (Math.abs(p.y - rect.y) <= tolerance || Math.abs(p.y - (rect.y + rect.height)) <= tolerance) &&
    p.x >= rect.x - tolerance &&
    p.x <= rect.x + rect.width + tolerance;
  return onVertical || onHorizontal;
}
