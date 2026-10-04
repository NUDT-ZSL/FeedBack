import { viewProjectionMatrix, transformPoint, type Vec3 } from './math3';
import type { CameraState } from './camera';
import type { Rect } from './picking';

export interface ScreenPoint {
  x: number;
  y: number;
}

export function worldToScreen(
  camera: CameraState,
  viewport: Rect,
  worldPos: Vec3
): ScreenPoint {
  const vp = viewProjectionMatrix(
    camera.position,
    camera.target,
    camera.up,
    camera.fovYDegrees,
    camera.aspect,
    camera.near,
    camera.far
  );
  const ndc = transformPoint(vp, worldPos);
  return {
    x: (ndc[0] * 0.5 + 0.5) * viewport.width + viewport.left,
    y: (-ndc[1] * 0.5 + 0.5) * viewport.height + viewport.top
  };
}
