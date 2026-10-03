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

export type CellRange = [number, number];

/** 晶胞基元：单个原子在一个晶胞内的分数坐标（约定 0 <= 坐标 < 1） */
export interface BasisAtom {
  element: string;
  position: [number, number, number];
}

/** 晶体定义：只需描述一个晶胞，展开与成键均由定义推导 */
export interface UnitCellDef {
  id: string;
  name: string;
  abbr: string;
  spaceGroup: string;
  latticeConstant: number;
  elements: Record<string, AtomElement>;
  basis: BasisAtom[];
  /** 成键距离阈值（分数坐标单位，物理距离 = 阈值 × 晶格常数） */
  bondThreshold: number;
}

export interface CrystalStructure {
  id: string;
  name: string;
  abbr: string;
  spaceGroup: string;
  latticeConstant: number;
  range: CellRange;
  elements: Record<string, AtomElement>;
  atoms: CrystalAtom[];
  bonds: CrystalBond[];
}

/** 默认展示范围：单个晶胞 [0,1]，边界闭合 */
export const DEFAULT_RANGE: CellRange = [0, 0];

/** 默认晶格常数（埃），渲染层以此为 1 倍缩放基准 */
export const DEFAULT_LATTICE_CONSTANT = 2.5;

const POS_EPS = 1e-6;

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

export const CRYSTAL_DEFS: UnitCellDef[] = [
  {
    id: 'sc',
    name: '简单立方',
    abbr: 'SC',
    spaceGroup: 'Pm-3m',
    latticeConstant: 2.5,
    elements: { metal: METAL },
    basis: [
      { element: 'metal', position: [0, 0, 0] }
    ],
    bondThreshold: 1.01
  },
  {
    id: 'bcc',
    name: '体心立方',
    abbr: 'BCC',
    spaceGroup: 'Im-3m',
    latticeConstant: 2.5,
    elements: { metal: METAL },
    basis: [
      { element: 'metal', position: [0, 0, 0] },
      { element: 'metal', position: [0.5, 0.5, 0.5] }
    ],
    bondThreshold: 0.87
  },
  {
    id: 'fcc',
    name: '面心立方',
    abbr: 'FCC',
    spaceGroup: 'Fm-3m',
    latticeConstant: 2.5,
    elements: { metal: METAL },
    basis: [
      { element: 'metal', position: [0, 0, 0] },
      { element: 'metal', position: [0.5, 0.5, 0] },
      { element: 'metal', position: [0.5, 0, 0.5] },
      { element: 'metal', position: [0, 0.5, 0.5] }
    ],
    bondThreshold: 0.71
  },
  {
    id: 'nacl',
    name: '氯化钠',
    abbr: 'NaCl',
    spaceGroup: 'Fm-3m',
    latticeConstant: 2.5,
    elements: { Na: SODIUM, Cl: CHLORINE },
    basis: [
      { element: 'Na', position: [0, 0, 0] },
      { element: 'Na', position: [0.5, 0.5, 0] },
      { element: 'Na', position: [0.5, 0, 0.5] },
      { element: 'Na', position: [0, 0.5, 0.5] },
      { element: 'Cl', position: [0.5, 0, 0] },
      { element: 'Cl', position: [0, 0.5, 0] },
      { element: 'Cl', position: [0, 0, 0.5] },
      { element: 'Cl', position: [0.5, 0.5, 0.5] }
    ],
    bondThreshold: 0.51
  },
  {
    id: 'diamond',
    name: '金刚石',
    abbr: 'Dia',
    spaceGroup: 'Fd-3m',
    latticeConstant: 2.5,
    elements: { C: CARBON },
    basis: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'C', position: [0.5, 0.5, 0] },
      { element: 'C', position: [0.5, 0, 0.5] },
      { element: 'C', position: [0, 0.5, 0.5] },
      { element: 'C', position: [0.25, 0.25, 0.25] },
      { element: 'C', position: [0.75, 0.75, 0.25] },
      { element: 'C', position: [0.75, 0.25, 0.75] },
      { element: 'C', position: [0.25, 0.75, 0.75] }
    ],
    bondThreshold: 0.44
  }
];

