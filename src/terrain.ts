import * as THREE from 'three';

export interface TerrainData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  size: number;
  segments: number;
  heightMap: number[][];
}

export interface TerrainConfig {
  size: number;
  segments: number;
  maxHeight: number;
  minHeight: number;
  seed?: number;
}

const DEFAULT_CONFIG: TerrainConfig = {
  size: 400,
  segments: 128,
  maxHeight: 500,
  minHeight: 100,
  seed: 42
};

class PerlinNoise {
  private permutation: number[];

  constructor(seed: number = 42) {
    this.permutation = this.generatePermutation(seed);
  }

  private generatePermutation(seed: number): number[] {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    let s = seed;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    return [...p, ...p];
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const aa = this.permutation[this.permutation[X] + Y];
    const ab = this.permutation[this.permutation[X] + Y + 1];
    const ba = this.permutation[this.permutation[X + 1] + Y];
    const bb = this.permutation[this.permutation[X + 1] + Y + 1];
    return this.lerp(
      this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
      this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
      v
    );
  }

  octaveNoise(x: number, y: number, octaves: number, persistence: number): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / maxValue;
  }
}

function getTerrainColor(height: number, minHeight: number, maxHeight: number): THREE.Color {
  const normalized = (height - minHeight) / (maxHeight - minHeight);
  const green = new THREE.Color('#4caf50');
  const brown = new THREE.Color('#8d6e63');
  const white = new THREE.Color('#ffffff');

  if (normalized < 0.5) {
    const t = normalized / 0.5;
    return green.clone().lerp(brown, t);
  } else {
    const t = (normalized - 0.5) / 0.5;
    return brown.clone().lerp(white, t);
  }
}

export function generateTerrain(config: Partial<TerrainConfig> = {}): TerrainData {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { size, segments, maxHeight, minHeight, seed } = cfg;

  const noise = new PerlinNoise(seed);
  const heightMap: number[][] = [];
  const vertexCount = (segments + 1) * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const halfSize = size / 2;
  const peakX = segments / 2;
  const peakY = segments / 2;
  const peakRadius = segments * 0.45;

  for (let y = 0; y <= segments; y++) {
    heightMap[y] = [];
    for (let x = 0; x <= segments; x++) {
      const i = (y * (segments + 1) + x) * 3;

      const px = (x / segments) * size - halfSize;
      const pz = (y / segments) * size - halfSize;

      const dx = x - peakX;
      const dy = y - peakY;
      const distFromPeak = Math.sqrt(dx * dx + dy * dy);
      const peakFactor = Math.max(0, 1 - distFromPeak / peakRadius);
      const peakHeight = Math.pow(peakFactor, 1.5) * (maxHeight - minHeight);

      const noiseX = x / segments * 4;
      const noiseY = y / segments * 4;
      const noiseValue = noise.octaveNoise(noiseX, noiseY, 5, 0.5);
      const terrainNoise = (noiseValue + 1) * 0.5 * (maxHeight - minHeight) * 0.4;

      const py = minHeight + peakHeight * 0.7 + terrainNoise * peakFactor;

      positions[i] = px;
      positions[i + 1] = py;
      positions[i + 2] = pz;

      heightMap[y][x] = py;

      const color = getTerrainColor(py, minHeight, maxHeight);
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
  }

  const indexCount = segments * segments * 6;
  const indices = new Uint32Array(indexCount);
  let index = 0;
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x;
      const b = a + 1;
      const c = a + (segments + 1);
      const d = c + 1;
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = c;
      indices[index++] = d;
    }
  }

  return {
    positions,
    colors,
    indices,
    size,
    segments,
    heightMap
  };
}

export function getHeightAt(
  worldX: number,
  worldZ: number,
  terrainData: TerrainData
): number {
  const { size, segments, heightMap } = terrainData;
  const halfSize = size / 2;

  const gridX = ((worldX + halfSize) / size) * segments;
  const gridZ = ((worldZ + halfSize) / size) * segments;

  if (gridX < 0 || gridX >= segments || gridZ < 0 || gridZ >= segments) {
    return 0;
  }

  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(x0 + 1, segments);
  const z1 = Math.min(z0 + 1, segments);

  const fx = gridX - x0;
  const fz = gridZ - z0;

  const h00 = heightMap[z0][x0];
  const h10 = heightMap[z0][x1];
  const h01 = heightMap[z1][x0];
  const h11 = heightMap[z1][x1];

  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;

  return h0 * (1 - fz) + h1 * fz;
}

export function projectPointsToTerrain(
  points: THREE.Vector3[],
  terrainData: TerrainData
): THREE.Vector3[] {
  return points.map(p => {
    const y = getHeightAt(p.x, p.z, terrainData);
    return new THREE.Vector3(p.x, y, p.z);
  });
}

export function generateSmoothPath(
  controlPoints: THREE.Vector3[],
  terrainData: TerrainData,
  segmentsPerCurve: number = 20
): THREE.Vector3[] {
  if (controlPoints.length < 2) return controlPoints.map(p => p.clone());

  const points: THREE.Vector3[] = [];

  for (let i = 0; i < controlPoints.length - 1; i++) {
    const p0 = controlPoints[Math.max(0, i - 1)];
    const p1 = controlPoints[i];
    const p2 = controlPoints[i + 1];
    const p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)];

    for (let j = 0; j < segmentsPerCurve; j++) {
      const t = j / segmentsPerCurve;
      const t2 = t * t;
      const t3 = t2 * t;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );

      const z = 0.5 * (
        (2 * p1.z) +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
      );

      const y = getHeightAt(x, z, terrainData);
      points.push(new THREE.Vector3(x, y, z));
    }
  }

  const lastPoint = controlPoints[controlPoints.length - 1];
  points.push(new THREE.Vector3(lastPoint.x, getHeightAt(lastPoint.x, lastPoint.z, terrainData), lastPoint.z));

  return points;
}

export function calculatePathMetrics(
  pathPoints: THREE.Vector3[]
): { distances: number[]; slopes: number[]; totalDistance: number; avgSlope: number; maxSlope: number; maxSlopeIndex: number } {
  const distances: number[] = [0];
  const slopes: number[] = [0];
  let totalDistance = 0;
  let maxSlope = 0;
  let maxSlopeIndex = 0;

  for (let i = 1; i < pathPoints.length; i++) {
    const prev = pathPoints[i - 1];
    const curr = pathPoints[i];

    const horizontalDist = Math.sqrt(
      Math.pow(curr.x - prev.x, 2) + Math.pow(curr.z - prev.z, 2)
    );
    const verticalDist = curr.y - prev.y;

    totalDistance += horizontalDist;
    distances.push(totalDistance);

    const slope = horizontalDist > 0 ? Math.abs(verticalDist / horizontalDist) * 100 : 0;
    slopes.push(slope);

    if (slope > maxSlope) {
      maxSlope = slope;
      maxSlopeIndex = i;
    }
  }

  const avgSlope = slopes.length > 0 ? slopes.reduce((a, b) => a + b, 0) / slopes.length : 0;

  return { distances, slopes, totalDistance, avgSlope, maxSlope, maxSlopeIndex };
}
