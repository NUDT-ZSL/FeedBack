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

export interface BasisAtom {
  element: string;
  position: [number, number, number];
}

/**
 * 晶胞范围：[minCell, maxCell] 闭区间的整数晶胞索引，
 * 展开后的全局分数坐标盒为 [minCell, maxCell + 1]^3。
 * [0, 0] 表示单个常规晶胞（包含边界上的顶点/面心）。
 */
export type CellRange = [number, number];

export interface CrystalDefinition {
  id: string;
  name: string;
  abbr: string;
  spaceGroup: string;
  /** 默认晶格常数（埃） */
  latticeConstant: number;
  /**
   * 键长阈值，以晶格常数的倍数表示（分数坐标单位）。
   * 实际判定阈值 = bondThreshold * latticeConstant（埃），
   * 因此调整晶格常数时键连接关系保持不变。
   */
  bondThreshold: number;
  elements: Record<string, AtomElement>;
  /** 单个晶胞内的基元原子，分数坐标位于 [0, 1) */
  basis: BasisAtom[];
}

export interface CrystalStructure {
  id: string;
  name: string;
  abbr: string;
  spaceGroup: string;
  /** 当前结构使用的晶格常数（埃） */
  latticeConstant: number;
  bondThreshold: number;
  cellRange: CellRange;
  elements: Record<string, AtomElement>;
  /** 由定义 + 晶胞范围推导得到的展开原子（分数坐标） */
  atoms: CrystalAtom[];
  /** 由展开原子推导得到的化学键 */
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

const FCC_SITES: [number, number, number][] = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5]
];

const DIAMOND_SHIFTED_SITES: [number, number, number][] = [
  [0.25, 0.25, 0.25],
  [0.75, 0.75, 0.25],
  [0.75, 0.25, 0.75],
  [0.25, 0.75, 0.75]
];

export const CRYSTAL_DEFINITIONS: CrystalDefinition[] = [
  {
    id: 'sc',
    name: '简单立方',
    abbr: 'SC',
    spaceGroup: 'Pm-3m',
    latticeConstant: 2.5,
    bondThreshold: 1.0,
    elements: { metal: METAL },
    basis: [{ element: 'metal', position: [0, 0, 0] }]
  },

  {
    id: 'bcc',
    name: '体心立方',
    abbr: 'BCC',
    spaceGroup: 'Im-3m',
    latticeConstant: 2.5,
    bondThreshold: Math.sqrt(3) / 2 + 0.004,
    elements: { metal: METAL },
    basis: [
      { element: 'metal', position: [0, 0, 0] },
      { element: 'metal', position: [0.5, 0.5, 0.5] }
    ]
  },

  {
    id: 'fcc',
    name: '面心立方',
    abbr: 'FCC',
    spaceGroup: 'Fm-3m',
    latticeConstant: 2.5,
    bondThreshold: Math.sqrt(2) / 2 + 0.004,
    elements: { metal: METAL },
    basis: FCC_SITES.map(position => ({ element: 'metal', position }))
  },

  {
    id: 'nacl',
    name: '氯化钠',
    abbr: 'NaCl',
    spaceGroup: 'Fm-3m',
    latticeConstant: 2.5,
    bondThreshold: 0.5 + 0.004,
    elements: { Na: SODIUM, Cl: CHLORINE },
    basis: [
      ...FCC_SITES.map(position => ({ element: 'Na', position })),
      ...FCC_SITES.map(position => ({
        element: 'Cl',
        position: [
          position[0] + 0.5,
          position[1] + 0.5,
          position[2] + 0.5
        ] as [number, number, number]
      }))
    ]
  },

  {
    id: 'diamond',
    name: '金刚石',
    abbr: 'Dia',
    spaceGroup: 'Fd-3m',
    latticeConstant: 2.5,
    bondThreshold: Math.sqrt(3) / 4 + 0.004,
    elements: { C: CARBON },
    basis: [
      ...FCC_SITES.map(position => ({ element: 'C', position })),
      ...DIAMOND_SHIFTED_SITES.map(position => ({ element: 'C', position }))
    ]
  }
];

export const DEFAULT_CELL_RANGE: CellRange = [0, 0];
const POSITION_EPSILON = 1e-6;

/**
 * 将分数坐标归一化到 [0, 1)，使位于晶胞边界（坐标恰为 1）上的原子
 * 等价于相邻晶胞坐标 0 处的原子。
 */
function normalizeFractional(value: number): number {
  let normalized = value - Math.floor(value);
  if (normalized >= 1 - POSITION_EPSILON) normalized = 0;
  return normalized;
}

