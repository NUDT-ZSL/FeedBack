export class Paddle {
  x: number;
  y: number;
  width: number;
  height: number;
  velocity: number;
  isDragging: boolean;
  private canvasWidth: number;
  private lastMouseX: number;
  private lastDelta: number;
  private damping: number = 0.85;
  private reboundFactor: number = 0.3;

  constructor(x: number, y: number, width: number = 100, height: number = 15) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.velocity = 0;
    this.isDragging = false;
    this.canvasWidth = 0;
    this.lastMouseX = 0;
    this.lastDelta = 0;
  }

  setCanvasWidth(width: number): void {
    this.canvasWidth = width;
  }

  handleMouseDown(clientX: number, canvasRect: DOMRect): void {
    const scaleX = this.canvasWidth / canvasRect.width;
    const x = (clientX - canvasRect.left) * scaleX;

    if (x >= this.x && x <= this.x + this.width) {
      this.isDragging = true;
      this.lastMouseX = x;
      this.lastDelta = 0;
    }
  }

  handleMouseMove(clientX: number, canvasRect: DOMRect): void {
    const scaleX = this.canvasWidth / canvasRect.width;
    const x = (clientX - canvasRect.left) * scaleX;

    if (this.isDragging) {
      const delta = x - this.lastMouseX;
      this.lastDelta = delta;
      this.velocity = delta;
      this.x += delta;
      this.lastMouseX = x;
      this.constrainPosition();
    }
  }

  handleMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.velocity = -this.lastDelta * this.reboundFactor;
    }
  }

  handleTouchStart(touch: Touch, canvasRect: DOMRect): void {
    this.handleMouseDown(touch.clientX, canvasRect);
  }

  handleTouchMove(touch: Touch, canvasRect: DOMRect): void {
    this.handleMouseMove(touch.clientX, canvasRect);
  }

  handleTouchEnd(): void {
    this.handleMouseUp();
  }

  update(): void {
    if (!this.isDragging && Math.abs(this.velocity) > 0.1) {
      this.velocity *= this.damping;
      this.x += this.velocity;
      this.constrainPosition();
    } else if (!this.isDragging) {
      this.velocity = 0;
    }
  }

  private constrainPosition(): void {
    if (this.x < 0) {
      this.x = 0;
      this.velocity = -this.velocity * 0.5;
    }
    if (this.x + this.width > this.canvasWidth) {
      this.x = this.canvasWidth - this.width;
      this.velocity = -this.velocity * 0.5;
    }
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.velocity = 0;
    this.isDragging = false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    const radius = this.height / 2;
    ctx.beginPath();
    ctx.moveTo(this.x + radius, this.y);
    ctx.lineTo(this.x + this.width - radius, this.y);
    ctx.quadraticCurveTo(this.x + this.width, this.y, this.x + this.width, this.y + radius);
    ctx.lineTo(this.x + this.width, this.y + this.height - radius);
    ctx.quadraticCurveTo(
      this.x + this.width,
      this.y + this.height,
      this.x + this.width - radius,
      this.y + this.height
    );
    ctx.lineTo(this.x + radius, this.y + this.height);
    ctx.quadraticCurveTo(this.x, this.y + this.height, this.x, this.y + this.height - radius);
    ctx.lineTo(this.x, this.y + radius);
    ctx.quadraticCurveTo(this.x, this.y, this.x + radius, this.y);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.height);
    gradient.addColorStop(0, '#00d2ff');
    gradient.addColorStop(1, '#3a7bd5');

    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    ctx.shadowBlur = 15;
    ctx.fill();

    ctx.restore();
  }

  getCenterX(): number {
    return this.x + this.width / 2;
  }
}
