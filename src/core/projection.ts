import * as THREE from 'three';

export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export const LABEL_OFFSET_Y = 70;

export function screenToNdc(clientX: number, clientY: number, viewport: Viewport): ScreenPoint {
  return {
    x: ((clientX - viewport.left) / viewport.width) * 2 - 1,
    y: -((clientY - viewport.top) / viewport.height) * 2 + 1
  };
}

export function worldToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  viewport: Viewport
): ScreenPoint {
  const projected = worldPos.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * viewport.width + viewport.left,
    y: (-projected.y * 0.5 + 0.5) * viewport.height + viewport.top
  };
}

export function labelAnchor(screen: ScreenPoint): ScreenPoint {
  return { x: screen.x, y: screen.y - LABEL_OFFSET_Y };
}
