import type { MoleculeData, AtomData, BondData } from '../moleculeData';

export type Vec3Tuple = [number, number, number];

export interface AtomSpec {
  index: number;
  data: AtomData;
  position: Vec3Tuple;
  radius: number;
}

export interface BondSpec {
  index: number;
  data: BondData;
  start: Vec3Tuple;
  end: Vec3Tuple;
  midpoint: Vec3Tuple;
  direction: Vec3Tuple;
  geometryLength: number;
  displayLength: number;
}

export interface MoleculeSpec {
  molecule: MoleculeData;
  atoms: AtomSpec[];
  bonds: BondSpec[];
}

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: Vec3Tuple): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function buildMoleculeSpec(molecule: MoleculeData): MoleculeSpec {
  const atoms: AtomSpec[] = molecule.atoms.map((data, index) => ({
    index,
    data,
    position: [...data.position] as Vec3Tuple,
    radius: data.radius
  }));

  const bonds: BondSpec[] = molecule.bonds.map((data, index) => {
    const start = molecule.atoms[data.atom1].position;
    const end = molecule.atoms[data.atom2].position;
    const delta = sub(end, start);
    const geometryLength = length(delta);
    const direction: Vec3Tuple = geometryLength > 0
      ? [delta[0] / geometryLength, delta[1] / geometryLength, delta[2] / geometryLength]
      : [0, 1, 0];
    return {
      index,
      data,
      start: [...start] as Vec3Tuple,
      end: [...end] as Vec3Tuple,
      midpoint: [
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        (start[2] + end[2]) / 2
      ],
      direction,
      geometryLength,
      displayLength: data.length
    };
  });

  return { molecule, atoms, bonds };
}
