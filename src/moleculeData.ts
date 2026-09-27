export interface AtomData {
  element: string;
  symbol: string;
  atomicNumber: number;
  position: [number, number, number];
  color: string;
  radius: number;
}

export interface BondData {
  atom1: number;
  atom2: number;
  label: string;
  length: number;
}

export interface MoleculeData {
  id: string;
  name: string;
  formula: string;
  displayName: string;
  atoms: AtomData[];
  bonds: BondData[];
  bestViewAngle: [number, number, number];
}

const ATOM_COLORS: Record<string, string> = {
  H: '#ffffff',
  C: '#808080',
  O: '#ff4444',
  N: '#3366ff',
  S: '#ffff33',
  P: '#ff9933'
};

const ATOM_RADII: Record<string, number> = {
  H: 0.32,
  C: 0.75,
  O: 0.73,
  N: 0.71,
  S: 1.02,
  P: 1.06
};

const ATOMIC_NUMBERS: Record<string, number> = {
  H: 1,
  C: 6,
  N: 7,
  O: 8,
  P: 15,
  S: 16
};

function createAtom(element: string, position: [number, number, number]): AtomData {
  return {
    element,
    symbol: element,
    atomicNumber: ATOMIC_NUMBERS[element] || 0,
    position,
    color: ATOM_COLORS[element] || '#ffffff',
    radius: ATOM_RADII[element] || 0.5
  };
}

export const MOLECULES: MoleculeData[] = [
  {
    id: 'H2O',
    name: 'Water',
    formula: 'H₂O',
    displayName: '水 (H₂O)',
    atoms: [
      createAtom('O', [0, 0, 0]),
      createAtom('H', [0.757, 0.586, 0]),
      createAtom('H', [-0.757, 0.586, 0])
    ],
    bonds: [
      { atom1: 0, atom2: 1, label: 'O-H₁', length: 0.958 },
      { atom1: 0, atom2: 2, label: 'O-H₂', length: 0.958 }
    ],
    bestViewAngle: [0, 0, 5]
  },
  {
    id: 'CO2',
    name: 'Carbon Dioxide',
    formula: 'CO₂',
    displayName: '二氧化碳 (CO₂)',
    atoms: [
      createAtom('C', [0, 0, 0]),
      createAtom('O', [1.16, 0, 0]),
      createAtom('O', [-1.16, 0, 0])
    ],
    bonds: [
      { atom1: 0, atom2: 1, label: 'C=O₁', length: 1.16 },
      { atom1: 0, atom2: 2, label: 'C=O₂', length: 1.16 }
    ],
    bestViewAngle: [0, 4, 4]
  },
  {
    id: 'C6H6',
    name: 'Benzene',
    formula: 'C₆H₆',
    displayName: '苯 (C₆H₆)',
    atoms: (() => {
      const atoms: AtomData[] = [];
      const rC = 1.39;
      const rH = 2.48;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        atoms.push(createAtom('C', [rC * Math.cos(angle), rC * Math.sin(angle), 0]));
      }
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        atoms.push(createAtom('H', [rH * Math.cos(angle), rH * Math.sin(angle), 0]));
      }
      return atoms;
    })(),
    bonds: (() => {
      const bonds: BondData[] = [];
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        bonds.push({
          atom1: i,
          atom2: j,
          label: `C${i + 1}-C${j + 1}`,
          length: 1.39
        });
      }
      for (let i = 0; i < 6; i++) {
        bonds.push({
          atom1: i,
          atom2: i + 6,
          label: `C${i + 1}-H${i + 1}`,
          length: 1.09
        });
      }
      return bonds;
    })(),
    bestViewAngle: [2.5, 2.5, 6]
  }
];

export function getMoleculeById(id: string): MoleculeData | undefined {
  return MOLECULES.find(m => m.id === id);
}
