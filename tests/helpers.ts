import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Molecule } from '../src/molecule.ts';
import type { Atom, Bond, ElementType, BondType } from '../src/molecule.ts';

export interface AtomSnapshot {
  id: number;
  element: ElementType;
  position: [number, number, number];
}

export interface BondSnapshot {
  id: number;
  atom1: number;
  atom2: number;
  bondType: BondType;
}

export interface ChemicalSnapshot {
  atoms: AtomSnapshot[];
  bonds: BondSnapshot[];
}

export function createMolecule(): Molecule {
  const scene = new THREE.Scene();
  return new Molecule(scene);
}

export function snapshot(molecule: Molecule): ChemicalSnapshot {
  return {
    atoms: molecule.atoms.map((a: Atom) => ({
      id: a.id,
      element: a.element,
      position: [a.position.x, a.position.y, a.position.z]
    })),
    bonds: molecule.bonds.map((b: Bond) => ({
      id: b.id,
      atom1: b.atom1,
      atom2: b.atom2,
      bondType: b.bondType
    }))
  };
}

export function assertReferentialIntegrity(molecule: Molecule, label: string): void {
  const atomIds = new Set(molecule.atoms.map(a => a.id));
  assert.equal(
    atomIds.size,
    molecule.atoms.length,
    `${label}: 原子编号存在重复`
  );
  const bondIds = new Set(molecule.bonds.map(b => b.id));
  assert.equal(
    bondIds.size,
    molecule.bonds.length,
    `${label}: 化学键编号存在重复`
  );
  for (const bond of molecule.bonds) {
    assert.ok(
      atomIds.has(bond.atom1),
      `${label}: 键 ${bond.id} 悬空，引用了已删除/不存在的原子 ${bond.atom1}`
    );
    assert.ok(
      atomIds.has(bond.atom2),
      `${label}: 键 ${bond.id} 悬空，引用了已删除/不存在的原子 ${bond.atom2}`
    );
  }
}

export interface Step {
  name: string;
  run: (molecule: Molecule) => void;
  expected: {
    atomCount: number;
    bondCount: number;
    atomIds?: number[];
    bondIds?: number[];
    bonds?: Array<{ id: number; atom1: number; atom2: number; bondType: BondType }>;
  };
}

export function runScenario(steps: Step[]): Molecule {
  const molecule = createMolecule();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = `第 ${i} 步「${step.name}」之后`;
    try {
      step.run(molecule);
      molecule.update();
      assert.equal(molecule.atoms.length, step.expected.atomCount, `${label}: 原子数量不符`);
      assert.equal(molecule.bonds.length, step.expected.bondCount, `${label}: 化学键数量不符`);
      if (step.expected.atomIds) {
        assert.deepEqual(
          molecule.atoms.map(a => a.id),
          step.expected.atomIds,
          `${label}: 原子编号集合/顺序不符`
        );
      }
      if (step.expected.bondIds) {
        assert.deepEqual(
          molecule.bonds.map(b => b.id).sort((x, y) => x - y),
          [...step.expected.bondIds].sort((x, y) => x - y),
          `${label}: 化学键编号集合不符`
        );
      }
      if (step.expected.bonds) {
        assert.deepEqual(
          snapshot(molecule).bonds,
          step.expected.bonds,
          `${label}: 化学键内容与引用关系不符`
        );
      }
      assertReferentialIntegrity(molecule, label);
    } catch (error) {
      throw new Error(`${label} 状态与预期不符\n${(error as Error).message}`, { cause: error });
    }
  }
  return molecule;
}

export const INITIAL_ATOM_COUNT = 24;
export const INITIAL_BOND_COUNT = 24;
