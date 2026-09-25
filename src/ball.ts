export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
}

export class Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  baseSpeed: number;

  constructor(x: number, y: number, radius: number = 8) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.baseSpeed = 6;
    this.speed = this.baseSpeed;
    this.vx = 0;
    this.vy = 0;
  }

  launch(angle: number = -Math.PI / 2): void {
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
  }

  increaseSpeed(factor: number): void {
    this.baseSpeed *= factor;
    this.speed = this.baseSpeed;
    const currentAngle = Math.atan2(this.vy, this.vx);
    if (this.vx !== 0 || this.vy !== 0) {
      this.vx = Math.cos(currentAngle) * this.speed;
      this.vy = Math.sin(currentAngle) * this.speed;
    }
  }

  update(canvasWidth: number, canvasHeight: number): boolean {
    this.x += this.vx;
    this.y += this.vy;

    if (this.x - this.radius < 0) {
      this.x = this.radius;
      this.reflectHorizontal();
      this.addRandomAngleOffset();
    } else if (this.x + this.radius > canvasWidth) {
      this.x = canvasWidth - this.radius;
      this.reflectHorizontal();
      this.addRandomAngleOffset();
    }

    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.reflectVertical();
      this.addRandomAngleOffset();
    }

    return this.y + this.radius > canvasHeight;
  }

  reflectHorizontal(): void {
    this.vx = -this.vx;
  }

  reflectVertical(): void {
    this.vy = -this.vy;
  }

  addRandomAngleOffset(): void {
    const offsetRange = (15 * Math.PI) / 180;
    const offset = (Math.random() - 0.5) * 2 * offsetRange;
    const currentAngle = Math.atan2(this.vy, this.vx);
    const newAngle = currentAngle + offset;
    this.vx = Math.cos(newAngle) * this.speed;
    this.vy = Math.sin(newAngle) * this.speed;
  }

  checkPaddleCollision(
    paddleX: number,
    paddleY: number,
    paddleWidth: number,
    paddleHeight: number
  ): boolean {
    const closestX = Math.max(paddleX, Math.min(this.x, paddleX + paddleWidth));
    const closestY = Math.max(paddleY, Math.min(this.y, paddleY + paddleHeight));
    const distanceX = this.x - closestX;
    const distanceY = this.y - closestY;
    const distanceSquared = distanceX * distanceX + distanceY * distanceY;

    if (distanceSquared < this.radius * this.radius && this.vy > 0) {
      const hitPoint = (this.x - paddleX) / paddleWidth - 0.5;
      const maxAngle = (60 * Math.PI) / 180;
      const baseAngle = -Math.PI / 2 + hitPoint * maxAngle;
      this.vx = Math.cos(baseAngle) * this.speed;
      this.vy = Math.sin(baseAngle) * this.speed;
      this.addRandomAngleOffset();
      this.y = paddleY - this.radius;
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(
      this.x - 2,
      this.y - 2,
      0,
      this.x,
      this.y,
      this.radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.5, '#f0f0f0');
    gradient.addColorStop(1, '#cccccc');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.restore();
  }

  getState(): BallState {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      radius: this.radius,
      speed: this.speed
    };
  }
}
