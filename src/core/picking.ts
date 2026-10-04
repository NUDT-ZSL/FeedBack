import { v3, raySphereIntersection, type Ray, type Vec3 } from './math3';
import { cameraBasis, type CameraState } from './camera';

export interface Ndc {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ndcFromClientPoint(clientX: number, clientY: number, rect: Rect): Ndc {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1
  };
}

export function rayFromCamera(camera: CameraState, ndc: Ndc): Ray {
  const { forward, right, up } = cameraBasis(camera);
  const tanHalfFov = Math.tan((camera.fovYDegrees * Math.PI / 180) / 2);
  const direction = v3.normalize(v3.add(
    forward,
    v3.add(
      v3.scale(right, ndc.x * tanHalfFov * camera.aspect),
      v3.scale(up, ndc.y * tanHalfFov)
    )
  ));
  return { origin: [...camera.position], direction };
}

export interface PickSphere {
  center: Vec3;
  radius: number;
}

export interface PickResult {
  index: number;
  distance: number;
}

export function pickSphere(ray: Ray, spheres: PickSphere[]): PickResult | null {
  let best: PickResult | null = null;
  spheres.forEach((sphere, index) => {
    const t = raySphereIntersection(ray, sphere.center, sphere.radius);
    if (t !== null && (best === null || t < best.distance)) {
      best = { index, distance: t };
    }
  });
  return best;
}

export function pickAtom(
  camera: CameraState,
  ndc: Ndc,
  atoms: { position: Vec3; radius: number }[]
): number {
  const ray = rayFromCamera(camera, ndc);
  const hit = pickSphere(ray, atoms.map(a => ({ center: a.position, radius: a.radius })));
  return hit === null ? -1 : hit.index;
}
