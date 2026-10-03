import * as THREE from 'three';
import { Molecule } from '../src/molecule';
import {
  AtomState,
  BondState,
  MoleculeState,
  SuiteFn,
  snapshot,
  assertState,
  assertStateEquals,
  assertEqual,
  assertTrue,
  assertNoDanglingBonds
} from './harness';

function atom(id: number, element: string, x: number, y: number, z: number): AtomState {
  return { id, element, x, y, z };
}

function bond(id: number, atom1: number, atom2: number, bondType: number): BondState {
  return { id, atom1, atom2, bondType };
}

const INITIAL_ATOMS: AtomState[] = [
  atom(0, 'N', -1.21, 0.58, 0),
  atom(1, 'C', 0, 0, 0),
  atom(2, 'N', 1.21, 0.58, 0),
  atom(3, 'C', 1.21, 1.95, 0),
  atom(4, 'N', 0, 2.53, 0),
  atom(5, 'C', -1.21, 1.95, 0),
  atom(6, 'C', 0, -1.5, 0),
  atom(7, 'O', 0, -2.7, 0),
  atom(8, 'C', -2.43, 0, 0),
  atom(9, 'O', -3.63, 0, 0),
  atom(10, 'C', 2.43, 0, 0),
  atom(11, 'C', 0, 4.0, 0),
  atom(12, 'H', 2.43, -0.57, -0.9),
  atom(13, 'H', 2.43, -0.57, 0.9),
  atom(14, 'H', 2.43, 1.05, 0),
  atom(15, 'H', 0, 4.58, -0.9),
  atom(16, 'H', 0, 4.58, 0.9),
  atom(17, 'H', -0.9, 4.3, 0),
  atom(18, 'H', 0.9, 4.3, 0),
  atom(19, 'H', 2.15, 2.4, 0),
  atom(20, 'H', -2.15, 2.4, 0),
  atom(21, 'H', -2.15, -0.6, 0),
  atom(22, 'H', 1.4, 0.2, 0),
  atom(23, 'H', -1.4, 0.2, 0)
];

const INITIAL_BONDS: BondState[] = [
  bond(0, 0, 1, 1),
  bond(1, 1, 2, 1),
  bond(2, 2, 3, 2),
  bond(3, 3, 4, 1),
  bond(4, 4, 5, 2),
  bond(5, 5, 0, 1),
  bond(6, 1, 6, 1),
  bond(7, 6, 7, 2),
  bond(8, 0, 8, 1),
  bond(9, 8, 9, 2),
  bond(10, 2, 10, 1),
  bond(11, 4, 11, 1),
  bond(12, 10, 12, 1),
  bond(13, 10, 13, 1),
  bond(14, 10, 14, 1),
  bond(15, 11, 15, 1),
  bond(16, 11, 16, 1),
  bond(17, 11, 17, 1),
  bond(18, 11, 18, 1),
  bond(19, 3, 19, 1),
  bond(20, 5, 20, 1),
  bond(21, 8, 21, 1),
  bond(22, 0, 22, 1),
  bond(23, 2, 23, 1)
];

const INITIAL_STATE: MoleculeState = { atoms: INITIAL_ATOMS, bonds: INITIAL_BONDS };

function addAtomTo(state: MoleculeState, a: AtomState): MoleculeState {
  return { atoms: [...state.atoms, a], bonds: state.bonds };
}

function removeAtomFrom(state: MoleculeState, id: number): MoleculeState {
  return {
    atoms: state.atoms.filter(a => a.id !== id),
    bonds: state.bonds.filter(b => b.atom1 !== id && b.atom2 !== id)
  };
}

function addBondTo(state: MoleculeState, b: BondState): MoleculeState {
  return { atoms: state.atoms, bonds: [...state.bonds, b] };
}

function removeBondFrom(state: MoleculeState, id: number): MoleculeState {
  return { atoms: state.atoms, bonds: state.bonds.filter(b => b.id !== id) };
}

function setBondType(state: MoleculeState, id: number, bondType: number): MoleculeState {
  return {
    atoms: state.atoms,
    bonds: state.bonds.map(b => (b.id === id ? { ...b, bondType } : b))
  };
}

function createMolecule(): Molecule {
  return new Molecule(new THREE.Scene());
}

