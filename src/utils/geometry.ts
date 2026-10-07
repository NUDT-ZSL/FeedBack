import type { Card, CardGroup, Point, Rect } from '../types.ts';
import { GROUP_CHIP_HEIGHT, GROUP_CHIP_WIDTH, GROUP_HEADER_HEIGHT, GROUP_PADDING } from '../types.ts';

export function cardRect(card: Pick<Card, 'x' | 'y' | 'width' | 'height'>): Rect {
  return { x: card.x, y: card.y, width: card.width, height: card.height };
}

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

export function rectContainsPoint(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

/** 折叠卡组在画布上的摘要容器矩形 */
export function collapsedGroupRect(group: CardGroup): Rect {
  return { x: group.x, y: group.y, width: GROUP_CHIP_WIDTH, height: GROUP_CHIP_HEIGHT };
}

/** 展开卡组的包围盒（成员卡片并集 + 内边距 + 顶部标题栏），空组退化为标题条 */
export function expandedGroupRect(group: CardGroup, cardsById: Map<string, Card>): Rect {
  const members = group.memberIds
    .map((id) => cardsById.get(id))
    .filter((c): c is Card => c !== undefined);
  if (members.length === 0) {
    return { x: group.x, y: group.y, width: GROUP_CHIP_WIDTH, height: GROUP_HEADER_HEIGHT + GROUP_PADDING };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + m.width);
    maxY = Math.max(maxY, m.y + m.height);
  }
  return {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
    width: maxX - minX + GROUP_PADDING * 2,
    height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
  };
}

/** 卡组当前在画布上的可视矩形（折叠=摘要容器，展开=成员包围盒） */
export function groupRect(group: CardGroup, cardsById: Map<string, Card>): Rect {
  return group.collapsed ? collapsedGroupRect(group) : expandedGroupRect(group, cardsById);
}

/**
 * 从矩形中心向目标点引射线，返回射线与矩形边界的交点。
 * 用于把连线端点吸附到卡片/卡组容器的边界上。
 */
export function boundaryPoint(rect: Rect, toward: Point): Point {
  const c = rectCenter(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(scaleX, scaleY);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
