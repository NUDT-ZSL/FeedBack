/**
 * 离线批量验证：对每个晶体定义，在不同晶胞范围与晶格常数下，
 * 校验 原子展开 -> 键生成 -> 渲染实例 整条推导链路的一致性。
 *
 * 运行：npm run verify
 */
import {
  CRYSTAL_DEFS,
  buildCrystalStructure
} from '../src/crystal';
import type { CellRange, CrystalStructure, CrystalBond } from '../src/crystal';
import {
  planRenderInstances,
  fractionalToWorld,
  ATOM_RADIUS_FACTOR
} from '../src/renderPlan';

declare const process: { exit(code: number): void };

const EPS = 1e-6;
const RANGES: CellRange[] = [[0, 0], [-1, 0], [-1, 1]];
const LATTICE_CONSTANTS = [1.5, 2.5, 4.0];
const RADIUS_SCALES = [0.3, 0.5, 1.0];

/** 默认范围 [0,0]（单胞闭合）下的期望原子数/键数 */
const EXPECTED_UNIT_CELL: Record<string, { atoms: number; bonds: number }> = {
  sc: { atoms: 8, bonds: 12 },
  bcc: { atoms: 9, bonds: 8 },
  fcc: { atoms: 14, bonds: 36 },
  nacl: { atoms: 27, bonds: 54 },
  diamond: { atoms: 18, bonds: 16 }
};

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function approx(a: number, b: number, eps: number = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function positionKey(p: [number, number, number]): string {
  return `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)},${Math.round(p[2] / EPS)}`;
}

function bondKey(b: CrystalBond): string {
  return b.atomA < b.atomB ? `${b.atomA}|${b.atomB}` : `${b.atomB}|${b.atomA}`;
}

function verifyBoundaryClosure(structure: CrystalStructure): void {
  const [min, max] = structure.range;
  const positions = new Set(structure.atoms.map(a => positionKey(a.position)));
  for (const atom of structure.atoms) {
    for (let axis = 0; axis < 3; axis++) {
      if (!approx(atom.position[axis], min, 1e-6)) continue;
      const image: [number, number, number] = [
        atom.position[0],
        atom.position[1],
        atom.position[2]
      ];
      image[axis] = max + 1;
      check(
        positions.has(positionKey(image)),
        `${structure.id} range=${JSON.stringify(structure.range)}: 边界原子 ${atom.id} 缺少周期镜像`
      );
    }
  }
}

function verifyStructure(structure: CrystalStructure, defBondThreshold: number): void {
  const tag = `${structure.id} range=${JSON.stringify(structure.range)} a=${structure.latticeConstant}`;

  const positionKeys = structure.atoms.map(a => positionKey(a.position));
  check(
    new Set(positionKeys).size === structure.atoms.length,
    `${tag}: 原子位置存在重复`
  );
  check(
    new Set(structure.atoms.map(a => a.id)).size === structure.atoms.length,
    `${tag}: 原子 id 存在重复`
  );

  const atomIds = new Set(structure.atoms.map(a => a.id));
  const bondKeys = new Set<string>();
  for (const bond of structure.bonds) {
    check(atomIds.has(bond.atomA), `${tag}: 键引用了不存在的原子 ${bond.atomA}`);
    check(atomIds.has(bond.atomB), `${tag}: 键引用了不存在的原子 ${bond.atomB}`);
    check(bond.atomA !== bond.atomB, `${tag}: 存在自连键`);
    const key = bondKey(bond);
    check(!bondKeys.has(key), `${tag}: 存在重复键 ${key}`);
    bondKeys.add(key);
  }

  const byId = new Map(structure.atoms.map(a => [a.id, a]));
  for (const bond of structure.bonds) {
    const a = byId.get(bond.atomA)!;
    const b = byId.get(bond.atomB)!;
    const d = Math.sqrt(
      (a.position[0] - b.position[0]) ** 2 +
      (a.position[1] - b.position[1]) ** 2 +
      (a.position[2] - b.position[2]) ** 2
    );
    check(
      d <= defBondThreshold + EPS,
      `${tag}: 键长 ${d.toFixed(4)} 超过阈值 ${defBondThreshold}`
    );
  }

  verifyBoundaryClosure(structure);
}

function verifyRenderPlan(structure: CrystalStructure, radiusScale: number): void {
  const tag = `${structure.id} range=${JSON.stringify(structure.range)} a=${structure.latticeConstant} r=${radiusScale}`;
  const plan = planRenderInstances(structure, radiusScale);

  check(
    plan.atoms.length === structure.atoms.length,
    `${tag}: 渲染原子实例数 ${plan.atoms.length} 与原子数 ${structure.atoms.length} 不一致`
  );
  check(
    plan.bonds.length === structure.bonds.length,
    `${tag}: 渲染键实例数 ${plan.bonds.length} 与键数 ${structure.bonds.length} 不一致`
  );

  const atomById = new Map(structure.atoms.map(a => [a.id, a]));
  for (const instance of plan.atoms) {
    const atom = atomById.get(instance.id);
    check(!!atom, `${tag}: 实例 ${instance.id} 无对应原子`);
    if (!atom) continue;

    const expected = fractionalToWorld(atom.position, structure.range);
    check(
      approx(instance.position[0], expected[0]) &&
        approx(instance.position[1], expected[1]) &&
        approx(instance.position[2], expected[2]),
      `${tag}: 实例坐标与推导坐标不一致`
    );

    const elem = structure.elements[atom.element];
    check(
      approx(instance.radius, elem.radius * radiusScale * ATOM_RADIUS_FACTOR),
      `${tag}: 实例半径与元素半径 × 比例不一致`
    );
    check(instance.color === elem.color, `${tag}: 实例颜色与元素颜色不一致`);
  }

  for (const bond of plan.bonds) {
    check(
      bond.length > 0 &&
        bond.length <= (CRYSTAL_DEFS.find(c => c.id === structure.id)!.bondThreshold + EPS) *
          (2 / (structure.range[1] + 1 - structure.range[0])),
      `${tag}: 渲染键长度超出预期`
    );
  }
}

const rows: string[] = [];

for (const def of CRYSTAL_DEFS) {
  for (const range of RANGES) {
    const baseline = buildCrystalStructure(def, range, def.latticeConstant);

    for (const latticeConstant of LATTICE_CONSTANTS) {
      const structure = buildCrystalStructure(def, range, latticeConstant);
      check(structure.latticeConstant === latticeConstant, '晶格常数未透传到结构');

      verifyStructure(structure, def.bondThreshold);
      for (const radiusScale of RADIUS_SCALES) {
        verifyRenderPlan(structure, radiusScale);
      }

      check(
        structure.atoms.length === baseline.atoms.length &&
          structure.bonds.length === baseline.bonds.length,
        `${def.id} range=${JSON.stringify(range)}: 调整晶格常数后原子/键数发生变化`
      );

      if (range[0] === 0 && range[1] === 0 && latticeConstant === def.latticeConstant) {
        const expected = EXPECTED_UNIT_CELL[def.id];
        check(
          structure.atoms.length === expected.atoms,
          `${def.id}: 单胞原子数 ${structure.atoms.length} 与期望值 ${expected.atoms} 不符`
        );
        check(
          structure.bonds.length === expected.bonds,
          `${def.id}: 单胞键数 ${structure.bonds.length} 与期望值 ${expected.bonds} 不符`
        );
      }

      if (latticeConstant !== def.latticeConstant) {
        const base = buildCrystalStructure(def, range, def.latticeConstant);
        const ratio = latticeConstant / def.latticeConstant;
        for (let i = 0; i < structure.bonds.length; i++) {
          const scaled = structure.bonds[i];
          const ref = base.bonds[i];
          const distOf = (s: CrystalStructure, b: CrystalBond): number => {
            const a = s.atoms.find(x => x.id === b.atomA)!;
            const c = s.atoms.find(x => x.id === b.atomB)!;
            return (
              Math.sqrt(
                (a.position[0] - c.position[0]) ** 2 +
                  (a.position[1] - c.position[1]) ** 2 +
                  (a.position[2] - c.position[2]) ** 2
              ) * s.latticeConstant
            );
          };
          check(
            approx(distOf(structure, scaled), distOf(base, ref) * ratio, 1e-9),
            `${def.id}: 物理键长未随晶格常数等比缩放`
          );
        }
      }

      rows.push(
        `${def.id.padEnd(8)} ${JSON.stringify(range).padEnd(9)} a=${latticeConstant}  atoms=${String(structure.atoms.length).padStart(3)} bonds=${String(structure.bonds.length).padStart(3)} instances=${String(planRenderInstances(structure, 0.5).atoms.length).padStart(3)}/${String(planRenderInstances(structure, 0.5).bonds.length).padStart(3)}`
      );
    }
  }
}

console.log('晶体推导链路批量验证');
console.log('='.repeat(72));
console.log(rows.join('\n'));
console.log('='.repeat(72));
if (failures.length > 0) {
  console.error(`\n验证失败（${failures.length} 项）：`);
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('\n全部校验通过：原子数、键数、渲染实例数在不同晶胞范围与晶格常数下保持一致。');
