import { Molecule } from '../src/molecule';

export interface AtomState {
  id: number;
  element: string;
  x: number;
  y: number;
  z: number;
}

export interface BondState {
  id: number;
  atom1: number;
  atom2: number;
  bondType: number;
}

export interface MoleculeState {
  atoms: AtomState[];
  bonds: BondState[];
}

const EPSILON = 1e-6;

export function snapshot(molecule: Molecule): MoleculeState {
  const atoms: AtomState[] = molecule.atoms
    .map(a => ({
      id: a.id,
      element: a.element,
      x: a.position.x,
      y: a.position.y,
      z: a.position.z
    }))
    .sort((a, b) => a.id - b.id);

  const bonds: BondState[] = molecule.bonds
    .map(b => ({
      id: b.id,
      atom1: b.atom1,
      atom2: b.atom2,
      bondType: b.bondType
    }))
    .sort((a, b) => a.id - b.id);

  return { atoms, bonds };
}

export function sortState(state: MoleculeState): MoleculeState {
  return {
    atoms: [...state.atoms].sort((a, b) => a.id - b.id),
    bonds: [...state.bonds].sort((a, b) => a.id - b.id)
  };
}

export class StepFailure extends Error {
  constructor(step: string, detail: string) {
    super(`步骤「${step}」校验失败:\n  ${detail.split('\n').join('\n  ')}`);
    this.name = 'StepFailure';
  }
}

export function assertNoDanglingBonds(molecule: Molecule, step: string): void {
  const atomIds = new Set(molecule.atoms.map(a => a.id));
  const dangling = molecule.bonds.filter(
    b => !atomIds.has(b.atom1) || !atomIds.has(b.atom2)
  );
  if (dangling.length > 0) {
    const detail = dangling
      .map(b => `键#${b.id} (${b.atom1}-${b.atom2}) 指向不存在的原子`)
      .join('\n');
    throw new StepFailure(step, `存在悬空键:\n${detail}`);
  }
}

function formatAtom(a: AtomState): string {
  return `#${a.id} ${a.element} (${a.x}, ${a.y}, ${a.z})`;
}

function formatBond(b: BondState): string {
  return `#${b.id} ${b.atom1}-${b.atom2} 键级${b.bondType}`;
}

export function diffStates(expected: MoleculeState, actual: MoleculeState): string[] {
  const exp = sortState(expected);
  const act = sortState(actual);
  const diffs: string[] = [];

  if (exp.atoms.length !== act.atoms.length) {
    diffs.push(`原子数量不一致: 期望 ${exp.atoms.length}, 实际 ${act.atoms.length}`);
  }
  const expAtomIds = new Set(exp.atoms.map(a => a.id));
  const actAtomIds = new Set(act.atoms.map(a => a.id));
  for (const a of exp.atoms) {
    if (!actAtomIds.has(a.id)) diffs.push(`缺少原子: ${formatAtom(a)}`);
  }
  for (const a of act.atoms) {
    if (!expAtomIds.has(a.id)) diffs.push(`多出原子: ${formatAtom(a)}`);
  }
  for (const ea of exp.atoms) {
    const aa = act.atoms.find(a => a.id === ea.id);
    if (!aa) continue;
    if (aa.element !== ea.element) {
      diffs.push(`原子#${ea.id} 元素不一致: 期望 ${ea.element}, 实际 ${aa.element}`);
    }
    if (
      Math.abs(aa.x - ea.x) > EPSILON ||
      Math.abs(aa.y - ea.y) > EPSILON ||
      Math.abs(aa.z - ea.z) > EPSILON
    ) {
      diffs.push(
        `原子#${ea.id} 位置不一致: 期望 (${ea.x}, ${ea.y}, ${ea.z}), 实际 (${aa.x}, ${aa.y}, ${aa.z})`
      );
    }
  }

  if (exp.bonds.length !== act.bonds.length) {
    diffs.push(`化学键数量不一致: 期望 ${exp.bonds.length}, 实际 ${act.bonds.length}`);
  }
  const expBondIds = new Set(exp.bonds.map(b => b.id));
  const actBondIds = new Set(act.bonds.map(b => b.id));
  for (const b of exp.bonds) {
    if (!actBondIds.has(b.id)) diffs.push(`缺少化学键: ${formatBond(b)}`);
  }
  for (const b of act.bonds) {
    if (!expBondIds.has(b.id)) diffs.push(`多出化学键: ${formatBond(b)}`);
  }
  for (const eb of exp.bonds) {
    const ab = act.bonds.find(b => b.id === eb.id);
    if (!ab) continue;
    if (ab.atom1 !== eb.atom1 || ab.atom2 !== eb.atom2) {
      diffs.push(
        `键#${eb.id} 端点不一致: 期望 ${eb.atom1}-${eb.atom2}, 实际 ${ab.atom1}-${ab.atom2}`
      );
    }
    if (ab.bondType !== eb.bondType) {
      diffs.push(`键#${eb.id} 键级不一致: 期望 ${eb.bondType}, 实际 ${ab.bondType}`);
    }
  }

  return diffs;
}

export function assertState(molecule: Molecule, expected: MoleculeState, step: string): void {
  assertNoDanglingBonds(molecule, step);
  const diffs = diffStates(expected, snapshot(molecule));
  if (diffs.length > 0) {
    throw new StepFailure(step, diffs.join('\n'));
  }
}

export function assertStateEquals(
  actual: MoleculeState,
  expected: MoleculeState,
  step: string
): void {
  const diffs = diffStates(expected, actual);
  if (diffs.length > 0) {
    throw new StepFailure(step, diffs.join('\n'));
  }
}

export function assertEqual<T>(actual: T, expected: T, what: string, step: string): void {
  if (actual !== expected) {
    throw new StepFailure(step, `${what}: 期望 ${expected}, 实际 ${actual}`);
  }
}

export function assertTrue(condition: boolean, what: string, step: string): void {
  if (!condition) {
    throw new StepFailure(step, what);
  }
}

export type SuiteFn = () => void;

export function runSuites(suites: Array<[string, SuiteFn]>): boolean {
  let passed = 0;
  const failures: string[] = [];

  for (const [name, fn] of suites) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`  ✗ ${name}\n    ${message.split('\n').join('\n    ')}`);
      console.log(`  ✗ ${name}`);
      console.log(`    ${message.split('\n').join('\n    ')}`);
    }
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`结果: 全部通过 (${passed}/${suites.length} 个测试套件)`);
    return true;
  }
  console.log(`结果: 失败 ${failures.length} 个, 通过 ${passed} 个, 共 ${suites.length} 个测试套件`);
  return false;
}
