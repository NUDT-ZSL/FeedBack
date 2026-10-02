export type Element = '木' | '火' | '土' | '金' | '水';

export interface ElementRelation {
  generates: Element;
  overcomes: Element;
}

export const elementColors: Record<Element, string> = {
  木: '#228b22',
  火: '#dc143c',
  土: '#d2691e',
  金: '#ffd700',
  水: '#4169e1',
};

const generateRelations: Record<Element, Element> = {
  木: '火',
  火: '土',
  土: '金',
  金: '水',
  水: '木',
};

const overcomeRelations: Record<Element, Element> = {
  木: '土',
  土: '水',
  水: '火',
  火: '金',
  金: '木',
};

export function generateRelationMap(): Map<Element, ElementRelation> {
  const map = new Map<Element, ElementRelation>();
  const elements: Element[] = ['木', '火', '土', '金', '水'];

  elements.forEach((element) => {
    map.set(element, {
      generates: generateRelations[element],
      overcomes: overcomeRelations[element],
    });
  });

  return map;
}
