/**
 * 界面层类型：部件的三维外观与展示状态。
 * 拆装顺序、依赖、进度结论等业务口径一律来自 src/assembly/ 状态机，此处只描述外观。
 */
import type { MountState, PartId } from './assembly/types.ts';

export type { MountState, PartId };

/** 部件展示状态（信息面板三态） */
export enum DisplayStatus {
  NotRemoved = '未拆',
  Removed = '已拆',
  Assembled = '已组装',
}

export function toDisplayStatus(state: MountState): DisplayStatus {
  switch (state) {
    case 'installed':
      return DisplayStatus.NotRemoved;
    case 'removed':
      return DisplayStatus.Removed;
    case 'assembled':
      return DisplayStatus.Assembled;
  }
}

export const STATUS_COLORS: Record<MountState, string> = {
  installed: '#888888',
  removed: '#e67e22',
  assembled: '#27ae60',
};

/** 部件三维外观定义 */
export interface PartVisual {
  id: PartId;
  kind: 'ring' | 'sphere';
  /** 环半径 / 球半径 */
  radius: number;
  /** 环管径 */
  tube?: number;
  /** 初始姿态（欧拉角） */
  rotation: [number, number, number];
  /** 拆下后悬浮位置（半径约 10 单位的外圈） */
  removedPosition: [number, number, number];
  color: string;
}

const BRONZE = '#8b5e3c';

/** 与 src/assembly/parts.ts 中七个部件一一对应的外观参数 */
export const PART_VISUALS: PartVisual[] = [
  {
    id: 'liuhe_outer',
    kind: 'ring',
    radius: 4,
    tube: 0.12,
    rotation: [0, 0, 0],
    removedPosition: [10, 3, 0],
    color: BRONZE,
  },
  {
    id: 'liuhe_inner_east',
    kind: 'ring',
    radius: 3.6,
    tube: 0.1,
    rotation: [Math.PI / 2, 0, 0],
    removedPosition: [7, 4.5, 7],
    color: BRONZE,
  },
  {
    id: 'liuhe_inner_west',
    kind: 'ring',
    radius: 3.6,
    tube: 0.1,
    rotation: [Math.PI / 2, Math.PI / 3, 0],
    removedPosition: [0, 5, 10],
    color: BRONZE,
  },
  {
    id: 'sanchen_mid_a',
    kind: 'ring',
    radius: 3.1,
    tube: 0.09,
    rotation: [Math.PI / 2, -Math.PI / 4, 0],
    removedPosition: [-7, 4.5, 7],
    color: BRONZE,
  },
  {
    id: 'sanchen_mid_b',
    kind: 'ring',
    radius: 2.9,
    tube: 0.09,
    rotation: [Math.PI / 3, 0, Math.PI / 5],
    removedPosition: [-10, 3, 0],
    color: BRONZE,
  },
  {
    id: 'sanchen_core',
    kind: 'sphere',
    radius: 2,
    rotation: [0, 0, 0],
    removedPosition: [-7, 4, -7],
    color: '#a0744a',
  },
  {
    id: 'siyou_double',
    kind: 'ring',
    radius: 2.4,
    tube: 0.08,
    rotation: [0, Math.PI / 4, Math.PI / 2],
    removedPosition: [7, 4, -7],
    color: BRONZE,
  },
];
