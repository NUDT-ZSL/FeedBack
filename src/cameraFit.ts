import * as THREE from 'three';

/** 根据窗口宽度计算轨道控制的最大距离（响应式断点与原实现一致）。 */
export function cameraMaxDistance(width: number): number {
  if (width < 768) return 30;
  if (width < 1200) return 35;
  return 40;
}

/**
 * 小屏时若相机过远则拉近。返回需要设置的位置长度，无需调整时返回 null。
 */
export function clampCameraPositionLength(currentLength: number, width: number): number | null {
  if (width < 768 && currentLength > 25) {
    return 22;
  }
  return null;
}

export function applyCameraFit(camera: THREE.PerspectiveCamera, controls: { maxDistance: number }, width: number): void {
  controls.maxDistance = cameraMaxDistance(width);
  const clampedLength = clampCameraPositionLength(camera.position.length(), width);
  if (clampedLength !== null) {
    camera.position.setLength(clampedLength);
  }
}
