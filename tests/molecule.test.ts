import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createMolecule,
  snapshot,
  runScenario,
  assertReferentialIntegrity,
  INITIAL_ATOM_COUNT,
  INITIAL_BOND_COUNT
} from './helpers.ts';
import type { ChemicalSnapshot } from './helpers.ts';
import type { ElementType } from '../src/molecule.ts';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

let cachedInitialBonds: ChemicalSnapshot['bonds'] | null = null;
function initialBonds(): ChemicalSnapshot['bonds'] {
  if (!cachedInitialBonds) {
    cachedInitialBonds = snapshot(createMolecule()).bonds;
  }
  return cachedInitialBonds;
}

test('按序执行增删原子、增删键、切换键级后集合内容与引用关系完全一致', () => {
  const molecule = runScenario([
    {
      name: '添加碳原子',
      run: (m) => m.addAtom(v(5, 5, 0), 'C', false),
      expected: { atomCount: 25, bondCount: 24, atomIds: [...Array(25).keys()] }
    },
    {
      name: '添加氧原子',
      run: (m) => m.addAtom(v(6, 5, 0), 'O', false),
      expected: { atomCount: 26, bondCount: 24 }
    },
    {
      name: '在 24-25 之间建立双键',
      run: (m) => assert.equal(m.addBond(24, 25, 2, false), 24),
      expected: {
        atomCount: 26,
        bondCount: 25,
        bonds: [...initialBonds(), { id: 24, atom1: 24, atom2: 25, bondType: 2 }]
      }
    },
    {
      name: '在 24-1 之间建立单键',
      run: (m) => assert.equal(m.addBond(24, 1, 1, false), 25),
      expected: { atomCount: 26, bondCount: 26 }
    },
    {
      name: '将键 24 从双键切换为三键',
      run: (m) => m.toggleBondType(24),
      expected: {
        atomCount: 26,
        bondCount: 26,
        bonds: [
          ...initialBonds(),
          { id: 24, atom1: 24, atom2: 25, bondType: 3 },
          { id: 25, atom1: 24, atom2: 1, bondType: 1 }
        ]
      }
    },
    {
      name: '删除键 25（24-1）',
      run: (m) => m.removeBond(25),
      expected: {
        atomCount: 26,
        bondCount: 25,
        bonds: [...initialBonds(), { id: 24, atom1: 24, atom2: 25, bondType: 3 }]
      }
    },
    {
      name: '删除原子 25，其键 24 必须级联消失',
      run: (m) => m.removeAtom(25, false),
      expected: {
        atomCount: 25,
        bondCount: 24,
        atomIds: [...Array(25).keys()],
        bonds: initialBonds()
      }
    }
  ]);

  assertReferentialIntegrity(molecule, '序列结束');

  const replacementId = molecule.addAtom(v(7, 5, 0), 'C', false);
  assert.equal(replacementId, 26, '已删除原子编号 25 不应被复用');
  assert.ok(!molecule.atoms.some(a => a.id === 25), '原子 25 不应复活');
});

test('删除原子时相连化学键一并消失，其余编号不错位、不复用', () => {
  const molecule = createMolecule();
  const initial = snapshot(molecule);

  molecule.removeAtom(10, false);
  molecule.update();

  assert.equal(molecule.atoms.length, INITIAL_ATOM_COUNT - 1);
  assert.equal(molecule.bonds.length, INITIAL_BOND_COUNT - 4, '原子 10 原连有 4 条键');

  const incidentBonds = [
    { id: 10, atom1: 2, atom2: 10, bondType: 1 },
    { id: 12, atom1: 10, atom2: 12, bondType: 1 },
    { id: 13, atom1: 10, atom2: 13, bondType: 1 },
    { id: 14, atom1: 10, atom2: 14, bondType: 1 }
  ];
  for (const gone of incidentBonds) {
    assert.ok(
      !molecule.bonds.some(b => b.id === gone.id),
      `键 ${gone.id} 应随原子 10 一并删除`
    );
  }

  const expectedBonds = initial.bonds.filter(b =>
    b.atom1 !== 10 && b.atom2 !== 10
  );
  assert.deepEqual(snapshot(molecule).bonds, expectedBonds, '其余化学键必须原样保留且编号不变');

  assert.deepEqual(
    molecule.atoms.map(a => a.id),
    initial.atoms.filter(a => a.id !== 10).map(a => a.id),
    '剩余原子编号不得错位'
  );
  assertReferentialIntegrity(molecule, '删除原子 10 之后');

  const newId = molecule.addAtom(v(0, 0, 0), 'C', false);
  assert.equal(newId, 24, '新原子编号必须递增，不能复用空位编号 10');
});

