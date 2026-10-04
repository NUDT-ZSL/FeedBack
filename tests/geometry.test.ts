import { test, assert, assertClose, assertVec3Close } from './harness';
import { buildMoleculeModel } from '../src/core/moleculeGeometry';
import { v3, applyQuat } from '../src/core/math3';
import { MOLECULES } from '../src/moleculeData';

test('构建结果: 每个分子的原子/键数量与数据一致', () => {
  for (const data of MOLECULES) {
    const model = buildMoleculeModel(data);
    assert(model.atoms.length === data.atoms.length, `${data.id} 原子数量`);
    assert(model.bonds.length === data.bonds.length, `${data.id} 键数量`);
    model.atoms.forEach((atom, i) => {
      assertVec3Close(atom.position, data.atoms[i].position, 1e-12, `${data.id} 原子${i}坐标`);
      assertClose(atom.radius, data.atoms[i].radius, 1e-12, `${data.id} 原子${i}半径`);
      assert(atom.index === i, `${data.id} 原子${i}序号`);
    });
    model.bonds.forEach((bond, i) => {
      assert(bond.atom1 === data.bonds[i].atom1, `${data.id} 键${i}端点1`);
      assert(bond.atom2 === data.bonds[i].atom2, `${data.id} 键${i}端点2`);
      assertClose(bond.length, data.bonds[i].length, 1e-12, `${data.id} 键${i}展示长度`);
    });
  }
});

test('键构建: 起点/终点/中点/几何长度可独立推算', () => {
  for (const data of MOLECULES) {
    const model = buildMoleculeModel(data);
    model.bonds.forEach(bond => {
      const a1 = data.atoms[bond.atom1].position;
      const a2 = data.atoms[bond.atom2].position;
      assertVec3Close(bond.start, a1, 1e-12, `${data.id} 键起点`);
      assertVec3Close(bond.end, a2, 1e-12, `${data.id} 键终点`);
      assertVec3Close(bond.midpoint, [(a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2, (a1[2] + a2[2]) / 2], 1e-12, `${data.id} 键中点`);
      assertClose(bond.geometryLength, v3.distance(a1, a2), 1e-12, `${data.id} 键几何长度`);
      assertClose(v3.length(bond.direction), 1, 1e-12, `${data.id} 键方向为单位向量`);
    });
  }
});

test('键构建: 四元数把圆柱默认轴向(0,1,0)旋转到键方向', () => {
  for (const data of MOLECULES) {
    const model = buildMoleculeModel(data);
    for (const bond of model.bonds) {
      const rotated = applyQuat(bond.quaternion, [0, 1, 0]);
      assertVec3Close(rotated, bond.direction, 1e-9, `${data.id} 键${bond.label}朝向`);
    }
  }
});

test('构建结果是纯函数: 相同输入多次结果一致且不修改入参', () => {
  const data = MOLECULES[2];
  const snapshot = JSON.stringify(data);
  const m1 = buildMoleculeModel(data);
  const m2 = buildMoleculeModel(data);
  assert(JSON.stringify(m1) === JSON.stringify(m2), '两次构建结果应完全相同');
  assert(JSON.stringify(data) === snapshot, '入参分子数据不应被修改');
});

test('展示用键长与几何键长口径分离: H2O 的 O-H 展示0.958', () => {
  const water = buildMoleculeModel(MOLECULES[0]);
  water.bonds.forEach(bond => {
    assertClose(bond.length, 0.958, 1e-12, '面板展示键长保持0.958');
    assertClose(bond.geometryLength, Math.hypot(0.757, 0.586), 1e-12, '几何长度来自坐标');
  });
});
