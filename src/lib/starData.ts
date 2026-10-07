export interface Planet {
  name: string;
  color: string;
  orbitRadius: number;
  period: number;
  size: number;
}

export interface Constellation {
  name: string;
  position: [number, number, number];
}

export interface Trigram {
  name: string;
  symbol: string;
  color: string;
  position: number;
  direction: [number, number];
}

export const planets: Planet[] = [
  { name: '水星', color: '#e0e0e0', orbitRadius: 2.5, period: 5, size: 0.25 },
  { name: '金星', color: '#f5e6a3', orbitRadius: 3.2, period: 10, size: 0.3 },
  { name: '火星', color: '#cc3300', orbitRadius: 4.0, period: 15, size: 0.28 },
  { name: '木星', color: '#cc7722', orbitRadius: 4.8, period: 22, size: 0.4 },
  { name: '土星', color: '#cccc66', orbitRadius: 5.5, period: 30, size: 0.35 },
];

export const constellations: Constellation[] = [
  { name: '角宿', position: [6, 1.5, 0] },
  { name: '亢宿', position: [5.2, 3, 1] },
  { name: '氐宿', position: [3, 5.2, 1] },
  { name: '房宿', position: [0, 6, 1] },
  { name: '心宿', position: [-3, 5.2, 1] },
  { name: '尾宿', position: [-5.2, 3, 1] },
  { name: '箕宿', position: [-6, 0, 0] },
  { name: '斗宿', position: [-5.2, -3, 1] },
  { name: '牛宿', position: [-3, -5.2, 1] },
  { name: '女宿', position: [0, -6, 1] },
  { name: '虚宿', position: [3, -5.2, 1] },
  { name: '危宿', position: [5.2, -3, 1] },
  { name: '室宿', position: [6, -1.5, 0] },
  { name: '壁宿', position: [5.2, 1.5, -1] },
  { name: '奎宿', position: [3, 5.2, -1] },
  { name: '娄宿', position: [0, 6, -1] },
  { name: '胃宿', position: [-3, 5.2, -1] },
  { name: '昴宿', position: [-5.2, 3, -1] },
  { name: '毕宿', position: [-6, 0, -0] },
  { name: '觜宿', position: [-5.2, -3, -1] },
  { name: '参宿', position: [-3, -5.2, -1] },
  { name: '井宿', position: [0, -6, -1] },
  { name: '鬼宿', position: [3, -5.2, -1] },
  { name: '柳宿', position: [5.2, -3, -1] },
  { name: '星宿', position: [4.2, 4.2, 0] },
  { name: '张宿', position: [-4.2, 4.2, 0] },
  { name: '翼宿', position: [-4.2, -4.2, 0] },
  { name: '轸宿', position: [4.2, -4.2, 0] },
];

export const trigrams: Trigram[] = [
  { name: '乾', symbol: '☰', color: '#ff6666', position: 0, direction: [0, 1] },
  { name: '兑', symbol: '☱', color: '#cccc00', position: 1, direction: [0.707, 0.707] },
  { name: '离', symbol: '☲', color: '#ff3300', position: 2, direction: [1, 0] },
  { name: '震', symbol: '☳', color: '#00cc00', position: 3, direction: [0.707, -0.707] },
  { name: '巽', symbol: '☴', color: '#cc99ff', position: 4, direction: [0, -1] },
  { name: '坎', symbol: '☵', color: '#0066ff', position: 5, direction: [-0.707, -0.707] },
  { name: '艮', symbol: '☶', color: '#996633', position: 6, direction: [-1, 0] },
  { name: '坤', symbol: '☷', color: '#666600', position: 7, direction: [-0.707, 0.707] },
];

export const baguaMatchRules: Record<string, number> = {
  '乾': 0,
  '兑': 1,
  '离': 2,
  '震': 3,
  '巽': 4,
  '坎': 5,
  '艮': 6,
  '坤': 7,
};
