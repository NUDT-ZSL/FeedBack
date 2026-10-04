import { v3, type Vec3 } from './math3';

export interface CameraState {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fovYDegrees: number;
  aspect: number;
  near: number;
  far: number;
}

export const DEFAULT_CAMERA_STATE: CameraState = {
  position: [0, 0, 8],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovYDegrees: 50,
  aspect: 1,
  near: 0.1,
  far: 1000
};

export function createCameraState(aspect: number): CameraState {
  return { ...DEFAULT_CAMERA_STATE, aspect };
}

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function cameraBasis(camera: CameraState): CameraBasis {
  const forward = v3.normalize(v3.sub(camera.target, camera.position));
  const right = v3.normalize(v3.cross(forward, camera.up));
  const up = v3.cross(right, forward);
  return { forward, right, up };
}
