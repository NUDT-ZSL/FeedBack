import type { WhiteboardElement } from './types.ts';

export type ElementPatch = Partial<
  Pick<
    WhiteboardElement,
    | 'x'
    | 'y'
    | 'width'
    | 'height'
    | 'rotation'
    | 'fill'
    | 'stroke'
    | 'strokeWidth'
    | 'text'
  >
>;

export interface Placement {
  id: string;
  parentId: string | null;
  index: number;
}

export type Op =
  | { type: 'add'; element: WhiteboardElement; index?: number }
  | { type: 'update'; id: string; patch: ElementPatch }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; id: string; toIndex: number }
  | { type: 'move'; id: string; newParentId: string | null; toIndex?: number }
  | { type: 'group'; ids: string[]; groupId: string }
  | { type: 'ungroup'; groupId: string }
  | { type: 'restore'; elements: WhiteboardElement[]; placements: Placement[] };
