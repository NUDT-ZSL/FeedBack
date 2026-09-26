export interface Point {
  x: number;
  y: number;
  time: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

export interface StrokesManagerOptions {
  maxUndoSteps?: number;
}

export class StrokesManager {
  private strokes: Stroke[] = [];
  private undoStack: Stroke[] = [];
  private maxUndoSteps: number;
  private currentStroke: Stroke | null = null;
  private lastPoint: Point | null = null;
  private controlPoint: Point | null = null;

  constructor(options: StrokesManagerOptions = {}) {
    this.maxUndoSteps = options.maxUndoSteps ?? 30;
  }

  startStroke(x: number, y: number, color: string, width: number): void {
    const point: Point = { x, y, time: Date.now() };
    this.currentStroke = {
      points: [point],
      color,
      width
    };
    this.lastPoint = point;
    this.controlPoint = point;
  }

  continueStroke(x: number, y: number): Point[] {
    if (!this.currentStroke || !this.lastPoint || !this.controlPoint) {
      return [];
    }

    const point: Point = { x, y, time: Date.now() };
    const newPoints = this.smoothPoints(this.controlPoint, this.lastPoint, point);
    
    for (const p of newPoints) {
      this.currentStroke.points.push(p);
    }
    
    this.controlPoint = this.lastPoint;
    this.lastPoint = point;
    
    return newPoints;
  }

  endStroke(): Stroke | null {
    if (!this.currentStroke || this.currentStroke.points.length < 2) {
      this.currentStroke = null;
      this.lastPoint = null;
      this.controlPoint = null;
      return null;
    }

    const completedStroke = this.currentStroke;
    this.strokes.push(completedStroke);
    this.undoStack = [];
    this.currentStroke = null;
    this.lastPoint = null;
    this.controlPoint = null;

    return completedStroke;
  }

  private smoothPoints(p0: Point, p1: Point, p2: Point): Point[] {
    const points: Point[] = [];
    const steps = Math.max(3, Math.floor(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3));
    
    const cp1x = p0.x + (p1.x - p0.x) * 0.5;
    const cp1y = p0.y + (p1.y - p0.y) * 0.5;
    const cp2x = p1.x + (p2.x - p1.x) * 0.5;
    const cp2y = p1.y + (p2.y - p1.y) * 0.5;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * mt * p0.x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * p2.x;
      const y = mt * mt * mt * p0.y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * p2.y;
      points.push({ x, y, time: p1.time + t * (p2.time - p1.time) });
    }
    
    return points;
  }

  undo(): Stroke | null {
    if (this.strokes.length === 0) {
      return null;
    }
    const stroke = this.strokes.pop()!;
    this.undoStack.push(stroke);
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
    return stroke;
  }

  redo(): Stroke | null {
    if (this.undoStack.length === 0) {
      return null;
    }
    const stroke = this.undoStack.pop()!;
    this.strokes.push(stroke);
    return stroke;
  }

  clear(): void {
    this.strokes = [];
    this.undoStack = [];
    this.currentStroke = null;
    this.lastPoint = null;
    this.controlPoint = null;
  }

  getStrokes(): Stroke[] {
    return [...this.strokes];
  }

  getStrokeCount(): number {
    return this.strokes.length;
  }

  canUndo(): boolean {
    return this.strokes.length > 0;
  }

  canRedo(): boolean {
    return this.undoStack.length > 0;
  }

  getNormalizedPoints(strokes?: Stroke[]): Point[] {
    const targetStrokes = strokes || this.strokes;
    if (targetStrokes.length === 0) {
      return [];
    }

    const allPoints: Point[] = [];
    for (const stroke of targetStrokes) {
      for (const point of stroke.points) {
        allPoints.push(point);
      }
    }

    if (allPoints.length === 0) {
      return [];
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of allPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    const scale = Math.max(width, height);
    const offsetX = minX + width / 2;
    const offsetY = minY + height / 2;

    return allPoints.map(p => ({
      x: (p.x - offsetX) / scale,
      y: (p.y - offsetY) / scale,
      time: p.time
    }));
  }

  exportStrokes(): Stroke[] {
    return JSON.parse(JSON.stringify(this.strokes));
  }
}
