import { test, assert, assertEqual, assertClose, assertVec3Close } from './harness';
import { createCameraState } from '../src/core/camera';
import { rayFromCamera, pickAtom, ndcFromClientPoint, type Ndc } from '../src/core/picking';
import { worldToScreen } from '../src/core/projection';
import { viewProjectionMatrix, transformPoint, v3 } from '../src/core/math3';
import { buildMoleculeModel } from '../src/core/moleculeGeometry';
import { MOLECULES } from '../src/moleculeData';

function ndcOfWorld(camera: ReturnType<typeof createCameraState>, p: [number, number, number]): Ndc {
  const vp = viewProjectionMatrix(camera.position, camera.target, camera.up, camera.fovYDegrees, camera.aspect, camera.near, camera.far);
  const clip = transformPoint(vp, p);
  return { x: clip[0], y: clip[1] };
}

test('拾取: 屏幕中心射线命中位于原点的氧原子', () => {
  const camera = createCameraState(1);
  const model = buildMoleculeModel(MOLECULES[0]);
  const hit = pickAtom(camera, { x: 0, y: 0 }, model.atoms);
  assertEqual(hit, 0, '应命中原子序号0 (O)');
});

test('拾取: 精确对准各原子的射线返回对应序号', () => {
  const camera = createCameraState(1);
  const model = buildMoleculeModel(MOLECULES[0]);
  model.atoms.forEach((atom, expected) => {
    const ndc = ndcOfWorld(camera, atom.position);
    const hit = pickAtom(camera, ndc, model.atoms);
    assertEqual(hit, expected, `H2O 原子${expected} (${atom.symbol})`);
  });
});

test('拾取: 苯环12个原子在默认相机下逐个可命中', () => {
  const camera = createCameraState(1);
  const model = buildMoleculeModel(MOLECULES[2]);
  model.atoms.forEach((atom, expected) => {
    const ndc = ndcOfWorld(camera, atom.position);
    const hit = pickAtom(camera, ndc, model.atoms);
    assertEqual(hit, expected, `苯环 原子${expected} (${atom.symbol})`);
  });
});

test('拾取: 偏离子球的射线未命中返回-1', () => {
  const camera = createCameraState(1);
  const model = buildMoleculeModel(MOLECULES[0]);
  assertEqual(pickAtom(camera, { x: 0.95, y: 0.95 }, model.atoms), -1, '角落空白处');
  assertEqual(pickAtom(camera, { x: 0, y: 0.9 }, model.atoms), -1, '原子下方空隙');
});

test('拾取: 射线串联两球时命中更近的原子', () => {
  const camera = createCameraState(1);
  const atoms = [
    { position: [0, 0, -2] as [number, number, number], radius: 0.2 },
    { position: [0, 0, 0] as [number, number, number], radius: 0.2 }
  ];
  assertEqual(pickAtom(camera, { x: 0, y: 0 }, atoms), 1, '更近的序号1');
});

test('拾取: 屏幕坐标到NDC的换算与原应用一致', () => {
  const ndc = ndcFromClientPoint(100, 200, { left: 0, top: 0, width: 800, height: 400 });
  assertClose(ndc.x, 100 / 800 * 2 - 1, 1e-12, 'NDC x');
  assertClose(ndc.y, -(200 / 400 * 2 - 1), 1e-12, 'NDC y 需翻转');
});

test('拾取: 射线原点为相机位置, 中心射线朝-z方向', () => {
  const camera = createCameraState(1.6);
  const ray = rayFromCamera(camera, { x: 0, y: 0 });
  assertVec3Close(ray.origin, [0, 0, 8], 1e-12, '射线起点');
  assertVec3Close(ray.direction, [0, 0, -1], 1e-12, '中心方向');
  assertClose(v3.length(ray.direction), 1, 1e-12, '方向已归一化');
});

test('拾取: 由屏幕落点构造的射线经过该原子所在位置', () => {
  const camera = createCameraState(1);
  const model = buildMoleculeModel(MOLECULES[0]);
  const atom = model.atoms[1];
  const viewport = { left: 0, top: 0, width: 1000, height: 1000 };
  const screen = worldToScreen(camera, viewport, atom.position);
  const ndc = ndcFromClientPoint(screen.x, screen.y, viewport);
  const ray = rayFromCamera(camera, ndc);
  const toAtom = v3.normalize(v3.sub(atom.position, ray.origin));
  assertVec3Close(toAtom, ray.direction, 1e-9, '射线方向指向原子');
});
