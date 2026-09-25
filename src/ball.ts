export interface Vector2 {
  x: number;
  y: number;
}

export interface Fence {
  start: Vector2;
  end: Vector2;
  normal: Vector2;
}

type TerrainType = 'grass' | 'sand' | 'uphill' | 'downhill';

export interface TerrainZone {
  type: TerrainType;
  center: Vector2;
  radius: number;
  slopeAngle?: number;
  slopeDirection?: Vector2;
}

export class Ball {
  position: Vector2;
  velocity: Vector2;
  radius: number;
  isMoving: boolean;
  isInHole: boolean;
  holeScale: number;

  constructor(x: number, y: number) {
    this.position = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.radius = 10;
    this.isMoving = false;
    this.isInHole = false;
    this.holeScale = 1;
  }

  reset(x: number, y: number): void {
    this.position = { x, y };
    this.velocity = { x: 0, y: 0 };
    this.isMoving = false;
    this.isInHole = false;
    this.holeScale = 1;
  }

  applyForce(direction: Vector2, power: number): void {
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (length > 0) {
      this.velocity.x = (direction.x / length) * power;
      this.velocity.y = (direction.y / length) * power;
      this.isMoving = true;
    }
  }

  update(
    deltaTime: number,
    terrainZones: TerrainZone[],
    fences: Fence[],
    holePosition: Vector2,
    holeRadius: number
  ): void {
    if (this.isInHole) {
      this.holeScale = Math.max(0, this.holeScale - deltaTime * 2);
      return;
    }

    if (!this.isMoving) return;

    const currentTerrain = this.getCurrentTerrain(terrainZones);
    let friction = 0.985;
    let slopeForce: Vector2 = { x: 0, y: 0 };
    let directionDeviation = 0;

    switch (currentTerrain.type) {
      case 'sand':
        friction = 0.92;
        break;
      case 'uphill':
        friction = 0.97;
        if (currentTerrain.slopeDirection && currentTerrain.slopeAngle) {
          const slopeForceMag = Math.sin(currentTerrain.slopeAngle) * 0.15;
          slopeForce.x = -currentTerrain.slopeDirection.x * slopeForceMag;
          slopeForce.y = -currentTerrain.slopeDirection.y * slopeForceMag;
          directionDeviation = currentTerrain.slopeAngle * 0.3;
        }
        break;
      case 'downhill':
        friction = 0.99;
        if (currentTerrain.slopeDirection && currentTerrain.slopeAngle) {
          const slopeForceMag = Math.sin(currentTerrain.slopeAngle) * 0.2;
          slopeForce.x = currentTerrain.slopeDirection.x * slopeForceMag;
          slopeForce.y = currentTerrain.slopeDirection.y * slopeForceMag;
          directionDeviation = currentTerrain.slopeAngle * 0.5;
        }
        break;
    }

    if (directionDeviation > 0) {
      const deviationAngle = (Math.random() - 0.5) * directionDeviation;
      const cos = Math.cos(deviationAngle);
      const sin = Math.sin(deviationAngle);
      const newVx = this.velocity.x * cos - this.velocity.y * sin;
      const newVy = this.velocity.x * sin + this.velocity.y * cos;
      this.velocity.x = newVx;
      this.velocity.y = newVy;
    }

    this.velocity.x += slopeForce.x;
    this.velocity.y += slopeForce.y;

    this.position.x += this.velocity.x * deltaTime * 60;
    this.position.y += this.velocity.y * deltaTime * 60;

    this.velocity.x *= friction;
    this.velocity.y *= friction;

    this.checkFenceCollision(fences);

    const distToHole = Math.sqrt(
      Math.pow(this.position.x - holePosition.x, 2) +
      Math.pow(this.position.y - holePosition.y, 2)
    );
    if (distToHole < holeRadius) {
      const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
      if (speed < 8 || distToHole < holeRadius * 0.5) {
        this.isInHole = true;
        this.velocity = { x: 0, y: 0 };
        this.isMoving = false;
        return;
      }
    }

    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (speed < 0.1) {
      this.velocity = { x: 0, y: 0 };
      this.isMoving = false;
    }
  }

  private getCurrentTerrain(terrainZones: TerrainZone[]): TerrainZone {
    for (const zone of terrainZones) {
      const dist = Math.sqrt(
        Math.pow(this.position.x - zone.center.x, 2) +
        Math.pow(this.position.y - zone.center.y, 2)
      );
      if (dist < zone.radius) {
        return zone;
      }
    }
    return {
      type: 'grass',
      center: { x: 0, y: 0 },
      radius: 0
    };
  }

  private checkFenceCollision(fences: Fence[]): void {
    for (const fence of fences) {
      const collision = this.lineCircleCollision(
        fence.start,
        fence.end,
        this.position,
        this.radius
      );

      if (collision.collides) {
        const dot = this.velocity.x * fence.normal.x + this.velocity.y * fence.normal.y;
        this.velocity.x = this.velocity.x - 2 * dot * fence.normal.x;
        this.velocity.y = this.velocity.y - 2 * dot * fence.normal.y;

        this.velocity.x *= 0.7;
        this.velocity.y *= 0.7;

        if (collision.point) {
          const pushDist = this.radius - collision.distance + 1;
          this.position.x += fence.normal.x * pushDist;
          this.position.y += fence.normal.y * pushDist;
        }
      }
    }
  }

  private lineCircleCollision(
    p1: Vector2,
    p2: Vector2,
    center: Vector2,
    radius: number
  ): { collides: boolean; point?: Vector2; distance: number } {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const dot = ((center.x - p1.x) * dx + (center.y - p1.y) * dy) / (len * len);

    const closestX = p1.x + dot * dx;
    const closestY = p1.y + dot * dy;

    const onSegment = dot >= 0 && dot <= 1;
    if (!onSegment) {
      const dist1 = Math.sqrt(Math.pow(center.x - p1.x, 2) + Math.pow(center.y - p1.y, 2));
      const dist2 = Math.sqrt(Math.pow(center.x - p2.x, 2) + Math.pow(center.y - p2.y, 2));
      return { collides: Math.min(dist1, dist2) < radius, distance: Math.min(dist1, dist2) };
    }

    const dist = Math.sqrt(Math.pow(center.x - closestX, 2) + Math.pow(center.y - closestY, 2));
    return {
      collides: dist < radius,
      point: { x: closestX, y: closestY },
      distance: dist
    };
  }

  render(ctx: CanvasRenderingContext2D, tiltAngle: number): void {
    ctx.save();
    ctx.translate(this.position.x, this.position.y);
    ctx.scale(1, Math.cos(tiltAngle));
    ctx.scale(this.holeScale, this.holeScale);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(2, 3, this.radius, this.radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    const gradient = ctx.createRadialGradient(
      -this.radius * 0.3, -this.radius * 0.3, 0,
      0, 0, this.radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.7, '#f0f0f0');
    gradient.addColorStop(1, '#d0d0d0');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(-this.radius * 0.3, -this.radius * 0.3, this.radius * 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
