import { describe, it, expect } from 'vitest';
import { MOLECULES } from '../src/moleculeData';
import { buildMoleculeSpec } from '../src/core/moleculeGeometry';

describe('buildMoleculeSpec 原子与键构建推演', () => {
  it('H2O: 3 个原子、2 根键，原子位置与半径来自分子数据', () => {
    const spec = buildMoleculeSpec(MOLECULES[0]);
    expect(spec.atoms).toHaveLength(3);
    expect(spec.bonds).toHaveLength(2);

    spec.atoms.forEach((atom, index) => {
      expect(atom.position).toEqual(MOLECULES[0].atoms[index].position);
      expect(atom.radius).toBe(MOLECULES[0].atoms[index].radius);
      expect(atom.index).toBe(index);
    });
  });

  it('CO2: 线性三原子，2 根双键', () => {
    const spec = buildMoleculeSpec(MOLECULES[1]);
    expect(spec.atoms.map(a => a.data.symbol)).toEqual(['C', 'O', 'O']);
    expect(spec.bonds).toHaveLength(2);
    expect(spec.bonds.map(b => b.data.label)).toEqual(['C=O₁', 'C=O₂']);
  });

  it('C6H6: 12 个原子、12 根键（6 C-C + 6 C-H）', () => {
    const spec = buildMoleculeSpec(MOLECULES[2]);
    expect(spec.atoms).toHaveLength(12);
    expect(spec.bonds).toHaveLength(12);

    const carbonAtoms = spec.atoms.filter(a => a.data.symbol === 'C');
    const hydrogenAtoms = spec.atoms.filter(a => a.data.symbol === 'H');
    expect(carbonAtoms).toHaveLength(6);
    expect(hydrogenAtoms).toHaveLength(6);

    for (const atom of carbonAtoms) {
      const r = Math.hypot(atom.position[0], atom.position[1]);
      expect(r).toBeCloseTo(1.39, 5);
    }
    for (const atom of hydrogenAtoms) {
      const r = Math.hypot(atom.position[0], atom.position[1]);
      expect(r).toBeCloseTo(2.48, 5);
    }
  });

  it('键的几何长度等于两端原子实际距离，展示长度保持数据定义', () => {
    for (const molecule of MOLECULES) {
      const spec = buildMoleculeSpec(molecule);
      for (const bond of spec.bonds) {
        const [a1, a2] = [
          molecule.atoms[bond.data.atom1].position,
          molecule.atoms[bond.data.atom2].position
        ];
        const expected = Math.hypot(a1[0] - a2[0], a1[1] - a2[1], a1[2] - a2[2]);
        expect(bond.geometryLength).toBeCloseTo(expected, 10);
        expect(bond.displayLength).toBe(bond.data.length);
        const dirLength = Math.hypot(bond.direction[0], bond.direction[1], bond.direction[2]);
        expect(dirLength).toBeCloseTo(1, 10);
        expect(bond.midpoint[0]).toBeCloseTo((bond.start[0] + bond.end[0]) / 2, 10);
      }
    }
  });

  it('H2O 键长展示口径固定为 0.958（几何距离约 0.9574）', () => {
    const spec = buildMoleculeSpec(MOLECULES[0]);
    expect(spec.bonds[0].displayLength).toBe(0.958);
    expect(spec.bonds[0].geometryLength).toBeCloseTo(0.9574, 3);
  });
});
