import tinycolor from 'tinycolor2';

export interface ColorStop {
  id: string;
  color: string;
  position: number;
}

export type GradientType = 'linear' | 'radial' | 'conic';

export interface GradientConfig {
  type: GradientType;
  angle: number;
  centerX: number;
  centerY: number;
}

export class GradientEngine {
  private stops: ColorStop[];
  private config: GradientConfig;

  constructor(stops: ColorStop[], config: GradientConfig) {
    this.stops = [...stops].sort((a, b) => a.position - b.position);
    this.config = { ...config };
  }

  getStopsSorted(): ColorStop[] {
    return [...this.stops].sort((a, b) => a.position - b.position);
  }

  generateGradientDef(id: string = 'cardGradient'): string {
    const sorted = this.getStopsSorted();
    const stopStr = sorted
      .map(
        s =>
          `<stop offset="${s.position.toFixed(2)}%" stop-color="${this.escapeColor(s.color)}" />`
      )
      .join('');

    switch (this.config.type) {
      case 'linear': {
        const { x1, y1, x2, y2 } = this.angleToCoords(this.config.angle);
        return `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stopStr}</linearGradient>`;
      }
      case 'radial': {
        const cx = this.config.centerX;
        const cy = this.config.centerY;
        return `<radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="75%" fx="${cx}%" fy="${cy}%">${stopStr}</radialGradient>`;
      }
      case 'conic': {
        const angle = this.config.angle;
        return `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%" gradientTransform="rotate(${angle} .5 .5)">${stopStr}</linearGradient>`;
      }
      default:
        return '';
    }
  }

  generateConicCSS(): string {
    const sorted = this.getStopsSorted();
    const stopsStr = sorted
      .map(s => `${this.escapeColor(s.color)} ${s.position.toFixed(2)}%`)
      .join(', ');
    return `conic-gradient(from ${this.config.angle}deg at ${this.config.centerX}% ${this.config.centerY}%, ${stopsStr})`;
  }

  generateLinearCSS(): string {
    const sorted = this.getStopsSorted();
    const stopsStr = sorted
      .map(s => `${this.escapeColor(s.color)} ${s.position.toFixed(2)}%`)
      .join(', ');
    return `linear-gradient(${this.config.angle}deg, ${stopsStr})`;
  }

  generateRadialCSS(): string {
    const sorted = this.getStopsSorted();
    const stopsStr = sorted
      .map(s => `${this.escapeColor(s.color)} ${s.position.toFixed(2)}%`)
      .join(', ');
    return `radial-gradient(circle at ${this.config.centerX}% ${this.config.centerY}%, ${stopsStr})`;
  }

  generateCSS(): string {
    switch (this.config.type) {
      case 'linear':
        return this.generateLinearCSS();
      case 'radial':
        return this.generateRadialCSS();
      case 'conic':
        return this.generateConicCSS();
      default:
        return this.generateLinearCSS();
    }
  }

  interpolateColorAt(position: number): string {
    const sorted = this.getStopsSorted();
    if (sorted.length === 0) return '#000000';
    if (sorted.length === 1) return sorted[0].color;
    if (position <= sorted[0].position) return sorted[0].color;
    if (position >= sorted[sorted.length - 1].position)
      return sorted[sorted.length - 1].color;

    for (let i = 0; i < sorted.length - 1; i++) {
      const left = sorted[i];
      const right = sorted[i + 1];
      if (position >= left.position && position <= right.position) {
        const ratio =
          (position - left.position) / (right.position - left.position);
        const c1 = tinycolor(left.color);
        const c2 = tinycolor(right.color);
        const r = Math.round(c1.toRgb().r + (c2.toRgb().r - c1.toRgb().r) * ratio);
        const g = Math.round(c1.toRgb().g + (c2.toRgb().g - c1.toRgb().g) * ratio);
        const b = Math.round(c1.toRgb().b + (c2.toRgb().b - c1.toRgb().b) * ratio);
        return tinycolor({ r, g, b }).toHexString();
      }
    }
    return sorted[sorted.length - 1].color;
  }

  private angleToCoords(angle: number): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } {
    const rad = ((angle - 90) * Math.PI) / 180;
    const centerX = 50;
    const centerY = 50;
    const length = 50;
    const x2 = centerX + Math.cos(rad) * length;
    const y2 = centerY + Math.sin(rad) * length;
    const x1 = centerX - Math.cos(rad) * length;
    const y1 = centerY - Math.sin(rad) * length;
    return {
      x1: Math.max(0, Math.min(100, x1)),
      y1: Math.max(0, Math.min(100, y1)),
      x2: Math.max(0, Math.min(100, x2)),
      y2: Math.max(0, Math.min(100, y2)),
    };
  }

  private escapeColor(color: string): string {
    return color.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  static generateId(): string {
    return 'stop_' + Math.random().toString(36).slice(2, 10);
  }

  static createDefaultStops(): ColorStop[] {
    return [
      { id: GradientEngine.generateId(), color: '#7c4dff', position: 0 },
      { id: GradientEngine.generateId(), color: '#536dfe', position: 20 },
      { id: GradientEngine.generateId(), color: '#448aff', position: 40 },
      { id: GradientEngine.generateId(), color: '#40c4ff', position: 60 },
      { id: GradientEngine.generateId(), color: '#18ffff', position: 80 },
      { id: GradientEngine.generateId(), color: '#64ffda', position: 100 },
    ];
  }

  static createDefaultConfig(): GradientConfig {
    return {
      type: 'linear',
      angle: 135,
      centerX: 50,
      centerY: 50,
    };
  }
}
