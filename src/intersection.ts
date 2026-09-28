import { Vehicle, VehicleState, Direction } from './vehicle';
import { TrafficLight, LightState } from './trafficLight';

export interface IntersectionStats {
  totalVehicles: number;
  averageWaitTime: number;
  totalPassed: number;
}

export class Intersection {
  vehicles: Vehicle[] = [];
  private passedCount: number = 0;
  private cx: number;
  private cy: number;
  private roadWidth: number;
  private laneWidth: number;
  private stopLineOffset: number;
  private vehicleGap: number = 26;

  constructor(cx: number, cy: number, roadWidth: number) {
    this.cx = cx;
    this.cy = cy;
    this.roadWidth = roadWidth;
    this.laneWidth = roadWidth / 2;
    this.stopLineOffset = roadWidth / 2 + 4;
  }

  getStopPosition(dir: Direction): number {
    switch (dir) {
      case Direction.North: return this.cy - this.stopLineOffset;
      case Direction.South: return this.cy + this.stopLineOffset;
      case Direction.East: return this.cx + this.stopLineOffset;
      case Direction.West: return this.cx - this.stopLineOffset;
    }
  }

  getLanePosition(dir: Direction, lane: number): { x: number; y: number } {
    const offset = (lane + 0.5) * this.laneWidth * 0.5;
    switch (dir) {
      case Direction.North:
        return { x: this.cx + this.laneWidth * 0.25 + offset, y: this.cy + this.roadWidth / 2 + 600 };
      case Direction.South:
        return { x: this.cx - this.laneWidth * 0.25 - offset, y: this.cy - this.roadWidth / 2 - 600 };
      case Direction.East:
        return { x: this.cx - this.roadWidth / 2 - 600, y: this.cy + this.laneWidth * 0.25 + offset };
      case Direction.West:
        return { x: this.cx + this.roadWidth / 2 + 600, y: this.cy - this.laneWidth * 0.25 - offset };
    }
  }

  addVehicle(): void {
    if (this.vehicles.length >= 200) return;

    const dirs = [Direction.North, Direction.South, Direction.East, Direction.West];
    const dir = dirs[Math.floor(Math.random() * dirs.length)];
    const lane = Math.floor(Math.random() * 2);
    const pos = this.getLanePosition(dir, lane);
    const speed = 70 + Math.random() * 30;
    const v = new Vehicle(pos.x, pos.y, dir, lane, speed);

    const sameLaneVehicles = this.vehicles.filter(
      o => o.direction === dir && o.lane === lane && o.state !== VehicleState.Exited
    );
    if (sameLaneVehicles.length > 0) {
      const last = sameLaneVehicles[sameLaneVehicles.length - 1];
      const gap = this.getGapFromStop(last, dir);
      if (gap < this.vehicleGap) return;
    }

    this.vehicles.push(v);
  }

  private getGapFromStop(v: Vehicle, dir: Direction): number {
    const stop = this.getStopPosition(dir);
    switch (dir) {
      case Direction.North: return stop - v.y;
      case Direction.South: return v.y - stop;
      case Direction.East: return v.x - stop;
      case Direction.West: return stop - v.x;
    }
  }

  update(dt: number, currentTime: number, trafficLight: TrafficLight): void {
    const status = trafficLight.getStatus();

    for (const v of this.vehicles) {
      if (v.state === VehicleState.Exited) continue;

      const shouldStop = this.shouldStop(v, status);
      const vehicleAhead = this.getVehicleAhead(v);

      if (shouldStop) {
        const stopPos = this.getStopPosition(v.direction);
        const atStopLine = this.isAtOrPastStopLine(v, stopPos);
        if (!atStopLine) {
          if (vehicleAhead && this.isTooClose(v, vehicleAhead)) {
            v.startWaiting(currentTime);
          } else {
            v.state = VehicleState.Moving;
            v.update(dt);
          }
        } else {
          v.startWaiting(currentTime);
        }
      } else {
        if (vehicleAhead && this.isTooClose(v, vehicleAhead)) {
          v.startWaiting(currentTime);
        } else {
          if (v.state === VehicleState.Queued) {
            v.stopWaiting(currentTime);
          }
          v.update(dt);
        }
      }

      this.checkExit(v);
    }

    this.vehicles = this.vehicles.filter(v => v.state !== VehicleState.Exited);
  }

  private shouldStop(v: Vehicle, status: { ns: LightState; ew: LightState }): boolean {
    const isNS = v.direction === Direction.North || v.direction === Direction.South;
    const light = isNS ? status.ns : status.ew;
    const stopPos = this.getStopPosition(v.direction);
    const beforeStop = this.isBeforeStopLine(v, stopPos);
    return (light === LightState.Red || light === LightState.Yellow) && beforeStop;
  }

