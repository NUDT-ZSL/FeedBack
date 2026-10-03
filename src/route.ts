import * as THREE from 'three';
import {
  generateSmoothPath,
  calculatePathMetrics,
  type PathMetrics,
  type TerrainData
} from './terrain';

export interface RouteSnapshot {
  controlPoints: THREE.Vector3[];
  smoothedPath: THREE.Vector3[];
  metrics: PathMetrics;
  version: number;
}

export type RouteListener = (snapshot: RouteSnapshot) => void;

const DEFAULT_SEGMENTS_PER_CURVE = 15;

export class RouteStore {
  private terrainData: TerrainData;
  private segmentsPerCurve: number;
  private controlPoints: THREE.Vector3[] = [];
  private snapshot: RouteSnapshot;
  private listeners: RouteListener[] = [];

  constructor(terrainData: TerrainData, segmentsPerCurve: number = DEFAULT_SEGMENTS_PER_CURVE) {
    this.terrainData = terrainData;
    this.segmentsPerCurve = segmentsPerCurve;
    this.snapshot = this.buildSnapshot();
  }

  private buildSnapshot(): RouteSnapshot {
    const smoothedPath = generateSmoothPath(
      this.controlPoints,
      this.terrainData,
      this.segmentsPerCurve
    );
    return {
      controlPoints: this.controlPoints.map(p => p.clone()),
      smoothedPath,
      metrics: calculatePathMetrics(smoothedPath),
      version: (this.snapshot?.version ?? 0) + 1
    };
  }

  private commit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  public getSnapshot(): RouteSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: RouteListener): () => void {
    this.listeners.push(listener);
    listener(this.snapshot);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public setPoints(points: THREE.Vector3[]): void {
    this.controlPoints = points.map(p => p.clone());
    this.commit();
  }

  public addPoint(point: THREE.Vector3): void {
    this.controlPoints.push(point.clone());
    this.commit();
  }

  public removePoint(index: number): void {
    if (index < 0 || index >= this.controlPoints.length) return;
    this.controlPoints.splice(index, 1);
    this.commit();
  }

  public findNearbyControlPoint(point: THREE.Vector3, threshold: number = 15): number {
    for (let i = 0; i < this.controlPoints.length; i++) {
      const dx = point.x - this.controlPoints[i].x;
      const dz = point.z - this.controlPoints[i].z;
      if (Math.sqrt(dx * dx + dz * dz) < threshold) {
        return i;
      }
    }
    return -1;
  }

  public nearestSmoothedIndex(point: THREE.Vector3): number {
    const path = this.snapshot.smoothedPath;
    if (path.length === 0) return -1;
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < path.length; i++) {
      const dx = point.x - path[i].x;
      const dz = point.z - path[i].z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
}

export interface RoamFrame {
  position: THREE.Vector3;
  lookTarget: THREE.Vector3;
}

const MIN_ROAM_SPEED = 2;
const MAX_ROAM_SPEED = 100;
const LOOK_AHEAD_DISTANCE = 30;

export class RoamController {
  private path: THREE.Vector3[] = [];
  private cumulative: number[] = [];
  private totalLength: number = 0;
  private distance: number = 0;
  private speed: number = 30;

  public setPath(path: THREE.Vector3[], keepProgress: boolean = true): void {
    const ratio = keepProgress && this.totalLength > 0
      ? this.distance / this.totalLength
      : 0;

    if (path.length >= 2) {
      const first = path[0];
      const last = path[path.length - 1];
      const alreadyClosed = first.distanceTo(last) < 1e-6;
      this.path = alreadyClosed ? path.slice() : [...path, first.clone()];
    } else {
      this.path = path.slice();
    }
    this.cumulative = [0];
    for (let i = 1; i < this.path.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + this.path[i - 1].distanceTo(this.path[i]));
    }
    this.totalLength = this.cumulative[this.cumulative.length - 1] ?? 0;

    this.distance = this.totalLength > 0 ? ratio * this.totalLength : 0;
  }

  public get isReady(): boolean {
    return this.path.length >= 2 && this.totalLength > 1e-6;
  }

  public getTotalLength(): number {
    return this.totalLength;
  }

  public getDistance(): number {
    return this.distance;
  }

  public setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.speed = Math.max(MIN_ROAM_SPEED, Math.min(MAX_ROAM_SPEED, speed));
  }

  public getSpeed(): number {
    return this.speed;
  }

  public reset(): void {
    this.distance = 0;
  }

  public update(deltaTime: number): void {
    if (!this.isReady) return;
    const dt = Math.max(0, Math.min(deltaTime, 0.5));
    this.distance = (this.distance + this.speed * dt) % this.totalLength;
  }

  private sampleAt(targetDistance: number): { position: THREE.Vector3; direction: THREE.Vector3 } {
    const d = ((targetDistance % this.totalLength) + this.totalLength) % this.totalLength;

    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] <= d) lo = mid;
      else hi = mid;
    }

    const segStart = this.cumulative[lo];
    const segLength = this.cumulative[lo + 1] - segStart;
    const t = segLength > 1e-9 ? (d - segStart) / segLength : 0;

    const a = this.path[lo];
    const b = this.path[lo + 1];
    const position = new THREE.Vector3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t
    );
    const direction = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    if (direction.lengthSq() > 1e-12) {
      direction.normalize();
    }

    return { position, direction };
  }

  public getFrame(): RoamFrame | null {
    if (!this.isReady) return null;

    const { position, direction } = this.sampleAt(this.distance);
    const lookSample = this.sampleAt(this.distance + LOOK_AHEAD_DISTANCE);

    const lookTarget = lookSample.position.clone();
    lookTarget.y += 10;

    const cameraOffset = new THREE.Vector3(0, 25, -10);
    if (direction.lengthSq() > 1e-12) {
      cameraOffset.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.atan2(direction.x, direction.z)
      );
    }

    const cameraPosition = position.clone().add(cameraOffset);
    cameraPosition.y += 15;

    return { position: cameraPosition, lookTarget };
  }
}
