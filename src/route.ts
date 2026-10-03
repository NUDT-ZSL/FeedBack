import * as THREE from 'three';
import {
  generateSmoothPath,
  calculatePathMetrics,
  getHeightAt,
  type TerrainData,
  type PathMetrics
} from './terrain';

export interface RouteSnapshot {
  version: number;
  controlPoints: THREE.Vector3[];
  smoothedPath: THREE.Vector3[];
  metrics: PathMetrics;
}

export interface RoutePointInfo {
  pathIndex: number;
  point: THREE.Vector3;
  distance: number;
  slope: number;
}

export const PATH_SEGMENTS_PER_CURVE = 15;

export function buildRouteSnapshot(
  controlPoints: THREE.Vector3[],
  terrainData: TerrainData,
  version: number
): RouteSnapshot {
  const projected = controlPoints.map(point => {
    const y = getHeightAt(point.x, point.z, terrainData);
    return new THREE.Vector3(point.x, y, point.z);
  });
  const smoothedPath = generateSmoothPath(
    projected,
    terrainData,
    PATH_SEGMENTS_PER_CURVE
  );
  const metrics = calculatePathMetrics(smoothedPath);
  return { version, controlPoints: projected, smoothedPath, metrics };
}

export class RouteStore {
  private terrainData: TerrainData;
  private points: THREE.Vector3[] = [];
  private snapshotInternal: RouteSnapshot;
  private version = 0;

  constructor(terrainData: TerrainData, initialPoints: THREE.Vector3[] = []) {
    this.terrainData = terrainData;
    this.points = initialPoints.map(point => point.clone());
    this.snapshotInternal = buildRouteSnapshot([], this.terrainData, 0);
    this.commit();
  }

  getSnapshot(): RouteSnapshot {
    return this.snapshotInternal;
  }

  getControlPoints(): THREE.Vector3[] {
    return this.snapshotInternal.controlPoints;
  }

  addControlPoint(point: THREE.Vector3): RouteSnapshot {
    this.points.push(point.clone());
    return this.commit();
  }

  removeControlPointAt(index: number): RouteSnapshot {
    this.points.splice(index, 1);
    return this.commit();
  }

  findNearbyControlPoint(point: THREE.Vector3, threshold: number = 15): number {
    for (let i = 0; i < this.points.length; i++) {
      const dx = point.x - this.points[i].x;
      const dz = point.z - this.points[i].z;
      if (Math.sqrt(dx * dx + dz * dz) < threshold) {
        return i;
      }
    }
    return -1;
  }

  getPointInfoAt(point: THREE.Vector3): RoutePointInfo | null {
    const { smoothedPath, metrics } = this.snapshotInternal;
    if (smoothedPath.length === 0) return null;

    let bestIndex = 0;
    let bestDistanceSq = Infinity;
    for (let i = 0; i < smoothedPath.length; i++) {
      const candidate = smoothedPath[i];
      const dx = point.x - candidate.x;
      const dz = point.z - candidate.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = i;
      }
    }

    return {
      pathIndex: bestIndex,
      point: smoothedPath[bestIndex].clone(),
      distance: metrics.distances[bestIndex],
      slope: metrics.slopes[bestIndex]
    };
  }

  private commit(): RouteSnapshot {
    this.version += 1;
    this.snapshotInternal = buildRouteSnapshot(this.points, this.terrainData, this.version);
    return this.snapshotInternal;
  }
}

export interface RoamFrame {
  hasPath: boolean;
  moving: boolean;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  distance: number;
  totalDistance: number;
}

const MIN_SPEED = 1;
const MAX_SPEED = 200;
const MAX_FRAME_DELTA = 0.25;
const SEGMENT_EPSILON = 1e-6;

export class RoamSampler {
  private path: THREE.Vector3[] = [];
  private cumulative: number[] = [0];
  private totalLength = 0;
  private travel = 0;
  private speed = 25;

  setPath(path: THREE.Vector3[]): void {
    this.path = [];
    this.cumulative = [0];
    this.totalLength = 0;

    for (const point of path) {
      if (this.path.length === 0) {
        this.path.push(point.clone());
        continue;
      }
      const previous = this.path[this.path.length - 1];
      if (previous.distanceTo(point) > SEGMENT_EPSILON) {
        this.path.push(point.clone());
      }
    }

    for (let i = 1; i < this.path.length; i++) {
      this.totalLength += this.path[i - 1].distanceTo(this.path[i]);
      this.cumulative.push(this.totalLength);
    }

    if (!Number.isFinite(this.totalLength) || this.totalLength <= SEGMENT_EPSILON) {
      this.totalLength = 0;
      if (this.path.length > 1) this.path = [this.path[0]];
      this.cumulative = [0];
      this.travel = 0;
    } else {
      this.travel = this.normalizeTravel(this.travel);
    }
  }

  getPath(): THREE.Vector3[] {
    return this.path;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
  }

  getSpeed(): number {
    return this.speed;
  }

  advance(deltaTime: number): RoamFrame {
    const dt = Math.min(Math.max(deltaTime, 0), MAX_FRAME_DELTA);
    if (this.totalLength > 0) {
      this.travel = this.normalizeTravel(this.travel + this.speed * dt);
    }
    return this.sample();
  }

  sample(): RoamFrame {
    const empty: RoamFrame = {
      hasPath: false,
      moving: false,
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, 1),
      distance: 0,
      totalDistance: 0
    };

    if (this.path.length === 0) return empty;
    const anchor = this.path[0];

    if (this.totalLength === 0) {
      return {
        hasPath: true,
        moving: false,
        position: anchor.clone(),
        direction: new THREE.Vector3(0, 0, 1),
        distance: 0,
        totalDistance: 0
      };
    }

    const period = 2 * this.totalLength;
    let arc = this.travel % period;
    if (arc < 0) arc += period;

    let forward = 1;
    if (arc > this.totalLength) {
      arc = period - arc;
      forward = -1;
    }

    let low = 0;
    let high = this.cumulative.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (this.cumulative[mid] <= arc) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const segmentLength = this.cumulative[low + 1] - this.cumulative[low];
    const t = segmentLength > SEGMENT_EPSILON
      ? (arc - this.cumulative[low]) / segmentLength
      : 0;

    const start = this.path[low];
    const end = this.path[low + 1];
    const position = start.clone().lerp(end, t);

    const direction = end.clone().sub(start);
    if (direction.lengthSq() < SEGMENT_EPSILON * SEGMENT_EPSILON) {
      direction.set(0, 0, 1);
    } else {
      direction.normalize().multiplyScalar(forward);
    }

    return {
      hasPath: true,
      moving: true,
      position,
      direction,
      distance: arc,
      totalDistance: this.totalLength
    };
  }

  private normalizeTravel(value: number): number {
    if (this.totalLength === 0) return 0;
    const period = 2 * this.totalLength;
    const normalized = value % period;
    return normalized < 0 ? normalized + period : normalized;
  }
}
