import type { Position3D } from "./fengshui";

export type EasingFunction = (t: number) => number;

export const easeOutQuad: EasingFunction = (t: number): number => t * (2 - t);

export const easeOutElastic: EasingFunction = (t: number): number => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
    ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const easeOutCubic: EasingFunction = (t: number): number =>
  1 - Math.pow(1 - t, 3);

export function blendColors(
  hex1: string,
  hex2: string,
  ratio: number
): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function perlinNoise2(x: number, y: number, seed: number = 0): number {
  const p = new Uint8Array(512);
  const permutation = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    permutation[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const random = Math.sin(seed + i) * 10000;
    const j = Math.floor((random - Math.floor(random)) * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  for (let i = 0; i < 512; i++) {
    p[i] = permutation[i & 255];
  }
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x);
  const v = fade(y);
  const A = p[X] + Y;
  const AA = p[A];
  const AB = p[A + 1];
  const B = p[X + 1] + Y;
  const BA = p[B];
  const BB = p[B + 1];
  return lerp(
    lerp(grad(p[AA], x, y), grad(p[BA], x - 1, y), u),
    lerp(grad(p[AB], x, y - 1), grad(p[BB], x - 1, y - 1), u),
    v
  );
}

export type { Direction, Mountain, MountainResult } from "./fengshui";
export { angleTo24Mountain, generateFengshuiCommentary } from "./fengshui";

interface Camera {
  position: Position3D;
  rotation: {
    yaw: number;
    pitch: number;
  };
  fov: number;
}

export function worldToScreen(
  position: Position3D,
  camera: Camera,
  width: number,
  height: number
): { x: number; y: number; depth: number } {
  const { position: camPos, rotation } = camera;
  const dx = position.x - camPos.x;
  const dy = position.y - camPos.y;
  const dz = position.z - camPos.z;
  const cosYaw = Math.cos(-rotation.yaw);
  const sinYaw = Math.sin(-rotation.yaw);
  const cosPitch = Math.cos(-rotation.pitch);
  const sinPitch = Math.sin(-rotation.pitch);
  const x1 = dx * cosYaw - dz * sinYaw;
  const z1 = dx * sinYaw + dz * cosYaw;
  const y2 = dy * cosPitch - z1 * sinPitch;
  const z2 = dy * sinPitch + z1 * cosPitch;
  const f = 1 / Math.tan(camera.fov / 2);
  const aspect = width / height;
  const screenX = (f * x1) / (aspect * z2 + 0.0001);
  const screenY = (f * y2) / (z2 + 0.0001);
  return {
    x: (screenX + 1) * width * 0.5,
    y: (1 - screenY) * height * 0.5,
    depth: z2,
  };
}
