export type FanSurfaceShape = 'round' | 'fan';
export type FanSurfaceStatus = 'draft' | 'completed' | 'assembled';
export type OrderStatus = 'pending' | 'in_progress' | 'completed' | 'shipped';
export type BrushType = 'fine' | 'splash' | 'dot' | 'row';

export interface Point {
  x: number;
  y: number;
}

export interface BrushStroke {
  id: string;
  points: Point[];
  brushType: BrushType;
  color: string;
  size: number;
  opacity: number;
}

export interface OverlayPattern {
  id: string;
  name: string;
  category: 'landscape' | 'bird' | 'figure';
  svgData: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface FanSurface {
  id: string;
  shape: FanSurfaceShape;
  patternData: string;
  strokes: BrushStroke[];
  overlays: OverlayPattern[];
  status: FanSurfaceStatus;
  createdAt: Date;
}

export interface FanRib {
  id: string;
  number: number;
  material: string;
  color: string;
  inStock: boolean;
  used: boolean;
  quantity: number;
}

export interface Order {
  id: string;
  orderNo: string;
  customerName: string;
  fanSurfaceId: string;
  fanRibIds: string[];
  status: OrderStatus;
  thumbnail: string;
  submittedAt: Date;
  updatedAt: Date;
}

export interface Inventory {
  id: string;
  fanRibId: string;
  quantity: number;
  lastUpdated: Date;
}

export const COLORS = {
  wood: '#6b4e3a',
  cream: '#f5e6d3',
  gray: '#9a8a7a',
  gold: '#e8c76a',
  goldDark: '#d4a017',
  bamboo: '#a67c52',
  cinnabar: '#c0392b',
  azurite: '#3a6b8a',
  malachite: '#4a7c59',
  gamboge: '#d4a017',
  ochre: '#8b6f47',
  ink: '#1a1a1a',
} as const;

export const BRUSH_TYPES: { type: BrushType; name: string; icon: string }[] = [
  { type: 'fine', name: '细线', icon: 'fa-pencil' },
  { type: 'splash', name: '泼墨', icon: 'fa-tint' },
  { type: 'dot', name: '点染', icon: 'fa-circle' },
  { type: 'row', name: '排笔', icon: 'fa-brush' },
];

export const MINERAL_COLORS: { name: string; value: string }[] = [
  { name: '朱砂', value: COLORS.cinnabar },
  { name: '石青', value: COLORS.azurite },
  { name: '石绿', value: COLORS.malachite },
  { name: '藤黄', value: COLORS.gamboge },
  { name: '赭石', value: COLORS.ochre },
  { name: '墨黑', value: COLORS.ink },
];