function testSequentialOperations(): void {
  const molecule = createMolecule();

  let expected = INITIAL_STATE;
  assertState(molecule, expected, '初始咖啡因分子加载');

  const sulfurId = molecule.addAtom(new THREE.Vector3(3, 3, 0), 'S', false);
  assertEqual(sulfurId, 24, '新增硫原子编号', '添加硫原子');
  expected = addAtomTo(expected, atom(24, 'S', 3, 3, 0));
  assertState(molecule, expected, '添加硫原子');

  const oxygenId = molecule.addAtom(new THREE.Vector3(-3, 3, 0), 'O', false);
  assertEqual(oxygenId, 25, '新增氧原子编号', '添加氧原子');
  expected = addAtomTo(expected, atom(25, 'O', -3, 3, 0));
  assertState(molecule, expected, '添加氧原子');

  const bondA = molecule.addBond(sulfurId, 1, 1, false);
  assertEqual(bondA, 24, '新建化学键编号', '建立键 24-1');
  expected = addBondTo(expected, bond(24, 24, 1, 1));
  assertState(molecule, expected, '建立键 24-1');

  const bondB = molecule.addBond(sulfurId, oxygenId, 2, false);
  assertEqual(bondB, 25, '新建化学键编号', '建立键 24-25');
  expected = addBondTo(expected, bond(25, 24, 25, 2));
  assertState(molecule, expected, '建立键 24-25');

  molecule.toggleBondType(bondA as number, false);
  expected = setBondType(expected, 24, 2);
  assertState(molecule, expected, '键级切换 1→2');

  molecule.toggleBondType(bondA as number, false);
  expected = setBondType(expected, 24, 3);
  assertState(molecule, expected, '键级切换 2→3');

  molecule.toggleBondType(bondA as number, false);
  expected = setBondType(expected, 24, 1);
  assertState(molecule, expected, '键级切换 3→1 (循环)');

  molecule.removeBond(bondB as number);
  expected = removeBondFrom(expected, 25);
  assertState(molecule, expected, '删除键 24-25');

  molecule.removeAtom(sulfurId, false);
  expected = removeAtomFrom(expected, sulfurId);
  assertState(molecule, expected, '删除硫原子 (级联删除键 24-1)');

  molecule.removeAtom(oxygenId, false);
  expected = removeAtomFrom(expected, oxygenId);
  assertState(molecule, expected, '删除氧原子');

  assertState(molecule, INITIAL_STATE, '全部编辑撤销后回到初始状态');
}

function testCascadeDeleteAndIdStability(): void {
  const molecule = createMolecule();
  assertState(molecule, INITIAL_STATE, '初始状态');

  const atomIdsBefore = molecule.atoms.map(a => a.id).sort((a, b) => a - b);
  const bondIdsBefore = molecule.bonds.map(b => b.id).sort((a, b) => a - b);

  molecule.removeAtom(0, false);

  const expectedAfterRemove = removeAtomFrom(INITIAL_STATE, 0);
  assertState(molecule, expectedAfterRemove, '删除原子0 (级联删除键 0/5/8/22)');

  const removedBondIds = [0, 5, 8, 22];
  const atomIdsAfter = molecule.atoms.map(a => a.id).sort((a, b) => a - b);
  const bondIdsAfter = molecule.bonds.map(b => b.id).sort((a, b) => a - b);
  assertTrue(
    atomIdsAfter.length === atomIdsBefore.length - 1 &&
      atomIdsBefore.filter(id => id !== 0).join(',') === atomIdsAfter.join(','),
    `剩余原子编号发生错位或复用: 删除前 [${atomIdsBefore}], 删除后 [${atomIdsAfter}]`,
    '删除原子后编号稳定性'
  );
  assertTrue(
    bondIdsAfter.join(',') === bondIdsBefore.filter(id => !removedBondIds.includes(id)).join(','),
    `剩余化学键编号发生错位或复用: 删除前 [${bondIdsBefore}], 删除后 [${bondIdsAfter}]`,
    '删除化学键后编号稳定性'
  );

  const newAtomId = molecule.addAtom(new THREE.Vector3(5, 5, 0), 'C', false);
  assertEqual(newAtomId, 24, '新原子编号不复用已删除编号0', '删除后新增原子编号');

  const newBondId = molecule.addBond(newAtomId, 1, 1, false);
  assertEqual(newBondId, 24, '新化学键编号不复用已删除编号', '删除后新增化学键编号');

  let expected = addAtomTo(expectedAfterRemove, atom(24, 'C', 5, 5, 0));
  expected = addBondTo(expected, bond(24, 24, 1, 1));
  assertState(molecule, expected, '删除后新增原子与化学键');

  molecule.removeAtom(0, false);
  assertState(molecule, expected, '重复删除不存在的原子为空操作');
}

