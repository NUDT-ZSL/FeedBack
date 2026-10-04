export type ElementKind =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'note'
  | 'image'
  | 'group';

export interface WhiteboardElement {
  id: string;
  kind: ElementKind;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
}

export interface BoardState {
  elements: Record<string, WhiteboardElement>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
}

export function emptyState(): BoardState {
  return { elements: {}, rootOrder: [], childOrder: {} };
}

export function createElement(
  init: Partial<WhiteboardElement> & { id: string },
): WhiteboardElement {
  return {
    kind: 'rect',
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#4a9e8f',
    stroke: '#2f2a24',
    strokeWidth: 1,
    text: '',
    ...init,
  };
}
