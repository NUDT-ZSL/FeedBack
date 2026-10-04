export type ElementType = 'pen' | 'rect' | 'circle' | 'sticky' | 'group';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
}

export interface PenLine extends BaseElement {
  type: 'pen';
  points: number[];
  color: string;
  strokeWidth: number;
}

export interface RectElement extends BaseElement {
  type: 'rect';
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  radius: number;
  color: string;
  strokeWidth: number;
}

export interface StickyNote extends BaseElement {
  type: 'sticky';
  text: string;
  color: string;
  width: number;
  height: number;
}

export interface GroupElement extends BaseElement {
  type: 'group';
  name?: string;
}

export type DrawElement = PenLine | RectElement | CircleElement | StickyNote;
export type BoardNode = DrawElement | GroupElement;

export const ROOT_ID = 'root';

export interface BoardState {
  nodes: Record<string, BoardNode>;
  children: Record<string, string[]>;
  parent: Record<string, string>;
}
