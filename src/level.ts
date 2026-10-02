import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export type SurfaceType = 'metal' | 'sand' | 'ice';

export interface PlatformData {
  position: [number, number, number];
  size: [number, number, number];
  surface: SurfaceType;
  rotation?: [number, number, number];
}

export interface HammerData {
  position: [number, number, number];
  armLength: number;
  rotationSpeed: number;
}

export interface FireColumnData {
  position: [number, number, number];
  interval: number;
}

export interface ElevatorData {
  position: [number, number, number];
  size: [number, number, number];
  minHeight: number;
  maxHeight: number;
  speed: number;
}

export interface StarData {
  position: [number, number, number];
}

export interface LevelData {
  start: [number, number, number];
  goal: [number, number, number];
  platforms: PlatformData[];
  hammers: HammerData[];
  fireColumns: FireColumnData[];
  elevators: ElevatorData[];
  stars: StarData[];
  hiddenPath: {
    gatePosition: [number, number, number];
    pathStart: [number, number, number];
    pathEnd: [number, number, number];
  };
}

export const levelData: LevelData = {
  start: [0, 2, 0],
  goal: [0, 1.5, -40],
  platforms: [
    { position: [0, 0, 0], size: [6, 0.5, 6], surface: 'metal' },
    { position: [0, 0, -7], size: [4, 0.5, 6], surface: 'sand' },
    { position: [0, 0, -14], size: [5, 0.5, 5], surface: 'ice' },
    { position: [-4, -0.5, -20], size: [3, 0.5, 4], surface: 'metal' },
    { position: [4, -0.5, -20], size: [3, 0.5, 4], surface: 'metal' },
    { position: [0, 0, -26], size: [4, 0.5, 4], surface: 'sand' },
    { position: [0, 0.5, -33], size: [5, 0.5, 5], surface: 'ice' },
    { position: [0, 1, -40], size: [6, 0.5, 6], surface: 'metal' },
    { position: [8, 2, -30], size: [3, 0.5, 12], surface: 'metal', rotation: [0, 0, 0] },
    { position: [8, 2, -40], size: [4, 0.5, 4], surface: 'metal' }
  ],
  hammers: [
    { position: [0, 2.5, -10.5], armLength: 2.5, rotationSpeed: 1.5 },
    { position: [0, 2.5, -29], armLength: 2.5, rotationSpeed: -2 }
  ],
  fireColumns: [
    { position: [-2, 0.5, -7], interval: 2 },
    { position: [2, 0.5, -7], interval: 2.5 },
    { position: [0, 1, -33], interval: 1.8 }
  ],
  elevators: [
    { position: [0, 0, -20], size: [2.5, 0.4, 2.5], minHeight: -1, maxHeight: 1.5, speed: 0.8 }
  ],
  stars: [
    { position: [0, 2, -7] },
    { position: [-4, 1.5, -20] },
    { position: [0, 2.5, -33] }
  ],
  hiddenPath: {
    gatePosition: [5, 2, -40],
    pathStart: [8, 2.5, -30],
    pathEnd: [8, 2.5, -40]
  }
};

export function getSurfaceMaterial(surface: SurfaceType): { threeMat: THREE.Material; cannonMat: CANNON.Material; friction: number; restitution: number } {
  let color: number;
  let metalness: number;
  let roughness: number;
  let friction: number;
  let restitution: number;

  switch (surface) {
    case 'metal':
      color = 0x5a5a6a;
      metalness = 0.8;
      roughness = 0.3;
      friction = 0.4;
      restitution = 0.3;
      break;
    case 'sand':
      color = 0xc9a96a;
      metalness = 0.0;
      roughness = 0.9;
      friction = 0.8;
      restitution = 0.1;
      break;
    case 'ice':
      color = 0x9ec6e0;
      metalness = 0.1;
      roughness = 0.05;
      friction = 0.05;
      restitution = 0.2;
      break;
  }

  const threeMat = new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness
  });

  const cannonMat = new CANNON.Material(surface);

  return { threeMat, cannonMat, friction, restitution };
}