  private isBeforeStopLine(v: Vehicle, stopPos: number): boolean {
    switch (v.direction) {
      case Direction.North: return v.y > stopPos;
      case Direction.South: return v.y < stopPos;
      case Direction.East: return v.x < stopPos;
      case Direction.West: return v.x > stopPos;
    }
  }

  private isAtOrPastStopLine(v: Vehicle, stopPos: number): boolean {
    const threshold = 4;
    switch (v.direction) {
      case Direction.North: return v.y <= stopPos + threshold;
      case Direction.South: return v.y >= stopPos - threshold;
      case Direction.East: return v.x >= stopPos - threshold;
      case Direction.West: return v.x <= stopPos + threshold;
    }
  }

  private getVehicleAhead(v: Vehicle): Vehicle | null {
    const same = this.vehicles.filter(
      o => o !== v &&
        o.direction === v.direction &&
        o.lane === v.lane &&
        o.state !== VehicleState.Exited
    );

    let closest: Vehicle | null = null;
    let closestDist = Infinity;

    for (const o of same) {
      const d = this.getDirectionalDistance(v, o);
      if (d > 0 && d < closestDist) {
        closestDist = d;
        closest = o;
      }
    }

    return closest;
  }

  private getDirectionalDistance(behind: Vehicle, ahead: Vehicle): number {
    switch (behind.direction) {
      case Direction.North: return behind.y - ahead.y;
      case Direction.South: return ahead.y - behind.y;
      case Direction.East: return ahead.x - behind.x;
      case Direction.West: return behind.x - ahead.x;
    }
  }

  private isTooClose(v: Vehicle, ahead: Vehicle): boolean {
    return this.getDirectionalDistance(v, ahead) < this.vehicleGap;
  }

  private checkExit(v: Vehicle): void {
    const margin = 700;
    switch (v.direction) {
      case Direction.North:
        if (v.y < this.cy - margin) this.markExit(v);
        break;
      case Direction.South:
        if (v.y > this.cy + margin) this.markExit(v);
        break;
      case Direction.East:
        if (v.x > this.cx + margin) this.markExit(v);
        break;
      case Direction.West:
        if (v.x < this.cx - margin) this.markExit(v);
        break;
    }
  }

  private markExit(v: Vehicle): void {
    if (v.state !== VehicleState.Exited) {
      v.state = VehicleState.Exited;
      this.passedCount++;
    }
  }

  getStats(currentTime: number): IntersectionStats {
    const active = this.vehicles.filter(v => v.state !== VehicleState.Exited);
    const totalWait = active.reduce((sum, v) => sum + v.getWaitTime(currentTime), 0);
    const avgWait = active.length > 0 ? totalWait / active.length : 0;

    return {
      totalVehicles: active.length,
      averageWaitTime: Math.round(avgWait * 10) / 10,
      totalPassed: this.passedCount
    };
  }

  reset(): void {
    this.vehicles = [];
    this.passedCount = 0;
    Vehicle.resetIdCounter();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const hw = this.roadWidth / 2;

    ctx.fillStyle = '#2d3a4a';
    ctx.fillRect(this.cx - hw, this.cy - 700, this.roadWidth, 1400);
    ctx.fillRect(this.cx - 700, this.cy - hw, 1400, this.roadWidth);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);

    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy - 700);
    ctx.lineTo(this.cx, this.cy - hw - 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy + hw + 4);
    ctx.lineTo(this.cx, this.cy + 700);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(this.cx - 700, this.cy);
    ctx.lineTo(this.cx - hw - 4, this.cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(this.cx + hw + 4, this.cy);
    ctx.lineTo(this.cx + 700, this.cy);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.cx - hw, this.cy - hw);
    ctx.lineTo(this.cx + hw, this.cy - hw);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.cx - hw, this.cy + hw);
    ctx.lineTo(this.cx + hw, this.cy + hw);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.cx - hw, this.cy - hw);
    ctx.lineTo(this.cx - hw, this.cy + hw);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.cx + hw, this.cy - hw);
    ctx.lineTo(this.cx + hw, this.cy + hw);
    ctx.stroke();

    const islandSize = 12;
    ctx.fillStyle = '#1a2332';
    ctx.strokeStyle = '#3d4f5f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(this.cx - islandSize, this.cy - islandSize, islandSize * 2, islandSize * 2, 4);
    ctx.fill();
    ctx.stroke();

    for (const v of this.vehicles) {
      if (v.state !== VehicleState.Exited) {
        v.draw(ctx);
      }
    }
  }
}
