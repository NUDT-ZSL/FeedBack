import * as THREE from 'three';
import { test, assert, assertClose } from './harness';
import { createCameraState, type CameraState } from '../src/core/camera';
import { worldToScreen } from '../src/core/projection';
import { rayFromCamera, pickAtom, ndcFromClientPoint } from '../src/core/picking';
import { buildMoleculeModel } from '../src/core/moleculeGeometry';
import { MOLECULES } from '../src/moleculeData';
import type { Vec3 } from '../src/core/math3';

function toThreeCamera(core: CameraState): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(core.fovYDegrees, core.aspect, core.near, core.far);
  cam.position.set(...core.position);
  cam.up.set(...core.up);
  cam.lookAt(core.target[0], core.target[1], core.target[2]);
  cam.updateMatrixWorld();
  return cam;
}

test('投影一致性: 核心世界坐标->屏幕 与 THREE.Vector3.project 一致', () => {
  const cases: Array<{ pos: Vec3; target: Vec3; eye: Vec3; aspect: number }> = [
    { pos: [0, 0, 0], target: [0, 0, 0], eye: [0, 0, 8], aspect: 1 },
    { pos: [0.757, 0.586, 0], target: [0, 0, 0], eye: [0, 0, 8], aspect: 1.78 },
    { pos: [1.16, 0, 0], target: [0, 0, 0], eye: [0, 4, 4], aspect: 0.75 },
    { pos: [1.39, 0, 0.3], target: [0.2, -0.1, 0], eye: [2.5, 2.5, 6], aspect: 2.33 }
  ];
  for (const c of cases) {
    const camera = createCameraState(c.aspect);
    camera.position = [...c.eye];
    camera.target = [...c.target];
    const viewport = { left: 0, top: 0, width: 1920, height: 1080 };
    const coreScreen = worldToScreen(camera, viewport, c.pos);

    const threeCam = toThreeCamera(camera);
    const v = new THREE.Vector3(...c.pos).project(threeCam);
    const threeScreen = { x: (v.x * 0.5 + 0.5) * 1920, y: (-v.y * 0.5 + 0.5) * 1080 };

    assertClose(coreScreen.x, threeScreen.x, 1e-7, `屏幕x ${JSON.stringify(c.pos)}`);
    assertClose(coreScreen.y, threeScreen.y, 1e-7, `屏幕y ${JSON.stringify(c.pos)}`);
  }
});

test('射线一致性: 核心射线 与 THREE.Raycaster 射线一致', () => {
  const camera = createCameraState(1.78);
  camera.position = [0.2, 0.3, 7.5];
  camera.target = [0, 0, 0.1];
  const threeCam = toThreeCamera(camera);
  for (const ndc of [{ x: 0, y: 0 }, { x: 0.4, y: -0.2 }, { x: -0.7, y: 0.6 }]) {
    const coreRay = rayFromCamera(camera, ndc);
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), threeCam);
    assertClose(coreRay.origin[0], r.ray.origin.x, 1e-9, '射线原点x');
    assertClose(coreRay.origin[1], r.ray.origin.y, 1e-9, '射线原点y');
    assertClose(coreRay.origin[2], r.ray.origin.z, 1e-9, '射线原点z');
    assertClose(coreRay.direction[0], r.ray.direction.x, 1e-9, '射线方向x');
    assertClose(coreRay.direction[1], r.ray.direction.y, 1e-9, '射线方向y');
    assertClose(coreRay.direction[2], r.ray.direction.z, 1e-9, '射线方向z');
  }
});

test('拾取一致性: 核心命中判定 与 THREE.Ray.intersectSphere 一致', () => {
  const camera = createCameraState(1.78);
  camera.position = [0.3, -0.2, 8];
  const model = buildMoleculeModel(MOLECULES[2]);
  const threeCam = toThreeCamera(camera);
  const r = new THREE.Raycaster();
  const grid = [-0.8, -0.4, 0, 0.4, 0.8];
  let checked = 0;
  for (const x of grid) {
    for (const y of grid) {
      const coreHit = pickAtom(camera, { x, y }, model.atoms);
      r.setFromCamera(new THREE.Vector2(x, y), threeCam);
      let threeHit = -1;
      let bestT = Infinity;
      model.atoms.forEach((atom, i) => {
        const hitPoint = new THREE.Vector3();
        const sphere = new THREE.Sphere(new THREE.Vector3(...atom.position), atom.radius);
        if (r.ray.intersectSphere(sphere, hitPoint)) {
          const t = hitPoint.distanceTo(r.ray.origin);
          if (t < bestT) {
            bestT = t;
            threeHit = i;
          }
        }
      });
      assert(coreHit === threeHit, `NDC(${x},${y}) 核心=${coreHit} three=${threeHit}`);
      checked++;
    }
  }
  assert(checked === 25, '应完成25个采样点比对');
});

test('标注落点: 默认视口原点时屏幕坐标在视口内且与three投影相同', () => {
  const camera = createCameraState(1);
  const model = buildMoleculeModel(MOLECULES[0]);
  const viewport = { left: 0, top: 0, width: 800, height: 800 };
  const screen = worldToScreen(camera, viewport, model.atoms[0].position);
  assert(screen.x >= 0 && screen.x <= 800, 'x 在视口内');
  assert(screen.y >= 0 && screen.y <= 800, 'y 在视口内');
  assertClose(screen.x, 400, 1e-9, '原点原子位于水平中线');
  assertClose(screen.y, 400, 1e-9, '原点原子位于垂直中线');
});

test('标注落点: 考虑画布偏移rect(left/top)', () => {
  const camera = createCameraState(1);
  const shifted = worldToScreen(
    camera,
    { left: 120, top: 60, width: 800, height: 800 },
    [0, 0, 0]
  );
  assertClose(shifted.x, 520, 1e-9, 'x含left偏移');
  assertClose(shifted.y, 460, 1e-9, 'y含top偏移');
});

test('resize: 宽高比变化后屏幕落点与three使用相同aspect时一致', () => {
  const camera = createCameraState(16 / 9);
  const model = buildMoleculeModel(MOLECULES[1]);
  const viewport = { left: 0, top: 0, width: 1600, height: 900 };
  const atom = model.atoms[1].position;
  const coreScreen = worldToScreen(camera, viewport, atom);
  const threeCam = toThreeCamera(camera);
  const v = new THREE.Vector3(...atom).project(threeCam);
  assertClose(coreScreen.x, (v.x * 0.5 + 0.5) * 1600, 1e-7, '宽屏下x');
  assertClose(coreScreen.y, (-v.y * 0.5 + 0.5) * 900, 1e-7, '宽屏下y');

  const ndc = ndcFromClientPoint(coreScreen.x, coreScreen.y, viewport);
  assert(pickAtom(camera, ndc, model.atoms) === 1, 'resize后仍可命中同一原子');
});
