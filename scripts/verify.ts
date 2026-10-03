/**
 * 离线批量验证入口：node scripts/verify.ts
 *
 * 对全部晶体定义 × 多组晶胞范围 × 多组晶格常数，验证
 * 「定义 → 晶胞扩展 → 键生成 → 渲染实例」派生链路的一致性：
 *   1. 原子数/键数符合理论预期（回归表）
 *   2. 晶胞边界原子不产生重复实例（坐标全局唯一）
 *   3. 键端点引用存在的原子、无自环、无重复键
 *   4. 键长 ≤ 阈值 × 晶格常数，且键连接关系不随晶格常数变化
 *   5. 渲染实例数与原子数/键数一致，位置与半径由同一份数据推导
 */
import {
  CRYSTAL_DEFINITIONS,
  buildCrystalStructure,
  expandUnitCell,
  type CellRange,
  type CrystalStructure
} from '../src/crystal.ts';
import {
  ATOM_RADIUS_FACTOR,
  SCENE_UNITS_PER_CELL,
  buildRenderInstances,
  getCellCenter
} from '../src/render.ts';

const CELL_RANGES: CellRange[] = [
  [0, 0],
  [0, 1],
  [-1, 0],
  [-1, 1],
  [0, 2]
];
const LATTICE_CONSTANTS = [1.0, 2.5, 5.0];
const RADIUS_SCALES = [0.3, 0.5, 1.0];
const EPS = 1e-6;

/** 理论回归表：crystalId -> rangeKey -> [原子数, 键数] */
const EXPECTED_COUNTS: Record<string, Record<string, [number, number]>> = {
  sc: { '0,0': [8, 12], '0,1': [27, 54], '-1,1': [64, 144] },
  bcc: { '0,0': [9, 8], '0,1': [35, 64], '-1,1': [91, 216] },
  fcc: { '0,0': [14, 36], '0,1': [63, 240], '-1,1': [172, 756] },
  nacl: { '0,0': [27, 54], '0,1': [125, 300], '-1,1': [343, 882] },
  diamond: { '0,0': [18, 16], '0,1': [95, 128], '-1,1': [280, 432] }
};

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (!condition) {
    failures++;
    console.error(`  ✗ ${message}`);
  }
}

