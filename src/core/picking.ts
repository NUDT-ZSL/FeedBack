import * as THREE from 'three';
import type { ScreenPoint } from './projection';

export interface PickableAtom {
  position: [number, number, number];
  radius: number;
}

const raycaster = new THREE.Raycaster();
const ndcVector = new THREE.Vector2();
const sphere = new THREE.Sphere();
const hitPoint = new THREE.Vector3();

export function pickAtom(
  ndc: ScreenPoint,
  camera: THREE.Camera,
  atoms: PickableAtom[]
): number {
  ndcVector.set(ndc.x, ndc.y);
  raycaster.setFromCamera(ndcVector, camera);

  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < atoms.length; i++) {
    sphere.center.set(atoms[i].position[0], atoms[i].position[1], atoms[i].position[2]);
    sphere.radius = atoms[i].radius;
    const hit = raycaster.ray.intersectSphere(sphere, hitPoint);
    if (hit) {
      const distance = hitPoint.distanceTo(raycaster.ray.origin);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
}
