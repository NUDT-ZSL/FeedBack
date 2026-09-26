import * as THREE from 'three';
import {
  RoomConfig,
  SoundSourceConfig,
  RayData,
  RayBounce,
  MATERIAL_PROPS,
  WallType,
  MaterialType,
  SimulationStats,
} from '@/types';

const MAX_BOUNCES = 3;
const MIN_ENERGY = 0.05;
const SCATTER_ANGLE = 10;
const INITIAL_RAY_COUNT = 16;

interface WallPlane {
  type: WallType;
  plane: THREE.Plane;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

function buildWallPlanes(room: RoomConfig): WallPlane[] {
  const hw = room.width / 2;
  const hh = room.height / 2;
  const hd = room.depth / 2;

  const walls: WallPlane[] = [
    {
      type: 'back',
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -hd),
      min: new THREE.Vector3(-hw, -hh, -hd),
      max: new THREE.Vector3(hw, hh, -hd),
    },
    {
      type: 'left',
      plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), -hw),
      min: new THREE.Vector3(-hw, -hh, -hd),
      max: new THREE.Vector3(-hw, hh, hd),
    },
    {
      type: 'right',
      plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), -hw),
      min: new THREE.Vector3(hw, -hh, -hd),
      max: new THREE.Vector3(hw, hh, hd),
    },
    {
      type: 'floor',
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hh),
      min: new THREE.Vector3(-hw, -hh, -hd),
      max: new THREE.Vector3(hw, -hh, hd),
    },
    {
      type: 'ceiling',
      plane: new THREE.Plane(new THREE.Vector3(0, -1, 0), -hh),
      min: new THREE.Vector3(-hw, hh, -hd),
      max: new THREE.Vector3(hw, hh, hd),
    },
  ];

  return walls;
}

function generateInitialRays(source: SoundSourceConfig): THREE.Vector3[] {
  const directions: THREE.Vector3[] = [];
  const horizontalCount = Math.ceil(Math.sqrt(INITIAL_RAY_COUNT * 2));
  const verticalCount = Math.ceil(INITIAL_RAY_COUNT / horizontalCount) + 2;

  const hStart = -Math.PI / 2;
  const hEnd = Math.PI / 2;
  const vStart = -Math.PI / 4;
  const vEnd = Math.PI / 4;

  for (let i = 0; i < horizontalCount; i++) {
    const hAngle = hStart + (hEnd - hStart) * (i / (horizontalCount - 1));
    for (let j = 0; j < verticalCount; j++) {
      const vAngle = vStart + (vEnd - vStart) * (j / (verticalCount - 1));
      const dir = new THREE.Vector3(
        Math.sin(hAngle) * Math.cos(vAngle),
        Math.sin(vAngle),
        -Math.cos(hAngle) * Math.cos(vAngle),
      ).normalize();
      directions.push(dir);
    }
  }

  return directions.slice(0, Math.max(INITIAL_RAY_COUNT, directions.length));
}

function intersectWall(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  wall: WallPlane,
): THREE.Vector3 | null {
  const hit = new THREE.Vector3();
  const ray = new THREE.Ray(origin, direction);
  const result = ray.intersectPlane(wall.plane, hit);
  if (!result) return null;

  if (
    hit.x >= wall.min.x - 1e-6 && hit.x <= wall.max.x + 1e-6 &&
    hit.y >= wall.min.y - 1e-6 && hit.y <= wall.max.y + 1e-6 &&
    hit.z >= wall.min.z - 1e-6 && hit.z <= wall.max.z + 1e-6
  ) {
    return hit;
  }
  return null;
}

function findClosestHit(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  walls: WallPlane[],
): { point: THREE.Vector3; wall: WallPlane; distance: number } | null {
  let closest: { point: THREE.Vector3; wall: WallPlane; distance: number } | null = null;

  for (const wall of walls) {
    const hit = intersectWall(origin, direction, wall);
    if (hit) {
      const dist = origin.distanceTo(hit);
      if (dist > 0.001 && (!closest || dist < closest.distance)) {
        closest = { point: hit, wall, distance: dist };
      }
    }
  }

  return closest;
}