function fractionalDistance(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function verifyStructure(structure: CrystalStructure): void {
  const label = `${structure.id} range=[${structure.cellRange}] a=${structure.latticeConstant}`;
  const atomIds = new Set(structure.atoms.map(atom => atom.id));

  // 原子 id 与坐标全局唯一（边界原子不重复实例化）
  check(atomIds.size === structure.atoms.length, `${label}: 原子 id 重复`);
  const positionKeys = new Set(
    structure.atoms.map(atom => atom.position.map(v => v.toFixed(4)).join(','))
  );
  check(positionKeys.size === structure.atoms.length, `${label}: 原子坐标重复（边界去重失败）`);

  // 键的合法性
  const pairKeys = new Set<string>();
  for (const bond of structure.bonds) {
    check(atomIds.has(bond.atomA) && atomIds.has(bond.atomB),
      `${label}: 键 ${bond.atomA}-${bond.atomB} 引用了不存在的原子`);
    check(bond.atomA !== bond.atomB, `${label}: 存在自环键 ${bond.atomA}`);
    const key = [bond.atomA, bond.atomB].sort().join('|');
    check(!pairKeys.has(key), `${label}: 重复键 ${key}`);
    pairKeys.add(key);
  }

  // 键长阈值随晶格常数缩放：所有键长（埃）≤ bondThreshold × latticeConstant
  const atomById = new Map(structure.atoms.map(atom => [atom.id, atom]));
  const maxBond = structure.bondThreshold * structure.latticeConstant;
  for (const bond of structure.bonds) {
    const a = atomById.get(bond.atomA)!;
    const b = atomById.get(bond.atomB)!;
    const length = fractionalDistance(a.position, b.position) * structure.latticeConstant;
    check(length > EPS, `${label}: 零长度键 ${bond.atomA}`);
    check(length <= maxBond + 1e-4,
      `${label}: 键长 ${length.toFixed(4)}Å 超过阈值 ${maxBond.toFixed(4)}Å`);
  }
}

function verifyRenderInstances(structure: CrystalStructure): void {
  const label = `${structure.id} range=[${structure.cellRange}] a=${structure.latticeConstant}`;
  const center = getCellCenter(structure.cellRange);

  for (const radiusScale of RADIUS_SCALES) {
    const instances = buildRenderInstances(structure, { atomRadiusScale: radiusScale });

    // 渲染实例数与数据一致
    check(instances.atoms.length === structure.atoms.length,
      `${label} scale=${radiusScale}: 原子实例数 ${instances.atoms.length} != 原子数 ${structure.atoms.length}`);
    check(instances.bonds.length === structure.bonds.length,
      `${label} scale=${radiusScale}: 键实例数 ${instances.bonds.length} != 键数 ${structure.bonds.length}`);

    // 实例位置/半径由结构数据推导
    const atomById = new Map(structure.atoms.map(atom => [atom.id, atom]));
    for (const instance of instances.atoms) {
      const atom = atomById.get(instance.id)!;
      const element = structure.elements[instance.element];
      for (let axis = 0; axis < 3; axis++) {
        const expected = (atom.position[axis] - center[axis]) * SCENE_UNITS_PER_CELL;
        check(Math.abs(instance.position[axis] - expected) < EPS,
          `${label}: 原子 ${instance.id} 实例位置轴${axis}偏差`);
      }
      const expectedRadius = element.radius * radiusScale * ATOM_RADIUS_FACTOR;
      check(Math.abs(instance.radius - expectedRadius) < EPS,
        `${label}: 原子 ${instance.id} 实例半径偏差`);
    }

    // 键实例长度 = 分数距离 × 每晶胞场景单位，与晶格常数同比缩放后仍受阈值约束
    for (const instance of instances.bonds) {
      const a = atomById.get(instance.atomA)!;
      const b = atomById.get(instance.atomB)!;
      const expectedLength = fractionalDistance(a.position, b.position) * SCENE_UNITS_PER_CELL;
      check(Math.abs(instance.length - expectedLength) < EPS,
        `${label}: 键 ${instance.atomA}-${instance.atomB} 实例长度偏差`);
    }
  }
}

console.log('== 晶体数据派生链路批量验证 ==\n');

// 边界去重专项：基元中坐标 1 与坐标 0 应归并为同一原子
{
  const deduped = expandUnitCell(
    [
      { element: 'metal', position: [0, 0, 0] },
      { element: 'metal', position: [1, 0, 0] },
      { element: 'metal', position: [1, 1, 1] }
    ],
    [0, 0]
  );
  check(deduped.length === 8,
    `边界归一化: 含重复边界基元的展开应得 8 个顶点，实际 ${deduped.length}`);
}

for (const definition of CRYSTAL_DEFINITIONS) {
  for (const range of CELL_RANGES) {
    const structures = LATTICE_CONSTANTS.map(a =>
      buildCrystalStructure(definition, range, a)
    );

    // 键连接关系不随晶格常数变化
    const [first, ...rest] = structures;
    for (const other of rest) {
      check(other.atoms.length === first.atoms.length,
        `${definition.id} range=[${range}]: 原子数随晶格常数变化`);
      check(other.bonds.length === first.bonds.length,
        `${definition.id} range=[${range}]: 键数随晶格常数变化（${other.bonds.length} != ${first.bonds.length}）`);
    }

    // 理论计数回归
    const expected = EXPECTED_COUNTS[definition.id]?.[range.join(',')];
    if (expected) {
      check(first.atoms.length === expected[0],
        `${definition.id} range=[${range}]: 原子数 ${first.atoms.length} != 预期 ${expected[0]}`);
      check(first.bonds.length === expected[1],
        `${definition.id} range=[${range}]: 键数 ${first.bonds.length} != 预期 ${expected[1]}`);
    }

    for (const structure of structures) {
      verifyStructure(structure);
      verifyRenderInstances(structure);
    }

    console.log(
      `  ${definition.abbr.padEnd(5)} range=[${String(range).padEnd(5)}] ` +
      `atoms=${String(first.atoms.length).padStart(3)} bonds=${String(first.bonds.length).padStart(3)} ` +
      `instances=${first.atoms.length}+${first.bonds.length} ✓`
    );
  }
}

console.log(`\n共 ${checks} 项检查，失败 ${failures} 项`);
if (failures > 0) {
  process.exit(1);
}
console.log('全部通过 ✓');