test('氢显隐、全局缩放、透明度反复切换不改变底层分子数据', () => {
  const molecule = createMolecule();
  const before = snapshot(molecule);

  molecule.settings.showHydrogen = false;
  molecule.update();
  assert.equal(molecule.atoms.length, before.atoms.length, '隐藏氢不应删除原子');
  assert.equal(molecule.bonds.length, before.bonds.length, '隐藏氢不应删除化学键');
  molecule.settings.showHydrogen = true;
  molecule.update();

  molecule.settings.globalScale = 0.5;
  molecule.update();
  molecule.settings.globalScale = 3.0;
  molecule.update();
  molecule.settings.globalScale = 1.0;
  molecule.update();

  molecule.settings.atomOpacity = 0.2;
  molecule.update();
  molecule.settings.atomOpacity = 1.0;
  molecule.update();

  for (let i = 0; i < 3; i++) {
    molecule.settings.showHydrogen = false;
    molecule.settings.showHydrogen = true;
    molecule.settings.globalScale = 1.5;
    molecule.settings.atomOpacity = 0.7;
    molecule.update();
  }
  molecule.settings.globalScale = 1.0;
  molecule.settings.atomOpacity = 1.0;
  molecule.update();

  assert.deepEqual(snapshot(molecule), before, '反复切换设置后分子数据必须与初始一致');
  assertReferentialIntegrity(molecule, '设置切换后');
});

test('重复成键（含反向）与对不存在原子成键被拒绝，且状态不变', () => {
  const molecule = createMolecule();
  const before = snapshot(molecule);
  const beforeCount = molecule.bonds.length;

  assert.equal(molecule.addBond(0, 1, 1, false), null, '已存在的键必须被拒绝');
  assert.equal(molecule.addBond(1, 0, 2, false), null, '反向重复键必须被拒绝');
  assert.equal(molecule.addBond(5, 5, 1, false), null, '原子不能与自身成键');
  assert.equal(molecule.addBond(0, 999, 1, false), null, '对不存在的原子成键必须被拒绝');
  assert.equal(molecule.addBond(999, 1000, 1, false), null, '双方都不存在时必须被拒绝');

  assert.equal(molecule.atoms.length, before.atoms.length);
  assert.equal(molecule.bonds.length, beforeCount, '拒绝成键后化学键数量不得变化');
  assert.deepEqual(snapshot(molecule), before, '拒绝成键后分子状态必须保持不变');
  assertReferentialIntegrity(molecule, '非法成键被拒绝后');
});

test('相同初始分子与操作序列每次得到一致结论（可重复性）', () => {
  const element: ElementType = 'N';

  const runOnce = (): ChemicalSnapshot => {
    const molecule = createMolecule();
    molecule.addAtom(v(5, 0, 0), element, false);
    molecule.addAtom(v(6, 0, 0), 'H', false);
    molecule.addBond(24, 25, 1, false);
    molecule.addBond(24, 0, 1, false);
    molecule.toggleBondType(24);
    molecule.removeAtom(7, false);
    molecule.removeBond(25);
    molecule.settings.showHydrogen = false;
    molecule.settings.showHydrogen = true;
    molecule.update();
    return snapshot(molecule);
  };

  const first = runOnce();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(runOnce(), first, '同一序列重复执行结果必须完全一致');
  }
});

test('删除原子后对已删除原子成键被拒绝，新建键仍可正常建立', () => {
  const molecule = createMolecule();
  molecule.removeAtom(0, false);
  assert.equal(molecule.addBond(0, 1, 1, false), null, '对刚删除的原子成键必须被拒绝');

  const bondId = molecule.addBond(1, 8, 1, false);
  assert.notEqual(bondId, null, '存活原子之间应能成键');
  assert.equal(bondId, 24, '化学键编号同样只能递增，不能复用');
  assertReferentialIntegrity(molecule, '混合操作后');
});
