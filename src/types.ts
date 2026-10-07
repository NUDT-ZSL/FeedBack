export interface Skeleton {
  id: string;
  name: {
    zh: string;
    en: string;
  };
  pathD: string[];
  viewBox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface SilkColor {
  id: string;
  name: {
    zh: string;
    en: string;
  };
  hex: string;
  opacity: number;
}

export interface PaintColor {
  id: string;
  name: {
    zh: string;
    en: string;
  };
  hex: string;
}

export interface BrushStroke {
  points: { x: number; y: number }[];
  color: string;
  radius: number;
}

export interface Line {
  start: { x: number; y: number };
  end: { x: number; y: number };
  color: string;
  radius: number;
}

export interface Lantern {
  id: string;
  skeleton: string;
  silkColor: string;
  strokes: BrushStroke[];
  lines: Line[];
  isLit: boolean;
  createdAt: number;
  randomId: string;
}

export const SKELETONS: Skeleton[] = [
  {
    id: 'rabbit',
    name: { zh: '兔子灯', en: 'Rabbit Lantern' },
    pathD: [
      'M200,120 arc80,80 0 1,0 160,0 arc80,80 0 1,0 -160,0',
      'M160,80 q-20,-60 -40,-20 q-15,30 20,40',
      'M280,80 q20,-60 40,-20 q15,30 -20,40',
      'M180,130 arc10,10 0 1,0 20,0 arc10,10 0 1,0 -20,0',
      'M240,130 arc10,10 0 1,0 20,0 arc10,10 0 1,0 -20,0',
      'M210,160 q10,10 20,0',
      'M200,200 q-20,30 0,50 q20,-20 0,-50',
      'M240,200 q20,30 0,50 q-20,-20 0,-50',
    ],
    viewBox: { x: 100, y: 0, w: 280, h: 280 },
  },
  {
    id: 'lotus',
    name: { zh: '莲花灯', en: 'Lotus Lantern' },
    pathD: [
      'M200,60 q-80,40 -80,100 q0,60 80,80 q80,-20 80,-80 q0,-60 -80,-100',
      'M200,100 q-60,30 -60,70 q0,40 60,50 q60,-10 60,-50 q0,-40 -60,-70',
      'M200,140 q-40,20 -40,40 q0,20 40,25 q40,-5 40,-25 q0,-20 -40,-40',
      'M200,180 arc20,20 0 1,0 0.1,0',
      'M120,100 q20,20 40,10',
      'M280,100 q-20,20 -40,10',
      'M100,140 q30,10 50,0',
      'M300,140 q-30,10 -50,0',
      'M110,200 q35,-5 55,-15',
      'M290,200 q-35,-5 -55,-15',
    ],
    viewBox: { x: 80, y: 40, w: 240, h: 220 },
  },
  {
    id: 'palace',
    name: { zh: '宫灯', en: 'Palace Lantern' },
    pathD: [
      'M140,80 L260,80 L280,100 L280,220 L260,240 L140,240 L120,220 L120,100 L140,80',
      'M130,100 L270,100',
      'M130,140 L270,140',
      'M130,180 L270,180',
      'M130,220 L270,220',
      'M140,90 L140,230',
      'M200,80 L200,240',
      'M260,90 L260,230',
      'M160,60 L160,80 L240,80 L240,60',
      'M160,240 L160,260 L240,260 L240,240',
      'M150,70 L250,70',
      'M150,250 L250,250',
    ],
    viewBox: { x: 100, y: 40, w: 200, h: 240 },
  },
];

export const SILK_COLORS: SilkColor[] = [
  {
    id: 'peach',
    name: { zh: '桃红', en: 'Peach Blossom' },
    hex: '#ff99cc',
    opacity: 0.7,
  },
  {
    id: 'bamboo',
    name: { zh: '竹青', en: 'Bamboo Green' },
    hex: '#7bc67e',
    opacity: 0.7,
  },
  {
    id: 'moon',
    name: { zh: '月白', en: 'Moon White' },
    hex: '#d6e8f0',
    opacity: 0.7,
  },
  {
    id: 'goose',
    name: { zh: '鹅黄', en: 'Goose Yellow' },
    hex: '#fff3a0',
    opacity: 0.7,
  },
  {
    id: 'lotusRoot',
    name: { zh: '藕荷', en: 'Lotus Root' },
    hex: '#e0b0ff',
    opacity: 0.7,
  },
  {
    id: 'lake',
    name: { zh: '湖蓝', en: 'Lake Blue' },
    hex: '#7ec8e3',
    opacity: 0.7,
  },
];

export const PAINT_COLORS: PaintColor[] = [
  {
    id: 'cinnabar',
    name: { zh: '朱砂', en: 'Cinnabar' },
    hex: '#c04040',
  },
  {
    id: 'stoneGreen',
    name: { zh: '石绿', en: 'Stone Green' },
    hex: '#2e8b57',
  },
  {
    id: 'rouge',
    name: { zh: '胭脂', en: 'Rouge' },
    hex: '#b3446c',
  },
  {
    id: 'vineYellow',
    name: { zh: '藤黄', en: 'Vine Yellow' },
    hex: '#ffd700',
  },
  {
    id: 'cyan',
    name: { zh: '花青', en: 'Cyan' },
    hex: '#2a52be',
  },
  {
    id: 'ochre',
    name: { zh: '赭石', en: 'Ochre' },
    hex: '#8b4513',
  },
  {
    id: 'azure',
    name: { zh: '石青', en: 'Azure' },
    hex: '#1e90ff',
  },
  {
    id: 'peony',
    name: { zh: '牡丹红', en: 'Peony Red' },
    hex: '#ff6b6b',
  },
  {
    id: 'inkBlack',
    name: { zh: '墨黑', en: 'Ink Black' },
    hex: '#1a1a1a',
  },
  {
    id: 'ivoryWhite',
    name: { zh: '象牙白', en: 'Ivory White' },
    hex: '#fffff0',
  },
];
