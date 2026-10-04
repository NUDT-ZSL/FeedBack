import {
  type BoardNode,
  type CircleElement,
  type GroupElement,
  type RectElement,
  type StickyNote,
} from '../../src/whiteboard/types.ts';

export function makeIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${(++counter).toString(36).padStart(4, '0')}`;
}

export function makeRect(id: string, overrides: Partial<RectElement> = {}): RectElement {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    color: '#4a9e8f',
    strokeWidth: 2,
    ...overrides,
  };
}

export function makeCircle(id: string, overrides: Partial<CircleElement> = {}): CircleElement {
  return {
    id,
    type: 'circle',
    x: 0,
    y: 0,
    radius: 20,
    color: '#4a9e8f',
    strokeWidth: 2,
    ...overrides,
  };
}

export function makeSticky(id: string, overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    text: '',
    color: '#f5d76e',
    width: 120,
    height: 100,
    ...overrides,
  };
}

export function makeGroup(id: string, overrides: Partial<GroupElement> = {}): GroupElement {
  return { id, type: 'group', x: 0, y: 0, ...overrides };
}

export function makeNode(id: string, type: BoardNode['type']): BoardNode {
  switch (type) {
    case 'rect':
      return makeRect(id);
    case 'circle':
      return makeCircle(id);
    case 'sticky':
      return makeSticky(id);
    case 'group':
      return makeGroup(id);
    case 'pen':
      return { id, type: 'pen', x: 0, y: 0, points: [0, 0, 10, 10], color: '#000000', strokeWidth: 1 };
  }
}