function quantizeCoordinate(value: number): number {
  return Math.round(value / POSITION_EPSILON) * POSITION_EPSILON;
}

function positionKey(position: [number, number, number]): string {
  return position.map(v => quantizeCoordinate(v).toFixed(4)).join(',');
}

/**
 * 按晶胞范围展开基元原子。
 *
 * 边界处理：基元坐标先归一化到 [0, 1)，再叠加整数晶胞偏移；位于晶胞
 * 边界上的原子（如简单立方顶点）即使由相邻晶胞重复生成，也会通过全局
 * 坐标去重保证只产出一个实例，不会产生重复原子或多余的键端点。
 */
export function expandUnitCell(
  basis: BasisAtom[],
  range: CellRange = DEFAULT_CELL_RANGE
): CrystalAtom[] {
  const [minCell, maxCell] = range;
  if (!Number.isInteger(minCell) || !Number.isInteger(maxCell) || minCell > maxCell) {
    throw new Error(`无效的晶胞范围: [${minCell}, ${maxCell}]`);
  }

  const boxMin = minCell;
  const boxMax = maxCell + 1;
  const normalized = basis.map(atom => ({
    element: atom.element,
    position: atom.position.map(normalizeFractional) as [number, number, number]
  }));

  const expanded: CrystalAtom[] = [];
  const seen = new Set<string>();

  for (let ix = minCell; ix <= maxCell + 1; ix++) {
    for (let iy = minCell; iy <= maxCell + 1; iy++) {
      for (let iz = minCell; iz <= maxCell + 1; iz++) {
        for (const atom of normalized) {
          const position: [number, number, number] = [
            atom.position[0] + ix,
            atom.position[1] + iy,
            atom.position[2] + iz
          ];

          const outside =
            position.some(v => v < boxMin - POSITION_EPSILON || v > boxMax + POSITION_EPSILON);
          if (outside) continue;

          const key = positionKey(position);
          if (seen.has(key)) continue;
          seen.add(key);

          expanded.push({
            id: `${atom.element}@${key}`,
            element: atom.element,
            position
          });
        }
      }
    }
  }

  return expanded;
}

/**
 * 基于最近邻距离阈值生成化学键。
 *
 * 距离与阈值都在埃空间计算：分数坐标差 × latticeConstant，
 * 阈值 = bondThreshold × latticeConstant，两者随晶格常数同比缩放，
 * 调整晶格常数不会改变键的连接关系。
 */
export function generateBonds(
  atoms: CrystalAtom[],
  bondThreshold: number,
  latticeConstant: number
): CrystalBond[] {
  const maxDistance = bondThreshold * latticeConstant;
  const bonds: CrystalBond[] = [];
  const pairKeys = new Set<string>();

  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i].position;
      const b = atoms[j].position;
      const dx = (a[0] - b[0]) * latticeConstant;
      const dy = (a[1] - b[1]) * latticeConstant;
      const dz = (a[2] - b[2]) * latticeConstant;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance <= maxDistance + POSITION_EPSILON) {
        const pairKey = i < j ? `${atoms[i].id}|${atoms[j].id}` : `${atoms[j].id}|${atoms[i].id}`;
        if (pairKeys.has(pairKey)) continue;
        pairKeys.add(pairKey);
        bonds.push({ atomA: atoms[i].id, atomB: atoms[j].id });
      }
    }
  }

  return bonds;
}

/**
 * 数据派生链路的统一入口：晶体定义 + 晶胞范围 + 晶格常数 →
 * 展开原子坐标与化学键连接。
 */
export function buildCrystalStructure(
  definition: CrystalDefinition,
  range: CellRange = DEFAULT_CELL_RANGE,
  latticeConstant: number = definition.latticeConstant
): CrystalStructure {
  const atoms = expandUnitCell(definition.basis, range);
  const bonds = generateBonds(atoms, definition.bondThreshold, latticeConstant);

  return {
    id: definition.id,
    name: definition.name,
    abbr: definition.abbr,
    spaceGroup: definition.spaceGroup,
    latticeConstant,
    bondThreshold: definition.bondThreshold,
    cellRange: range,
    elements: definition.elements,
    atoms,
    bonds
  };
}

export const CRYSTALS: CrystalStructure[] = CRYSTAL_DEFINITIONS.map(definition =>
  buildCrystalStructure(definition)
);

export function getCrystalById(id: string): CrystalStructure | undefined {
  return CRYSTALS.find(c => c.id === id);
}

export function getCrystalDefinitionById(id: string): CrystalDefinition | undefined {
  return CRYSTAL_DEFINITIONS.find(c => c.id === id);
}
