import type { CellRange, CrystalStructure } from './crystal.ts';

/** 一个晶胞在场景中占据的边长（场景单位） */
export const SCENE_UNITS_PER_CELL = 2;
/** 原子半径 = 元素半径 × 半径比例 × 该系数 */
export const ATOM_RADIUS_FACTOR = 0.3;
/** 键杆圆柱半径（场景单位） */
export const BOND_RADIUS = 0.02;

export interface RenderParams {
  atomRadiusScale: number;
}

export interface AtomInstance {
  id: string;
  element: string;
  color: string;
  /** 场景坐标（已按晶胞盒中心对中） */
  position: [number, number, number];
  /** 渲染半径（场景单位） */
  radius: number;
}

export interface BondInstance {
  atomA: string;
  atomB: string;
  start: [number, number, number];
  end: [number, number, number];
  /** 键长（场景单位） */
  length: number;
  radius: number;
}

export interface RenderInstances {
  atoms: AtomInstance[];
  bonds: BondInstance[];
}

/** 晶胞盒中心（分数坐标），渲染时以它为场景原点 */
export function getCellCenter(range: CellRange): [number, number, number] {
  const center = (range[0] + range[1] + 1) / 2;
  return [center, center, center];
}

/**
 * 渲染实例派生入口：晶体结构 + 渲染参数 → 原子/键渲染实例。
 * 场景层与离线验证共用同一份推导逻辑，保证实例数量与位置一致。
 */
export function buildRenderInstances(
  structure: CrystalStructure,
  params: RenderParams
): RenderInstances {
  const center = getCellCenter(structure.cellRange);

  const toScene = (position: [number, number, number]): [number, number, number] => [
    (position[0] - center[0]) * SCENE_UNITS_PER_CELL,
    (position[1] - center[1]) * SCENE_UNITS_PER_CELL,
    (position[2] - center[2]) * SCENE_UNITS_PER_CELL
  ];

  const atoms: AtomInstance[] = structure.atoms.map(atom => {
    const element = structure.elements[atom.element];
    return {
      id: atom.id,
      element: atom.element,
      color: element.color,
      position: toScene(atom.position),
      radius: element.radius * params.atomRadiusScale * ATOM_RADIUS_FACTOR
    };
  });

  const scenePositionById = new Map(atoms.map(atom => [atom.id, atom.position]));
  const bonds: BondInstance[] = [];

  for (const bond of structure.bonds) {
    const start = scenePositionById.get(bond.atomA);
    const end = scenePositionById.get(bond.atomB);
    if (!start || !end) continue;

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];

    bonds.push({
      atomA: bond.atomA,
      atomB: bond.atomB,
      start,
      end,
      length: Math.sqrt(dx * dx + dy * dy + dz * dz),
      radius: BOND_RADIUS
    });
  }

  return { atoms, bonds };
}
