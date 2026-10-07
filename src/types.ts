export interface Planet {
  id: number;
  position: [number, number, number];
  color: string;
  ringType: 'ecliptic' | 'equator' | 'galactic';
  prediction: string;
  timestamp: number;
}

export interface StarRecord {
  id: string;
  thumbnail: string;
  timestamp: number;
  predictions: string[];
  planets: Planet[];
  starAngles: {
    ecliptic: number;
    equator: number;
    galactic: number;
  };
}

export interface StarAngles {
  ecliptic: number;
  equator: number;
  galactic: number;
}

export const RING_COLORS = {
  ecliptic: '#ffd700',
  equator: '#00bfff',
  galactic: '#ff4444'
} as const;

export const PREDICTIONS = [
  '紫气东来',
  '荧惑守心',
  '七星连珠',
  '月晕而风',
  '北斗指路',
  '玄武当空'
] as const;

export const ZODIAC_SIGNS = [
  { name: '白羊', symbol: '♈', interpretation: '阳气初生，万物复苏，宜开拓进取' },
  { name: '金牛', symbol: '♉', interpretation: '土德厚载，财富积聚，宜守正持重' },
  { name: '双子', symbol: '