function reflectDirection(
  direction: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.Vector3 {
  const reflected = direction.clone().reflect(normal).normalize();
  const scatterRad = (SCATTER_ANGLE * Math.PI) / 180;

  const tangent = new THREE.Vector3();
  if (Math.abs(normal.x) < 0.9) {
    tangent.set(1, 0, 0);
  } else {
    tangent.set(0, 1, 0);
  }
  tangent.cross(normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

  const angle1 = (Math.random() - 0.5) * 2 * scatterRad;
  const angle2 = (Math.random() - 0.5) * 2 * scatterRad;

  const quat1 = new THREE.Quaternion().setFromAxisAngle(tangent, angle1);
  const quat2 = new THREE.Quaternion().setFromAxisAngle(bitangent, angle2);

  reflected.applyQuaternion(quat1).applyQuaternion(quat2).normalize();
  return reflected;
}

function calculateIncidentAngle(
  direction: THREE.Vector3,
  normal: THREE.Vector3,
): number {
  const dot = Math.abs(direction.dot(normal));
  const angle = Math.acos(Math.min(1, Math.max(0, dot)));
  return (angle * 180) / Math.PI;
}

function refractThroughMaterial(
  hitPoint: THREE.Vector3,
  direction: THREE.Vector3,
  normal: THREE.Vector3,
  thickness: number,
): THREE.Vector3 {
  return hitPoint.clone().add(direction.clone().multiplyScalar(thickness));
}

export function traceRays(
  room: RoomConfig,
  source: SoundSourceConfig,
): { rays: RayData[]; stats: SimulationStats } {
  const walls = buildWallPlanes(room);
  const initialDirs = generateInitialRays(source);
  const rays: RayData[] = [];

  const wallHitCounts: Record<WallType, number> = {
    front: 0, back: 0, left: 0, right: 0, floor: 0, ceiling: 0,
  };
  const materialHitCounts: Record<MaterialType, number> = {
    glass: 0, metal: 0, wood: 0, fabric: 0,
  };

  let totalBounces = 0;

  for (let i = 0; i < initialDirs.length; i++) {
    const startPoint = new THREE.Vector3(...source.position);
    let currentPos = startPoint.clone();
    let currentDir = initialDirs[i].clone();
    let energy = 1.0;

    const path: [number, number, number][] = [
      [startPoint.x, startPoint.y, startPoint.z],
    ];
    const energies: number[] = [1.0];
    const bounces: RayBounce[] = [];

    for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
      const hit = findClosestHit(currentPos, currentDir, walls);
      if (!hit) break;

      const materialType = room.walls[hit.wall.type];
      const material = MATERIAL_PROPS[materialType];
      const normal = hit.wall.plane.normal.clone();

      const incidentAngle = calculateIncidentAngle(currentDir, normal);
      const reflectAngle = incidentAngle;

      energy *= material.reflectionRate;
      if (energy < MIN_ENERGY) {
        path.push([hit.point.x, hit.point.y, hit.point.z]);
        energies.push(energy);
        break;
      }

      bounces.push({
        position: [hit.point.x, hit.point.y, hit.point.z],
        wall: hit.wall.type,
        material: materialType,
        incidentAngle,
        reflectAngle,
        energyRemaining: energy,
        segmentIndex: bounce,
      });

      wallHitCounts[hit.wall.type]++;
      materialHitCounts[materialType]++;
      totalBounces++;

      path.push([hit.point.x, hit.point.y, hit.point.z]);
      energies.push(energy);

      currentDir = reflectDirection(currentDir, normal);
      currentPos = hit.point.clone().add(currentDir.clone().multiplyScalar(0.001));
    }

    if (path.length < 2) {
      const farPoint = currentPos.clone().add(currentDir.clone().multiplyScalar(50));
      path.push([farPoint.x, farPoint.y, farPoint.z]);
      energies.push(0.1);
    }

    rays.push({
      id: i,
      startPoint: [startPoint.x, startPoint.y, startPoint.z],
      direction: [currentDir.x, currentDir.y, currentDir.z],
      bounces,
      totalBounces: bounces.length,
      path,
      energies,
    });
  }

  const stats: SimulationStats = {
    totalRays: rays.length,
    averageBounces: rays.length > 0 ? totalBounces / rays.length : 0,
    wallHitCounts,
    materialHitCounts,
  };

  return { rays, stats };
}
