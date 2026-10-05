import * as THREE from 'three';

export function makeCamera(
  position: [number, number, number] = [0, 0, 8],
  target: [number, number, number] = [0, 0, 0],
  viewport: { width: number; height: number } = { width: 1920, height: 1080 }
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    50,
    viewport.width / viewport.height,
    0.1,
    1000
  );
  camera.position.set(...position);
  camera.lookAt(target[0], target[1], target[2]);
  camera.updateMatrixWorld();
  return camera;
}

export const VIEWPORT = { left: 0, top: 0, width: 1920, height: 1080 };
