import { Point, Stroke } from './strokes-manager';

export interface RecognitionResult {
  character: string;
  confidence: number;
  bestMatch: string;
}

interface CharTemplate {
  char: string;
  features: Features;
  strokeCount: number;
}

interface Features {
  strokeCount: number;
  aspectRatio: number;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  directionHistogram: number[];
  boundingBox: { x: number; y: number; width: number; height: number };
  centerOfMass: { x: number; y: number };
  perimeter: number;
  density: number;
}

const DIRECTION_BINS = 8;
const GRID_SIZE = 5;

export class RecognitionEngine {
  private templates: CharTemplate[] = [];
  private readonly CONFIDENCE_THRESHOLD = 0.6;

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    const templateDefs: { char: string; strokes: Point[][] }[] = [
      { char: '0', strokes: [this.generateCirclePoints()] },
      { char: '1', strokes: [this.generateLinePoints(0, -1, 0, 1)] },
      { char: '2', strokes: [this.generateTwoPoints()] },
      { char: '3', strokes: [this.generateThreePoints()] },
      { char: '4', strokes: [this.generateFourPoints()] },
      { char: '5', strokes: [this.generateFivePoints()] },
      { char: '6', strokes: [this.generateSixPoints()] },
      { char: '7', strokes: [this.generateSevenPoints()] },
      { char: '8', strokes: [this.generateEightPoints()] },
      { char: '9', strokes: [this.generateNinePoints()] },
      
      { char: 'a', strokes: [this.generateALowerPoints()] },
      { char: 'b', strokes: [this.generateBLowerPoints()] },
      { char: 'c', strokes: [this.generateCLowerPoints()] },
      { char: 'd', strokes: [this.generateDLowerPoints()] },
      { char: 'e', strokes: [this.generateELowerPoints()] },
      { char: 'f', strokes: [this.generateFLowerPoints()] },
      { char: 'g', strokes: [this.generateGLowerPoints()] },
      { char: 'h', strokes: [this.generateHLowerPoints()] },
      { char: 'i', strokes: [this.generateILowerPoints()] },
      { char: 'j', strokes: [this.generateJLowerPoints()] },
      { char: 'k', strokes: [this.generateKLowerPoints()] },
      { char: 'l', strokes: [this.generateLLowerPoints()] },
      { char: 'm', strokes: [this.generateMLowerPoints()] },
      { char: 'n', strokes: [this.generateNLowerPoints()] },
      { char: 'o', strokes: [this.generateOLowerPoints()] },
      { char: 'p', strokes: [this.generatePLowerPoints()] },
      { char: 'q', strokes: [this.generateQLowerPoints()] },
      { char: 'r', strokes: [this.generateRLowerPoints()] },
      { char: 's', strokes: [this.generateSLowerPoints()] },
      { char: 't', strokes: [this.generateTLowerPoints()] },
      { char: 'u', strokes: [this.generateULowerPoints()] },
      { char: 'v', strokes: [this.generateVLowerPoints()] },
      { char: 'w', strokes: [this.generateWLowerPoints()] },
      { char: 'x', strokes: [this.generateXLowerPoints()] },
      { char: 'y', strokes: [this.generateYLowerPoints()] },
      { char: 'z', strokes: [this.generateZLowerPoints()] },
    ];

