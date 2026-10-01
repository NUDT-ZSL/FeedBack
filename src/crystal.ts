export interface AtomElement {
  name: string;
  color: string;
  radius: number;
}

export interface CrystalAtom {
  id: string;
  element: string;
  position: [number, number, number];
}

export interface CrystalBond {
  atomA: string;
  atomB: string;
}

export interface CrystalStructure {
  id: string;
  name: string;
  abbr: string;
  spaceGroup: string;
  latticeConstant: number;
  elements: Record<string, AtomElement>;
  atoms: CrystalAtom[];
  bonds: CrystalBond[];
}

const METAL: AtomElement = {
  name: '金属原子',
  color: '#a9a9a9',
  radius: 0.5
};

const CHLORINE: AtomElement = {
  name: '氯 (Cl)',
  color: '#00ff00',
  radius: 0.5
};

const SODIUM: AtomElement = {
  name: '钠 (Na)',
  color: '#b39ddb',
  radius: 0.4
};

const CARBON: AtomElement = {
  name: '碳 (C)',
  color: '#404040',
  radius: 0.4
};

function genBondsForCell(cellAtoms: CrystalAtom[], maxDist: number): CrystalBond[] {
  const bonds: CrystalBond[] = [];
  for (let i = 0; i < cellAtoms.length; i++) {
    for (let j = i + 1; j < cellAtoms.length; j++) {
      const a = cellAtoms[i].position;
      const b = cellAtoms[j].position;
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= maxDist + 0.01) {
        bonds.push({ atomA: cellAtoms[i].id, atomB: cellAtoms[j].id });
      }
    }
  }
  return bonds;
}

function expandUnitCell(
  baseAtoms: CrystalAtom[],
  range: [number, number] = [-1, 2]
): CrystalAtom[] {
  const expanded: CrystalAtom[] = [];
  for (let ix = range[0]; ix <= range[1]; ix++) {
    for (let iy = range[0]; iy <= range[1]; iy++) {
      for (let iz = range[0]; iz <= range[1]; iz++) {
        for (const atom of baseAtoms) {
          const px = atom.position[0] + ix;
          const py = atom.position[1] + iy;
          const pz = atom.position[2] + iz;
          if (px >= 0 && px < 1 && py >= 0 && py < 1 && pz >= 0 && pz < 1) {
            if (ix === 0 && iy === 0 && iz === 0) {
              expanded.push(atom);
            }
          } else if (ix === 0 && iy === 0 && iz === 0) {
            continue;
          }
        }
      }
    }
  }
  return expanded;
}

export const CRYSTALS: CrystalStructure[] = [
  (() => {
    const baseAtoms: CrystalAtom[] = [
      { id: 'sc-1', element: 'metal', position: [0, 0, 0] }
    ];

    const allAtoms: CrystalAtom[] = [];
    const offsets = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]
    ];
    offsets.forEach((off, i) => {
      allAtoms.push({
        id: `sc-corner-${i}`,
        element: 'metal',
        position: [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5]
      });
    });

    return {
      id: 'sc',
      name: '简单立方',
      abbr: 'SC',
      spaceGroup: 'Pm-3m',
      latticeConstant: 2.5,
      elements: { metal: METAL },
      atoms: allAtoms,
      bonds: genBondsForCell(allAtoms, 0.51)
    };
  })(),

  (() => {
    const allAtoms: CrystalAtom[] = [];
    const offsets = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]
    ];
    offsets.forEach((off, i) => {
      allAtoms.push({
        id: `bcc-corner-${i}`,
        element: 'metal',
        position: [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5]
      });
    });
    allAtoms.push({
      id: 'bcc-center',
      element: 'metal',
      position: [0.25, 0.25, 0.25]
    });

    return {
      id: 'bcc',
      name: '体心立方',
      abbr: 'BCC',
      spaceGroup: 'Im-3m',
      latticeConstant: 2.5,
      elements: { metal: METAL },
      atoms: allAtoms,
      bonds: genBondsForCell(allAtoms, 0.45)
    };
  })(),

  (() => {
    const allAtoms: CrystalAtom[] = [];
    const corners = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]
    ];
    corners.forEach((off, i) => {
      allAtoms.push({
        id: `fcc-corner-${i}`,
        element: 'metal',
        position: [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5]
      });
    });
    const faces = [
      [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
      [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0],
      [0, 0, 0.5], [0.5, 0.5, 1], [0.5, 1, 0.5], [1, 0.5, 0.5]
    ];
    faces.forEach((off, i) => {
      allAtoms.push({
        id: `fcc-face-${i}`,
        element: 'metal',
        position: [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5]
      });
    });

    return {
      id: 'fcc',
      name: '面心立方',
      abbr: 'FCC',
      spaceGroup: 'Fm-3m',
      latticeConstant: 2.5,
      elements: { metal: METAL },
      atoms: allAtoms,
      bonds: genBondsForCell(allAtoms, 0.37)
    };
  })(),

  (() => {
    const allAtoms: CrystalAtom[] = [];
    const naOffsets = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]
    ];
    naOffsets.forEach((off, i) => {
      allAtoms.push({
        id: `nacl-na-${i}`,
        element: 'Na',
        position: [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5]
      });
    });
    const clOffsets = [
      [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
      [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0],
      [0, 0, 0.5], [0.5, 0.5, 1], [0.5, 1, 0.5], [1, 0.5, 0.5]
    ];
    clOffsets.forEach((off, i) => {
      allAtoms.push({
        id: `nacl-cl-${i}`,
        element: 'Cl',
        position: [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5]
      });
    });

    return {
      id: 'nacl',
      name: '氯化钠',
      abbr: 'NaCl',
      spaceGroup: 'Fm-3m',
      latticeConstant: 2.5,
      elements: { Na: SODIUM, Cl: CHLORINE },
      atoms: allAtoms,
      bonds: genBondsForCell(allAtoms, 0.37)
    };
  })(),

  (() => {
    const allAtoms: CrystalAtom[] = [];
    const fccBase: [number, number, number][] = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
      [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
      [0.5, 0.5, 0.5], [0.5, 0, 0], [0, 0.5, 0],
      [0, 0, 0.5], [0.5, 0.5, 1], [0.5, 1, 0.5], [1, 0.5, 0.5]
    ];
    const shift: [number, number, number] = [0.25, 0.25, 0.25];
    fccBase.forEach((off, i) => {
      const p = [off[0] * 0.5, off[1] * 0.5, off[2] * 0.5];
      allAtoms.push({
        id: `diamond-fcc-${i}`,
        element: 'C',
        position: [p[0], p[1], p[2]]
      });
      allAtoms.push({
        id: `diamond-shift-${i}`,
        element: 'C',
        position: [p[0] + shift[0] * 0.5, p[1] + shift[1] * 0.5, p[2] + shift[2] * 0.5]
      });
    });

    const visibleAtoms = allAtoms.filter(a =>
      a.position[0] >= -0.01 && a.position[0] <= 0.51 &&
      a.position[1] >= -0.01 && a.position[1] <= 0.51 &&
      a.position[2] >= -0.01 && a.position[2] <= 0.51
    );

    return {
      id: 'diamond',
      name: '金刚石',
      abbr: 'Dia',
      spaceGroup: 'Fd-3m',
      latticeConstant: 2.5,
      elements: { C: CARBON },
      atoms: visibleAtoms,
      bonds: genBondsForCell(visibleAtoms, 0.26)
    };
  })()
];

export function getCrystalById(id: string): CrystalStructure | undefined {
  return CRYSTALS.find(c => c.id === id);
}
