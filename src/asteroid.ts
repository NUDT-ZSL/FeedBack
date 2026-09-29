export type AsteroidType = 'obstacle' | 'resource' | 'fast';

export interface Vector2D {
  x: number;
  y: number;
}

const CANVAS_SIZE = 400;

export class Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: AsteroidType;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  vertices: Vector2D[];
  health: number;

  constructor(type?: AsteroidType) {
    this.type = type ?? this.randomType();
    this.radius = 15 + Math.random() * 15;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (0.02 + Math.random() * 0.03) * (Math.random() > 0.5 ? 1 : -1);
    this.vertices = this.generateVertices();
    this.health = this.type === 'resource' ? 1 : 1;

    const side = Math.floor(Math.random() * 4);
    switch (side) {
      case 0:
        this.x = Math.random() * CANVAS_SIZE;
        this.y = -this.radius;
        break;
      case 1:
        this.x = CANVAS_SIZE + this.radius;
        this.y = Math.random() * CANVAS_SIZE;
        break;
      case 2:
        this.x = Math.random() * CANVAS_SIZE;
        this.y = CANVAS_SIZE + this.radius;
        break;
      default:
        this.x = -this.radius;
        this.y = Math.random() * CANVAS_SIZE;
        break;
    }

    const centerX = CANVAS_SIZE / 2;
    const centerY = CANVAS_SIZE / 2;
    const angle = Math.atan2(centerY - this.y, centerX - this.x) + (Math.random() - 0.5) * 0.8;
    const baseSpeed = 0.6 + Math.random() * 0.6;
    const speed = this.type === 'fast' ? baseSpeed * 2 : baseSpeed;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
  }

  private randomType(): AsteroidType {
    const r = Math.random();
    if (r < 0.5) return 'obstacle';
    if (r < 0.8) return 'resource';
    return 'fast';
  }

  private generateVertices(): Vector2D[] {
    const count = 4 + Math.floor(Math.random() * 5);
    const verts: Vector2D[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = this.radius * (0.7 + Math.random() * 0.5);
      verts.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r
      });
    }
    return verts;
  }

  update(): void {
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotationSpeed;
  }

  isOffscreen(): boolean {
    const margin = this.radius + 50;
    return (
      this.x < -margin ||
      this.x > CANVAS_SIZE + margin ||
      this.y < -margin ||
      this.y > CANVAS_SIZE + margin
    );
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    let fillColor: string;
    let strokeColor: string;
    switch (this.type) {
      case 'obstacle':
        fillColor = '#6B7280';
        strokeColor = '#4B5563';
        break;
      case 'resource':
        fillColor = '#10B981';
        strokeColor = '#059669';
        break;
      case 'fast':
        fillColor = '#EF4444';
        strokeColor = '#DC2626';
        break;
    }

    ctx.beginPath();
    const first = this.vertices[0];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < this.vertices.length; i++) {
      ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }
}