function testSettingsDoNotAffectData(): void {
  const molecule = createMolecule();
  const initial = snapshot(molecule);
  assertStateEquals(initial, INITIAL_STATE, '初始状态');

  const atomMaterial = molecule.atomMesh.material as THREE.MeshStandardMaterial;

  assertEqual(molecule.atomMesh.count, 24, '初始原子实例数', '初始渲染实例数');
  assertEqual(molecule.bondMesh.count, 28, '初始化学键实例数(双键计2)', '初始渲染实例数');

  for (let round = 1; round <= 3; round++) {
    const prefix = `第${round}轮设置切换`;

    molecule.settings.showHydrogen = false;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 隐藏氢原子后数据不变`);
    assertEqual(molecule.atomMesh.count, 12, '隐藏氢后原子实例数', `${prefix}: 隐藏氢原子`);
    assertEqual(molecule.bondMesh.count, 16, '隐藏氢后化学键实例数', `${prefix}: 隐藏氢原子`);

    molecule.settings.showHydrogen = true;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 恢复显示氢原子后数据不变`);
    assertEqual(molecule.atomMesh.count, 24, '恢复显示后原子实例数', `${prefix}: 恢复显示氢原子`);
    assertEqual(molecule.bondMesh.count, 28, '恢复显示后化学键实例数', `${prefix}: 恢复显示氢原子`);

    molecule.settings.globalScale = 0.5;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 缩小后数据不变`);

    molecule.settings.globalScale = 3.0;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 放大后数据不变`);

    molecule.settings.globalScale = 1.0;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 缩放还原后数据不变`);

    molecule.settings.atomOpacity = 0.2;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 调低透明度后数据不变`);
    assertEqual(atomMaterial.opacity, 0.2, '透明度应用于材质', `${prefix}: 调低透明度`);

    molecule.settings.atomOpacity = 1.0;
    molecule.update();
    assertStateEquals(snapshot(molecule), initial, `${prefix}: 透明度还原后数据不变`);
    assertEqual(atomMaterial.opacity, 1.0, '透明度还原', `${prefix}: 透明度还原`);
  }

  assertStateEquals(snapshot(molecule), initial, '反复切换设置后分子数据与初始一致');
  assertEqual(molecule.atomMesh.count, 24, '最终原子实例数', '最终渲染状态');
  assertEqual(molecule.bondMesh.count, 28, '最终化学键实例数', '最终渲染状态');
}

function testInvalidBondRejection(): void {
  const molecule = createMolecule();
  const initial = snapshot(molecule);

  assertEqual(molecule.addBond(0, 1, 1, false), null, '重复建键被拒绝', '重复建键 (同序)');
  assertStateEquals(snapshot(molecule), initial, '重复建键 (同序) 后状态不变');

  assertEqual(molecule.addBond(1, 0, 1, false), null, '重复建键被拒绝', '重复建键 (逆序)');
  assertStateEquals(snapshot(molecule), initial, '重复建键 (逆序) 后状态不变');

  assertEqual(molecule.addBond(0, 999, 1, false), null, '对不存在原子建键被拒绝', '建键到不存在原子 (端点2)');
  assertStateEquals(snapshot(molecule), initial, '建键到不存在原子 (端点2) 后状态不变');

  assertEqual(molecule.addBond(999, 0, 1, false), null, '对不存在原子建键被拒绝', '建键到不存在原子 (端点1)');
  assertStateEquals(snapshot(molecule), initial, '建键到不存在原子 (端点1) 后状态不变');

  assertEqual(molecule.addBond(999, 1000, 1, false), null, '对不存在原子建键被拒绝', '建键到两个不存在原子');
  assertStateEquals(snapshot(molecule), initial, '建键到两个不存在原子后状态不变');

  assertEqual(molecule.addBond(5, 5, 1, false), null, '自连键被拒绝', '原子与自身建键');
  assertStateEquals(snapshot(molecule), initial, '原子与自身建键后状态不变');

  molecule.removeAtom(23, false);
  const afterRemove = snapshot(molecule);

  assertEqual(molecule.addBond(2, 23, 1, false), null, '对已删除原子建键被拒绝', '建键到已删除原子');
  assertStateEquals(snapshot(molecule), afterRemove, '建键到已删除原子后状态不变');

  assertEqual(molecule.addBond(23, 2, 1, false), null, '对已删除原子建键被拒绝', '已删除原子作为端点1建键');
  assertStateEquals(snapshot(molecule), afterRemove, '已删除原子作为端点1建键后状态不变');

  molecule.removeBond(9999);
  assertStateEquals(snapshot(molecule), afterRemove, '删除不存在化学键为空操作');

  molecule.toggleBondType(9999, false);
  assertStateEquals(snapshot(molecule), afterRemove, '切换不存在化学键键级为空操作');

  assertNoDanglingBonds(molecule, '全部非法操作后引用完整性');
}

export const suites: Array<[string, SuiteFn]> = [
  ['顺序编辑操作 (增删原子/键、键级切换)', testSequentialOperations],
  ['级联删除与编号稳定性', testCascadeDeleteAndIdStability],
  ['渲染设置不影响分子数据', testSettingsDoNotAffectData],
  ['非法建键拒绝且状态不变', testInvalidBondRejection]
];
