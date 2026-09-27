import * as THREE from 'three';

/** Advance a manager update loop with a fixed timestep. */
export function step(frames: number, delta: number, fn: (delta: number, time: number) => void): number {
  let time = 0;
  for (let i = 0; i < frames; i++) {
    time += delta;
    fn(delta, time);
  }
  return time;
}

export function expectFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number for ${label}, got ${value}`);
  }
}

export function expectVectorFinite(v: THREE.Vector3, label: string): void {
  expectFinite(v.x, `${label}.x`);
  expectFinite(v.y, `${label}.y`);
  expectFinite(v.z, `${label}.z`);
}

export function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  return camera;
}

/** Dispatch a synthetic mousemove so EnvironmentManager picks up NDC coords. */
export function dispatchMouseMove(clientX: number, clientY: number): void {
  window.dispatchEvent(new window.MouseEvent('mousemove', { clientX, clientY }));
}
