import type { CrystalStructure, CellRange } from './crystal';

export interface AtomInstance {
  id: string;
  element: string;
  /** 归一化世界坐标（结构居中于原点，最长边映射到 [-1,1]） */
  position: [number, number, number];
  /** 球体半径（未乘晶格缩放，晶格缩放由场景统一施加） */
  radius: number;
  color: string;
}

export interface BondInstance {
  atomA: string;
  atomB: string;
  start: [number, number, number];
  end: [number, number, number];
  /** 分数坐标距离（物理长度 = 距离 × 晶格常数） */
  length: number;
}

export interface RenderPlan {
  atoms: AtomInstance[];
  bonds: BondInstance[];
}

/** 原子球半径换算系数（与渲染层约定的视觉比例） */
export const ATOM_RADIUS_FACTOR = 0.3;

export function getCellTransform(range: CellRange): { center: number; size: number } {
  const [min, max] = range;
  return {
    center: (min + max + 1) / 2,
    size: max + 1 - min
  };
}

export function fractionalToWorld(
  position: [number, number, number],
  range: CellRange
): [number, number, number] {
  const { center, size } = getCellTransform(range);
  const scale = 2 / size;
  return [
    (position[0] - center) * scale,
    (position[1] - center) * scale,
    (position[2] - center) * scale
  ];
}

/**
 * 由结构数据推导渲染实例：原子球与键杆完全来自同一份
 * CrystalStructure，渲染层不再自行维护坐标或半径状态。
 */
export function planRenderInstances(
  structure: CrystalStructure,
  atomRadiusScale: number
): RenderPlan {
  const atoms: AtomInstance[] = structure.atoms.map(atom => {
    const elem = structure.elements[atom.element];
    return {
      id: atom.id,
      element: atom.element,
      position: fractionalToWorld(atom.position, structure.range),
      radius: (elem ? elem.radius : 0.5) * atomRadiusScale * ATOM_RADIUS_FACTOR,
      color: elem ? elem.color : '#a9a9a9'
    };
  });

  const positionById = new Map(atoms.map(a => [a.id, a.position]));
  const bonds: BondInstance[] = [];
  for (const bond of structure.bonds) {
    const start = positionById.get(bond.atomA);
    const end = positionById.get(bond.atomB);
    if (!start || !end) continue;
    const dx = start[0] - end[0];
    const dy = start[1] - end[1];
    const dz = start[2] - end[2];
    bonds.push({
      atomA: bond.atomA,
      atomB: bond.atomB,
      start,
      end,
      length: Math.sqrt(dx * dx + dy * dy + dz * dz)
    });
  }

  return { atoms, bonds };
}
