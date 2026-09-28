export enum VehicleState {
  Moving = 'moving',
  Queued = 'queued',
  Passing = 'passing',
  Exited = 'exited'
}

export enum Direction {
  North = 'north',
  South = 'south',
  East = 'east',
  West = 'west'
}

export class Vehicle {
  x: number;
  y: number;
  speed: number;
  direction: Direction;
  state: VehicleState = VehicleState.Moving;
  waitStartTime: number = 0;
  totalWaitTime: number = 0;
  lane: number;
  width: number = 20;
  height: number = 10;
  id: number;
  private static nextId: number = 0;

  constructor(x: number, y: number, direction: Direction, lane: number, speed: number = 80) {
    this.x = x;
    this.y = y;
    this.direction = direction;
    this.lane = lane;
    this.speed = speed;
    this.id = Vehicle.nextId++;
  }

  static resetIdCounter(): void {
    Vehicle.nextId = 0;
  }

  update(dt: number): void {
    if (this.state === VehicleState.Queued) {
      return;
    }

    const moveAmount = this.speed * dt;
    switch (this.direction) {
      case Direction.North:
        this.y -= moveAmount;
        break;
      case Direction.South:
        this.y += moveAmount;
        break;
      case Direction.East:
        this.x += moveAmount;
        break;
      case Direction.West:
        this.x -= moveAmount;
        break;
    }
  }

  startWaiting(currentTime: number): void {
    if (this.state !== VehicleState.Queued) {
      this.state = VehicleState.Queued;
      this.waitStartTime = currentTime;
    }
  }

  stopWaiting(currentTime: number): void {
    if (this.state === VehicleState.Queued) {
      this.totalWaitTime += currentTime - this.waitStartTime;
      this.state = VehicleState.Passing;
    }
  }

  getWaitTime(currentTime: number): number {
    let w = this.totalWaitTime;
    if (this.state === VehicleState.Queued) {
      w += currentTime - this.waitStartTime;
    }
    return w;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    const isVertical = this.direction === Direction.North || this.direction === Direction.South;
    const w = isVertical ? this.height : this.width;
    const h = isVertical ? this.width : this.height;

    ctx.translate(this.x, this.y);

    if (this.state === VehicleState.Passing) {
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 8;
    } else if (this.state === VehicleState.Queued) {
      ctx.shadowColor = '#ff3333';
      ctx.shadowBlur = 4;
    } else {
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 3;
    }

    ctx.fillStyle = this.state === VehicleState.Queued ? '#0099bb' : '#00d4ff';
    ctx.beginPath();
    const r = 3;
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    ctx.fill();

    ctx.shadowBlur = 0;

    if (isVertical) {
      const headY = this.direction === Direction.North ? -h / 2 : h / 2;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(-w / 2 + 2, headY - 2, w - 4, 2);
      ctx.globalAlpha = 1;
    } else {
      const headX = this.direction === Direction.East ? w / 2 : -w / 2;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.7;
      ctx.fillRect(headX - 2, -h / 2 + 2, 2, h - 4);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}
