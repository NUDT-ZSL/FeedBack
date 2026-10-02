export interface Trigram {
  name: string;
  direction: string;
  angle: number;
  color: string;
  element: string;
  symbol: string;
}

export const trigramDirections: Trigram[] = [
  { name: '乾', direction: '西北', angle: 315, color: '#b8860b', element: '金', symbol: '⚔' },
  { name: '坤', direction: '西南', angle: 225, color: '#8b7355', element: '土', symbol: '🟫' },
  { name: '震', direction: '东', angle: 90, color: '#228b22', element: '木', symbol: '🌳' },
  { name: '巽', direction: '东南', angle: 135, color: '#90ee90', element: '木', symbol: '🌿' },
  { name: '坎', direction: '北', angle: 0, color: '#4169e1', element: '水', symbol: '💧' },
  { name: '离', direction: '南', angle: 180, color: '#dc143c', element: '火', symbol: '🔥' },
  { name: '艮', direction: '东北', angle: 45, color: '#d2691e', element: '土', symbol: '⛰' },
  { name: '兑', direction: '西', angle: 270, color: '#ffd700', element: '金', symbol: '🔮' },
];

export const trigramMap = new Map<string, Trigram>(
  trigramDirections.map((t) => [t.name, t])
);