function positionKey(p: [number, number, number]): string {
  const quantize = (v: number): number => Math.round(v / POS_EPS);
  return `${quantize(p[0])},${quantize(p[1])},${quantize(p[2])}`;
}

/**
 * 将晶胞基元按 range 展开为分数坐标原子。
 *
 * range = [m, n] 表示覆盖 [m, n+1] 的超胞区域（每轴 n-m+1 个晶胞）。
 * 迭代到 n+1 号晶胞并裁剪到上边界，使位于边界上的原子在相邻晶胞中的
 * 周期镜像只保留一份（去重），从而避免重复实例与多余键。
 */
export function expandUnitCell(
  def: UnitCellDef,
  range: CellRange = DEFAULT_RANGE
): CrystalAtom[] {
  const [min, max] = range;
  const upper = max + 1;
  const seen = new Set<string>();
  const atoms: CrystalAtom[] = [];

  for (let ix = min; ix <= max + 1; ix++) {
    for (let iy = min; iy <= max + 1; iy++) {
      for (let iz = min; iz <= max + 1; iz++) {
        for (const basisAtom of def.basis) {
          const px = basisAtom.position[0] + ix;
          const py = basisAtom.position[1] + iy;
          const pz = basisAtom.position[2] + iz;
          if (
            px < min - POS_EPS || px > upper + POS_EPS ||
            py < min - POS_EPS || py > upper + POS_EPS ||
            pz < min - POS_EPS || pz > upper + POS_EPS
          ) {
            continue;
          }
          const position: [number, number, number] = [px, py, pz];
          const key = positionKey(position);
          if (seen.has(key)) continue;
          seen.add(key);
          atoms.push({
            id: `${def.id}-${atoms.length}`,
            element: basisAtom.element,
            position
          });
        }
      }
    }
  }
  return atoms;
}

/**
 * 按距离阈值生成键（去重，无自连）。
 * 阈值以分数坐标表示，物理距离随晶格常数等比缩放。
 */
export function generateBonds(
  atoms: CrystalAtom[],
  bondThreshold: number
): CrystalBond[] {
  const bonds: CrystalBond[] = [];
  const limit = bondThreshold + POS_EPS;
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i].position;
      const b = atoms[j].position;
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      if (dx * dx + dy * dy + dz * dz <= limit * limit) {
        bonds.push({ atomA: atoms[i].id, atomB: atoms[j].id });
      }
    }
  }
  return bonds;
}

/** 完整推导链路：晶体定义 + 晶胞范围 + 晶格常数 -> 原子与键 */
export function buildCrystalStructure(
  def: UnitCellDef,
  range: CellRange = DEFAULT_RANGE,
  latticeConstant: number = def.latticeConstant
): CrystalStructure {
  const atoms = expandUnitCell(def, range);
  const bonds = generateBonds(atoms, def.bondThreshold);
  return {
    id: def.id,
    name: def.name,
    abbr: def.abbr,
    spaceGroup: def.spaceGroup,
    latticeConstant,
    range,
    elements: def.elements,
    atoms,
    bonds
  };
}

export function getCrystalDefById(id: string): UnitCellDef | undefined {
  return CRYSTAL_DEFS.find(c => c.id === id);
}

export function getCrystalById(
  id: string,
  range: CellRange = DEFAULT_RANGE
): CrystalStructure | undefined {
  const def = getCrystalDefById(id);
  return def ? buildCrystalStructure(def, range) : undefined;
}

/** 向后兼容：默认范围下各晶体的已展开结构 */
export const CRYSTALS: CrystalStructure[] = CRYSTAL_DEFS.map(def =>
  buildCrystalStructure(def, DEFAULT_RANGE)
);