    for (const def of templateDefs) {
      const strokes = def.strokes.map(points => ({ points, color: '#000', width: 3 }));
      const features = this.extractFeatures(strokes);
      this.templates.push({
        char: def.char,
        features,
        strokeCount: def.strokes.length
      });
    }
  }

  private generateCirclePoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 36; i++) {
      const angle = (i / 36) * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.5, y: Math.sin(angle) * 0.5, time: i });
    }
    return points;
  }

  private generateLinePoints(x1: number, y1: number, x2: number, y2: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, time: i });
    }
    return points;
  }

  private generateTwoPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      let x, y;
      if (t < 0.4) {
        const a = t / 0.4;
        x = -0.4 + a * 0.8;
        y = -0.5 + a * 0.3;
      } else if (t < 0.7) {
        const a = (t - 0.4) / 0.3;
        x = 0.4 - a * 0.8;
        y = -0.2 + a * 0.5;
      } else {
        const a = (t - 0.7) / 0.3;
        x = -0.4 + a * 0.8;
        y = 0.3 + a * 0.2;
      }
      points.push({ x, y, time: i });
    }
    return points;
  }

  private generateThreePoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      let x, y;
      if (t < 0.5) {
        const a = t / 0.5;
        const angle = Math.PI * 0.3 + a * Math.PI * 1.2;
        x = Math.cos(angle) * 0.4;
        y = Math.sin(angle) * 0.3 - 0.1;
      } else {
        const a = (t - 0.5) / 0.5;
        const angle = Math.PI * 1.5 + a * Math.PI * 1.2;
        x = Math.cos(angle) * 0.4;
        y = Math.sin(angle) * 0.3 + 0.1;
      }
      points.push({ x, y, time: i });
    }
    return points;
  }

  private generateFourPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      points.push({ x: -0.3 + t * 0.6, y: 0.5 - t * 1.0, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.3, y: -0.5 + (i / 15) * 1.0, time: 20 + i });
    }
    return points;
  }

  private generateFivePoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.3 - i / 15 * 0.6, y: -0.5, time: i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: -0.3, y: -0.5 + i / 10 * 0.4, time: 15 + i });
    }
    for (let i = 0; i <= 20; i++) {
      const angle = Math.PI * 0.5 + (i / 20) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.3 - 0.1, time: 25 + i });
    }
    return points;
  }

  private generateSixPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 10; i++) {
      points.push({ x: 0.3 - i / 10 * 0.3, y: -0.5 + i / 10 * 0.2, time: i });
    }
    for (let i = 0; i <= 30; i++) {
      const angle = Math.PI * 0.5 + (i / 30) * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.4 + 0.0, time: 10 + i });
    }
    return points;
  }

  private generateSevenPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.4 + i / 15 * 0.8, y: -0.5, time: i });
    }
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.4 - i / 20 * 0.3, y: -0.5 + i / 20 * 1.0, time: 15 + i });
    }
    return points;
  }

  private generateEightPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const angle = t * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.28 - 0.22, time: i });
    }
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const angle = t * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.28 + 0.22, time: 30 + i });
    }
    return points;
  }

  private generateNinePoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 30; i++) {
      const angle = Math.PI * 1.5 + (i / 30) * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.4, time: i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: 0.0, y: 0.1 - i / 10 * 0.6, time: 30 + i });
    }
    return points;
  }

  private generateALowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      const angle = Math.PI * 0.3 + (i / 25) * Math.PI * 1.8;
      points.push({ x: Math.cos(angle) * 0.4, y: Math.sin(angle) * 0.4 + 0.1, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.1, y: 0.3 - (i / 15) * 0.8, time: 25 + i });
    }
    return points;
  }

  private generateBLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: -0.3, y: -0.5 + i / 20 * 1.0, time: i });
    }
    for (let i = 0; i <= 25; i++) {
      const angle = Math.PI * 0.5 + (i / 25) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.3, y: Math.sin(angle) * 0.3 - 0.2, time: 20 + i });
    }
    for (let i = 0; i <= 25; i++) {
      const angle = Math.PI * 0.5 + (i / 25) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.3 + 0.2, time: 45 + i });
    }
    return points;
  }

  private generateCLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      const angle = Math.PI * 0.3 + (i / 25) * Math.PI * 1.4;
      points.push({ x: Math.cos(angle) * 0.4, y: Math.sin(angle) * 0.4, time: i });
    }
    return points;
  }

  private generateDLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: -0.3, y: -0.4 + i / 20 * 0.8, time: i });
    }
    for (let i = 0; i <= 30; i++) {
      const angle = Math.PI * 0.5 + (i / 30) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.4, time: 20 + i });
    }
    return points;
  }

  private generateELowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.3, y: -0.4 + i / 20 * 0.8, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.3 - i / 15 * 0.6, y: -0.4, time: 20 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.3 - i / 15 * 0.5, y: 0.0, time: 35 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.3 - i / 15 * 0.6, y: 0.4, time: 50 + i });
    }
    return points;
  }

  private generateFLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      points.push({ x: 0.2, y: -0.5 + i / 25 * 1.0, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.2 - i / 15 * 0.5, y: -0.5, time: 25 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.2 - i / 15 * 0.4, y: 0.0, time: 40 + i });
    }
    return points;
  }

  private generateGLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 28; i++) {
      const angle = Math.PI * 0.2 + (i / 28) * Math.PI * 1.8;
      points.push({ x: Math.cos(angle) * 0.4, y: Math.sin(angle) * 0.4, time: i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: 0.2, y: 0.2 + i / 10 * 0.2, time: 28 + i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: 0.2 - i / 10 * 0.2, y: 0.4, time: 38 + i });
    }
    return points;
  }

  private generateHLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      points.push({ x: -0.3, y: -0.5 + i / 25 * 1.0, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.3 + i / 15 * 0.6, y: 0.0, time: 25 + i });
    }
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.3, y: 0.0 - i / 20 * 0.5, time: 40 + i });
    }
    return points;
  }

  private generateILowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 18; i++) {
      points.push({ x: 0.0, y: -0.3 + i / 18 * 0.6, time: i });
    }
    return points;
  }

  private generateJLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 18; i++) {
      points.push({ x: 0.1, y: -0.3 + i / 18 * 0.6, time: i });
    }
    for (let i = 0; i <= 12; i++) {
      const angle = Math.PI * 1.5 + (i / 12) * Math.PI;
      points.push({ x: 0.1 + Math.cos(angle) * 0.15, y: 0.3 + Math.sin(angle) * 0.15, time: 18 + i });
    }
    return points;
  }

  private generateKLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      points.push({ x: -0.2, y: -0.5 + i / 25 * 1.0, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.2 + i / 15 * 0.5, y: 0.0 - i / 15 * 0.4, time: 25 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.2 + i / 15 * 0.5, y: 0.0 + i / 15 * 0.4, time: 40 + i });
    }
    return points;
  }

  private generateLLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      points.push({ x: 0.0, y: -0.5 + i / 25 * 1.0, time: i });
    }
    return points;
  }

  private generateMLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.4, y: 0.3 - i / 15 * 0.6, time: i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: -0.4 + i / 10 * 0.3, y: -0.3 + i / 10 * 0.3, time: 15 + i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: -0.1 + i / 10 * 0.3, y: 0.0 - i / 10 * 0.3, time: 25 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.2, y: -0.3 + i / 15 * 0.6, time: 35 + i });
    }
    return points;
  }

  private generateNLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: -0.3, y: 0.3 - i / 20 * 0.6, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.3 + i / 15 * 0.6, y: -0.3 + i / 15 * 0.6, time: 20 + i });
    }
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.3, y: -0.3 + i / 20 * 0.6, time: 35 + i });
    }
    return points;
  }

  private generateOLowerPoints(): Point[] {
    return this.generateCirclePoints().map(p => ({ ...p, y: p.y * 0.8 }));
  }

  private generatePLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      points.push({ x: -0.3, y: -0.5 + i / 25 * 1.0, time: i });
    }
    for (let i = 0; i <= 25; i++) {
      const angle = Math.PI * 0.5 + (i / 25) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.3, y: Math.sin(angle) * 0.3 - 0.1, time: 25 + i });
    }
    return points;
  }

  private generateQLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.35, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.1 + i / 15 * 0.2, y: 0.2 + i / 15 * 0.3, time: 28 + i });
    }
    return points;
  }

  private generateRLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: -0.2, y: -0.3 + i / 20 * 0.6, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      const angle = Math.PI * 0.5 + (i / 15) * Math.PI * 0.8;
      points.push({ x: Math.cos(angle) * 0.25, y: Math.sin(angle) * 0.2 - 0.1, time: 20 + i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: 0.1 + i / 10 * 0.3, y: -0.1 - i / 10 * 0.2, time: 35 + i });
    }
    return points;
  }

  private generateSLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 18; i++) {
      const angle = Math.PI * 0.3 + (i / 18) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.3, y: Math.sin(angle) * 0.25 - 0.15, time: i });
    }
    for (let i = 0; i <= 18; i++) {
      const angle = Math.PI * 1.3 + (i / 18) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.3, y: Math.sin(angle) * 0.25 + 0.15, time: 18 + i });
    }
    return points;
  }

  private generateTLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 25; i++) {
      points.push({ x: 0.0, y: -0.5 + i / 25 * 0.8, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.3 + i / 15 * 0.6, y: -0.5, time: 25 + i });
    }
    return points;
  }

  private generateULowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.3, y: -0.3 + i / 15 * 0.3, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      const angle = Math.PI * 0.5 + (i / 15) * Math.PI;
      points.push({ x: Math.cos(angle) * 0.3, y: Math.sin(angle) * 0.25 + 0.0, time: 15 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.3, y: 0.0 - i / 15 * 0.3, time: 30 + i });
    }
    return points;
  }

  private generateVLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: -0.4 + i / 20 * 0.4, y: -0.3 + i / 20 * 0.6, time: i });
    }
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.0 + i / 20 * 0.4, y: 0.3 - i / 20 * 0.6, time: 20 + i });
    }
    return points;
  }

  private generateWLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 12; i++) {
      points.push({ x: -0.45 + i / 12 * 0.25, y: -0.2 + i / 12 * 0.4, time: i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: -0.2 + i / 10 * 0.2, y: 0.2 - i / 10 * 0.3, time: 12 + i });
    }
    for (let i = 0; i <= 10; i++) {
      points.push({ x: 0.0 + i / 10 * 0.2, y: -0.1 + i / 10 * 0.3, time: 22 + i });
    }
    for (let i = 0; i <= 12; i++) {
      points.push({ x: 0.2 + i / 12 * 0.25, y: 0.2 - i / 12 * 0.4, time: 32 + i });
    }
    return points;
  }

  private generateXLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push({ x: -0.4 + i / 20 * 0.8, y: -0.4 + i / 20 * 0.8, time: i });
    }
    return points;
  }

  private generateYLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.35 + i / 15 * 0.35, y: -0.4 + i / 15 * 0.4, time: i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.0 + i / 15 * 0.35, y: 0.0 - i / 15 * 0.4, time: 15 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: 0.0, y: 0.0 + i / 15 * 0.4, time: 30 + i });
    }
    return points;
  }

  private generateZLowerPoints(): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.35 + i / 15 * 0.7, y: -0.3, time: i });
    }
    for (let i = 0; i <= 20; i++) {
      points.push({ x: 0.35 - i / 20 * 0.7, y: -0.3 + i / 20 * 0.6, time: 15 + i });
    }
    for (let i = 0; i <= 15; i++) {
      points.push({ x: -0.35 + i / 15 * 0.7, y: 0.3, time: 35 + i });
    }
    return points;
  }

  recognize(strokes: Stroke[]): RecognitionResult {
    if (strokes.length === 0) {
      return { character: '', confidence: 0, bestMatch: '' };
    }

    const inputFeatures = this.extractFeatures(strokes);
    
    let bestChar = '';
    let bestConfidence = 0;
    let secondBest = '';
    let secondConfidence = 0;

    for (const template of this.templates) {
      const similarity = this.calculateSimilarity(inputFeatures, template.features);
      
      if (similarity > bestConfidence) {
        secondBest = bestChar;
        secondConfidence = bestConfidence;
        bestChar = template.char;
        bestConfidence = similarity;
      } else if (similarity > secondConfidence) {
        secondBest = template.char;
        secondConfidence = similarity;
      }
    }

    if (bestConfidence >= this.CONFIDENCE_THRESHOLD) {
      return {
        character: bestChar,
        confidence: Math.round(bestConfidence * 100),
        bestMatch: bestChar
      };
    } else {
      return {
        character: '',
        confidence: Math.round(bestConfidence * 100),
        bestMatch: bestChar
      };
    }
  }

  private extractFeatures(strokes: Stroke[]): Features {
    const allPoints: Point[] = [];
    for (const stroke of strokes) {
      for (const point of stroke.points) {
        allPoints.push(point);
      }
    }

    const normalized = this.normalizePoints(allPoints);
    const { minX, minY, maxX, maxY } = this.getBounds(normalized);
    const width = maxX - minX || 0.001;
    const height = maxY - minY || 0.001;

    const firstPoint = normalized[0];
    const lastPoint = normalized[normalized.length - 1];

    const directionHistogram = this.calculateDirectionHistogram(normalized);
    const centerOfMass = this.calculateCenterOfMass(normalized);
    const perimeter = this.calculatePerimeter(normalized);
    const density = this.calculateDensity(normalized, width, height);

    return {
      strokeCount: strokes.length,
      aspectRatio: width / height,
      startPoint: { x: firstPoint.x, y: firstPoint.y },
      endPoint: { x: lastPoint.x, y: lastPoint.y },
      directionHistogram,
      boundingBox: { x: minX, y: minY, width, height },
      centerOfMass,
      perimeter,
      density
    };
  }

  private normalizePoints(points: Point[]): Point[] {
    if (points.length === 0) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    const scale = Math.max(width, height);

    return points.map(p => ({
      x: (p.x - minX - width / 2) / scale,
      y: (p.y - minY - height / 2) / scale,
      time: p.time
    }));
  }

  private getBounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  private calculateDirectionHistogram(points: Point[]): number[] {
    const histogram = new Array(DIRECTION_BINS).fill(0);
    if (points.length < 2) return histogram;

    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const length = Math.hypot(dx, dy);
      
      if (length > 0.001) {
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += Math.PI * 2;
        
        const binIndex = Math.floor((angle / (Math.PI * 2)) * DIRECTION_BINS) % DIRECTION_BINS;
        histogram[binIndex] += length;
        total += length;
      }
    }

    if (total > 0) {
      for (let i = 0; i < DIRECTION_BINS; i++) {
        histogram[i] /= total;
      }
    }

    return histogram;
  }

  private calculateCenterOfMass(points: Point[]): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    
    let sumX = 0, sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    
    return {
      x: sumX / points.length,
      y: sumY / points.length
    };
  }

  private calculatePerimeter(points: Point[]): number {
    if (points.length < 2) return 0;
    
    let perimeter = 0;
    for (let i = 1; i < points.length; i++) {
      perimeter += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y
      );
    }
    return perimeter;
  }

  private calculateDensity(points: Point[], width: number, height: number): number {
    if (points.length < 2 || width * height === 0) return 0;
    
    const grid: boolean[][] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      grid[i] = new Array(GRID_SIZE).fill(false);
    }

    const cellW = width / GRID_SIZE;
    const cellH = height / GRID_SIZE;

    for (const p of points) {
      const gx = Math.min(Math.floor((p.x + width / 2) / cellW), GRID_SIZE - 1);
      const gy = Math.min(Math.floor((p.y + height / 2) / cellH), GRID_SIZE - 1);
      if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
        grid[gy][gx] = true;
      }
    }

    let filled = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (grid[i][j]) filled++;
      }
    }

    return filled / (GRID_SIZE * GRID_SIZE);
  }

  private calculateSimilarity(f1: Features, f2: Features): number {
    let totalWeight = 0;
    let totalScore = 0;

    const strokeCountDiff = Math.abs(f1.strokeCount - f2.strokeCount);
    const strokeCountScore = strokeCountDiff === 0 ? 1 : strokeCountDiff === 1 ? 0.5 : 0;
    totalScore += strokeCountScore * 0.15;
    totalWeight += 0.15;

    const aspectRatioDiff = Math.abs(f1.aspectRatio - f2.aspectRatio);
    const aspectRatioScore = Math.max(0, 1 - aspectRatioDiff);
    totalScore += aspectRatioScore * 0.1;
    totalWeight += 0.1;

    const startDist = Math.hypot(f1.startPoint.x - f2.startPoint.x, f1.startPoint.y - f2.startPoint.y);
    const startScore = Math.max(0, 1 - startDist * 2);
    totalScore += startScore * 0.1;
    totalWeight += 0.1;

    const endDist = Math.hypot(f1.endPoint.x - f2.endPoint.x, f1.endPoint.y - f2.endPoint.y);
    const endScore = Math.max(0, 1 - endDist * 2);
    totalScore += endScore * 0.1;
    totalWeight += 0.1;

    let dirSim = 0;
    for (let i = 0; i < DIRECTION_BINS; i++) {
      dirSim += Math.min(f1.directionHistogram[i], f2.directionHistogram[i]);
    }
    totalScore += dirSim * 0.3;
    totalWeight += 0.3;

    const comDist = Math.hypot(f1.centerOfMass.x - f2.centerOfMass.x, f1.centerOfMass.y - f2.centerOfMass.y);
    const comScore = Math.max(0, 1 - comDist * 3);
    totalScore += comScore * 0.1;
    totalWeight += 0.1;

    const densityDiff = Math.abs(f1.density - f2.density);
    const densityScore = Math.max(0, 1 - densityDiff * 3);
    totalScore += densityScore * 0.1;
    totalWeight += 0.1;

    const perimeterDiff = Math.abs(f1.perimeter - f2.perimeter);
    const perimeterScore = Math.max(0, 1 - perimeterDiff);
    totalScore += perimeterScore * 0.05;
    totalWeight += 0.05;

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }
}
