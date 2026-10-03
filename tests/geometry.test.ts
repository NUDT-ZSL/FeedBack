// 链路 4：轨道线几何重建。
// 验证 updateGeometry 重建出的 128 段折线严格符合椭圆极坐标方程、
// 倾角四元数旋转正确、包围球合理，并覆盖有效极端输入。
import * as THREE from 'three';
import { suite, test, assert } from './harness';
import { makeOrbit, getParams, settle, setEccentricity } from './helpers';

const TOL = 1e-4;

function orbitVertices(orbit: ReturnType<typeof makeOrbit>['orbit']): THREE.Vector3[] {
  const attr = orbit.line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < attr.count; i++) {
    points.push(new THREE.Vector3().fromBufferAttribute(attr, i));
  }
  return points;
}

function expectedPoint(a: number, e: number, i: number, angle: number): THREE.Vector3 {
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(angle));
  const point = new THREE.Vector3(r * Math.cos(angle), 0, r * Math.sin(angle));
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), i);
  return point.applyQuaternion(rotation);
}

function checkConic(a: number, e: number, inclination: number): void {
  const { orbit } = makeOrbit(a, inclination, 3, -1000, 1000);
  settle(orbit);
  setEccentricity(orbit, e);
  orbit.updateGeometry();

  const points = orbitVertices(orbit);
  assert.equal(points.length, 128, '轨道线段数应为 128');
  points.forEach((point, idx) => {
    const angle = (idx / points.length) * Math.PI * 2;
    const expected = expectedPoint(a, e, inclination, angle);
    assert.finite(point.x + point.y + point.z, `第 ${idx} 段顶点非有限`);
    assert.close(point.x, expected.x, TOL, `第 ${idx} 段 x 不符 (a=${a}, e=${e})`);
    assert.close(point.y, expected.y, TOL, `第 ${idx} 段 y 不符 (a=${a}, e=${e})`);
    assert.close(point.z, expected.z, TOL, `第 ${idx} 段 z 不符 (a=${a}, e=${e})`);
  });

  const bs = orbit.line.geometry.boundingSphere;
  assert.ok(bs, '应计算包围球');
  assert.finite(bs.radius, '包围球半径非有限');
  // three.js 以顶点 AABB 中心为球心：对焦点在原点的椭圆，球心为几何中心 (-a*e, 0, 0)，半径为半长轴 a。
  assert.close(bs.radius, a, 1e-3, '包围球半径应等于半长轴');
  assert.close(bs.center.x, -a * e, 1e-4, '包围球中心 x 应为 -a*e');
  assert.close(bs.center.y, 0, 1e-4, '包围球中心 y 应为 0');
  assert.close(bs.center.z, 0, 1e-4, '包围球中心 z 应为 0');
}

suite('轨道线几何重建');

test('多组半长轴/偏心率/倾角均符合椭圆极坐标方程', () => {
  checkConic(4, 0.15, Math.PI / 6);
  checkConic(2.5, 0.6, -Math.PI / 4);
  checkConic(6, 0, Math.PI / 3);
});

test('倾角 0 落在 XY 平面（y=0），倾角 ±π/2 落在 XZ 平面（z=0）', () => {
  const flat = makeOrbit(4, 0, 3, -1000, 1000);
  settle(flat.orbit);
  flat.orbit.updateGeometry();
  for (const p of orbitVertices(flat.orbit)) assert.ok(Math.abs(p.y) < 1e-6, `i=0 时 y=${p.y}`);

  const vertical = makeOrbit(4, Math.PI / 2, 3, -1000, 1000);
  settle(vertical.orbit);
  vertical.orbit.updateGeometry();
  for (const p of orbitVertices(vertical.orbit)) assert.ok(Math.abs(p.z) < 1e-6, `i=π/2 时 z=${p.z}`);
});

test('有效极端输入（小半长轴、高偏心率、负倾角）顶点全部有限', () => {
  const { orbit } = makeOrbit(0.5, -Math.PI / 2, 3, -1000, 1000);
  settle(orbit);
  setEccentricity(orbit, 0.9);
  orbit.updateGeometry();
  for (const p of orbitVertices(orbit)) {
    assert.finite(p.x, '极端输入下顶点 x 非有限');
    assert.finite(p.y, '极端输入下顶点 y 非有限');
    assert.finite(p.z, '极端输入下顶点 z 非有限');
  }
  const rMax = orbitVertices(orbit).reduce((m, p) => Math.max(m, p.length()), 0);
  assert.close(rMax, 0.5 * 1.9, 1e-3, '极端参数下远拱点半径错误');
});

test('质量改变后重建的几何反映新半长轴', () => {
  const { orbit } = makeOrbit(4, Math.PI / 6, 3, -1000, 1000);
  orbit.updateMass(10);
  settle(orbit);
  orbit.updateGeometry();
  const aNew = getParams(orbit).semiMajorAxis;
  const e = getParams(orbit).eccentricity;
  const bs = orbit.line.geometry.boundingSphere;
  assert.ok(bs, '应计算包围球');
  assert.close(bs.radius, aNew, 1e-3, '质量改变后包围球半径未更新');
  assert.close(bs.center.x, -aNew * e, 1e-4, '质量改变后包围球中心未更新');
});
