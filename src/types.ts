/**
 * UI 层类型与部件视觉元数据。
 * 拆装逻辑的类型统一由 src/assembly/types.ts 定义，这里只做展示层补充。
 */
import type { PartId } from './assembly/types.ts';

export type { PartId, PartStatus, Operation } from './assembly/types.ts';

export interface PartVisual {
  /** 环半径（球体部件为球半径） */
  radius: number;
  tube: number;
  isSphere: boolean;
  rotation: [number, number, number];
  /** 分解架格子序号（8行3列，按拆装顺序排列） */
  rackIndex: number;
}

export const PART_VISUALS: Record<PartId, PartVisual> = {
  'liuhe-ziwu': { radius: 4.0, tube: 0.12, isSphere: false, rotation: [0, 0, 0], rackIndex: 0 },
  'liuhe-east': { radius: 3.7, tube: 0.11, isSphere: false, rotation: [0, Math.PI / 2, 0], rackIndex: 1 },
  'liuhe-west': { radius: 3.7, tube: 0.11, isSphere: false, rotation: [Math.PI / 2, 0, 0], rackIndex: 2 },
  'sanchen-chijing': { radius: 3.1, tube: 0.1, isSphere: false, rotation: [Math.PI / 6, 0, 0], rackIndex: 3 },
  'sanchen-huangjing': { radius: 3.1, tube: 0.1, isSphere: false, rotation: [0, Math.PI / 3, Math.PI / 2], rackIndex: 4 },
  'sanchen-globe': { radius: 1.6, tube: 0, isSphere: true, rotation: [0, 0, 0], rackIndex: 5 },
  'siyou-shuanghuan': { radius: 2.2, tube: 0.09, isSphere: false, rotation: [0, 0, Math.PI / 4], rackIndex: 6 },
};

/** 分解架格子世界坐标（右侧 8行3列 网格） */
export function rackPosition(index: number): [number, number, number] {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return [9 + col * 3, 5 - row * 3, 0];
}
