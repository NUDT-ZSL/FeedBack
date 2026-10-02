import type { Transform, DougongComponent } from '../types';
import { SCENE_CONSTANTS } from './constants';

export const calculateDistance = (p1: Transform, p2: Transform): number => {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = p1.z - p2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const easeOutCubic = (t: number): number => {
  return 1 - Math.pow(1 - t, 3);
};

export const easeInCubic = (t: number): number => {
  return t * t * t;
};

export const easeInOutCubic = (t: number): number => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export const easeOutQuart = (t: number): number => {
  return 1 - Math.pow(1 - t, 4);
};

export const lerp = (start: number, end: number, t: number): number => {
  return start + (end - start) * t;
};

export const lerpTransform = (
  start: Transform,
  end: Transform,
  t: number
): Transform => ({
  x: lerp(start.x, end.x, t),
  y: lerp(start.y, end.y, t),
  z: lerp(start.z, end.z, t),
});

export const randomRange = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

export const randomDirection = (): Transform => {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI;
  return {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi) * 0.5 + 0.5,
    z: Math.sin(phi) * Math.sin(theta),
  };
};

export const generateDisassemblePosition = (
  originalPos: Transform,
  order: number,
  total: number
): Transform => {
  const { min, max } = SCENE_CONSTANTS.disassembleDistance;
  const direction = randomDirection();
  const distance = randomRange(min, max);
  const offsetFactor = 1 + (order / total) * 0.5;
  
  return {
    x: originalPos.x + direction.x * distance * offsetFactor,
    y: originalPos.y + direction.y * distance * offsetFactor,
    z: originalPos.z + direction.z * distance * offsetFactor,
  };
};

export const generateFlyInPosition = (
  originalPos: Transform
): Transform => {
  const direction = randomDirection();
  const distance = randomRange(80, 120);
  
  return {
    x: originalPos.x + direction.x * distance,
    y: originalPos.y + Math.abs(direction.y) * distance + 20,
    z: originalPos.z + direction.z * distance,
  };
};

export const generateRandomRotation = (): { x: number; y: number; z: number } => {
  const degToRad = (deg: number) => (deg * Math.PI) / 180;
  return {
    x: degToRad(randomRange(-15, 15)),
    y: degToRad(randomRange(-15, 15)),
    z: degToRad(randomRange(-15, 15)),
  };
};

export const isNearTarget = (component: DougongComponent): boolean => {
  const distance = calculateDistance(
    component.position,
    component.correctPosition
  );
  return distance < SCENE_CONSTANTS.snapThreshold;
};

export const isInErrorZone = (component: DougongComponent): boolean => {
  const distance = calculateDistance(
    component.position,
    component.correctPosition
  );
  return distance > SCENE_CONSTANTS.errorThreshold;
};

export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0, g: 0, b: 0 };
};

export const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (n: number) => {
    const hex = Math.round(Math.max(0, Math.min(255, n * 255))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const lerpColor = (color1: string, color2: string, t: number): string => {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  return rgbToHex(lerp(c1.r, c2.r, t), lerp(c1.g, c2.g, t), lerp(c1.b, c2.b, t));
};

export const createId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};
