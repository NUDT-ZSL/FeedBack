import type { MoleculeData } from '../moleculeData';
import { v3, quatFromUnitVectors, type Vec3, type Quat } from './math3';

export interface AtomModel {
  index: number;
  element: string;
  symbol: string;
  atomicNumber: number;
  position: Vec3;
  color: string;
  radius: number;
}

export interface BondModel {
  atom1: number;
  atom2: number;
  label: string;
  length: number;
  geometryLength: number;
  start: Vec3;
  end: Vec3;
  midpoint: Vec3;
  direction: Vec3;
  quaternion: Quat;
}

export interface MoleculeModel {
  moleculeId: string;
  atoms: AtomModel[];
  bonds: BondModel[];
}

export function buildMoleculeModel(data: MoleculeData): MoleculeModel {
  const atoms: AtomModel[] = data.atoms.map((atom, index) => ({
    index,
    element: atom.element,
    symbol: atom.symbol,
    atomicNumber: atom.atomicNumber,
    position: [atom.position[0], atom.position[1], atom.position[2]],
    color: atom.color,
    radius: atom.radius
  }));

  const bonds: BondModel[] = data.bonds.map(bond => {
    const start: Vec3 = [...data.atoms[bond.atom1].position];
    const end: Vec3 = [...data.atoms[bond.atom2].position];
    const delta = v3.sub(end, start);
    return {
      atom1: bond.atom1,
      atom2: bond.atom2,
      label: bond.label,
      length: bond.length,
      geometryLength: v3.length(delta),
      start,
      end,
      midpoint: v3.scale(v3.add(start, end), 0.5),
      direction: v3.normalize(delta),
      quaternion: quatFromUnitVectors([0, 1, 0], delta)
    };
  });

  return { moleculeId: data.id, atoms, bonds };
}
