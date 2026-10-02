import type { Point } from '@/types';

export function generateQuadraticBezierPath(points: Point[]): string {
  if (points.length < 2) return '';
  
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    
    path += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)}, ${midX.toFixed(2)} ${midY.toFixed(2)}`;
    
    if (i === points.length - 1) {
      path += ` T ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
    }
  }
  
  return path;
}

export function pointToSvgCoord(
  clientX: number,
  clientY: number,
  svgRect: DOMRect
): Point {
  return {
    x: clientX - svgRect.left,
    y: clientY - svgRect.top,
  };
}

export function pxToThreeUnits(px: number, containerHeight: number): number {
  return (px / containerHeight) * 4;
}

export function threeUnitsToPx(units: number, containerHeight: number): number {
  return (units / 4) * containerHeight;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function calculateDamagedArea(width: number, height: number, ratio: number): number {
  return width * height * ratio;
}

export function calculateStrokeArea(pathLength: number, strokeWidth: number): number {
  return pathLength * strokeWidth;
}

export function calculateFillArea(radius: number): number {
  return Math.PI * radius * radius;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
