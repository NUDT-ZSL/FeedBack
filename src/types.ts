export type ProcessMethod = '日晒' | '水洗' | '蜜处理' | '厌氧';

export type RoastLevel = '浅' | '中浅' | '中' | '中深' | '深';

export type PourMethod = '一刀流' | '三段式' | '搅拌法' | '冰冲';

export interface CoffeeBean {
  id: string;
  name: string;
  origin: string;
  processMethod: ProcessMethod;
  roastLevel: RoastLevel;
  createdAt: number;
}

export interface FlavorProfile {
  acidity: number;
  sweetness: number;
  bitterness: number;
  body: number;
  aftertaste: number;
  cleanliness: number;
}

export interface BrewRecord {
  id: string;
  beanId: string;
  coffeeAmount: number;
  waterTemp: number;
  grindSize: number;
  pourMethod: PourMethod;
  totalTime: number;
  flavor: FlavorProfile;
  createdAt: number;
}

export type PageType = 'library' | 'records' | 'radar';

export interface AppState {
  beans: CoffeeBean[];
  records: BrewRecord[];
  currentPage: PageType;
  selectedBeanId: string | null;
}

export type AppAction =
  | { type: 'SET_PAGE'; payload: PageType }
  | { type: 'SELECT_BEAN'; payload: string | null }
  | { type: 'ADD_BEAN'; payload: CoffeeBean }
  | { type: 'ADD_RECORD'; payload: BrewRecord }
  | { type: 'LOAD_DATA'; payload: { beans: CoffeeBean[]; records: BrewRecord[] } };

export const FLAVOR_DIMENSIONS: { key: keyof FlavorProfile; label: string; color: string }[] = [
  { key: 'acidity', label: '酸度', color: '#FF8C00' },
  { key: 'sweetness', label: '甜度', color: '#FF69B4' },
  { key: 'bitterness', label: '苦味', color: '#4169E1' },
  { key: 'body', label: '醇厚度', color: '#9370DB' },
  { key: 'aftertaste', label: '回甘', color: '#32CD32' },
  { key: 'cleanliness', label: '干净度', color: '#00CED1' },
];

export const ROAST_COLORS: Record<RoastLevel, { start: string; end: string }> = {
  '浅': { start: '#FFF8DC', end: '#F5DEB3' },
  '中浅': { start: '#F5DEB3', end: '#DEB887' },
  '中': { start: '#DEB887', end: '#D2B48C' },
  '中深': { start: '#D2B48C', end: '#A0522D' },
  '深': { start: '#A0522D', end: '#8B4513' },
};

const generateId = () => Math.random().toString(36).substring(2, 11);

const randomFlavor = (): FlavorProfile => ({
  acidity: Math.floor(Math.random() * 5) + 5,
  sweetness: Math.floor(Math.random() * 5) + 5,
  bitterness: Math.floor(Math.random() * 5) + 4,
  body: Math.floor(Math.random() * 5) + 5,
  aftertaste: Math.floor(Math.random() * 5) + 5,
  cleanliness: Math.floor(Math.random() * 5) + 5,
});

export const generateMockData = (): { beans: CoffeeBean[]; records: BrewRecord[] } => {
  const beans: CoffeeBean[] = [
    {
      id: generateId(),
      name: '耶加雪菲',
      origin: '埃塞俄比亚',
      processMethod: '水洗',
      roastLevel: '浅',
      createdAt: Date.now() - 86400000 * 10,
    },
    {
      id: generateId(),
      name: '曼特宁',
      origin: '印度尼西亚',
      processMethod: '日晒',
      roastLevel: '中深',
      createdAt: Date.now() - 86400000 * 8,
    },
    {
      id: generateId(),
      name: '瑰夏',
      origin: '巴拿马',
      processMethod: '蜜处理',
      roastLevel: '中浅',
      createdAt: Date.now() - 86400000 * 5,
    },
    {
      id: generateId(),
      name: '云南小粒',
      origin: '中国云南',
      processMethod: '厌氧',
      roastLevel: '中',
      createdAt: Date.now() - 86400000 * 3,
    },
  ];

  const records: BrewRecord[] = [];
  const pourMethods: PourMethod[] = ['一刀流', '三段式', '搅拌法', '冰冲'];

  beans.forEach((bean, beanIndex) => {
    const recordCount = beanIndex === 0 ? 3 : 2;
    for (let i = 0; i < recordCount; i++) {
      records.push({
        id: generateId(),
        beanId: bean.id,
        coffeeAmount: Math.floor(Math.random() * 10) + 15,
        waterTemp: Math.floor(Math.random() * 10) + 88,
        grindSize: Math.floor(Math.random() * 5) + 3,
        pourMethod: pourMethods[Math.floor(Math.random() * pourMethods.length)],
        totalTime: Math.floor(Math.random() * 90) + 90,
        flavor: randomFlavor(),
        createdAt: Date.now() - 86400000 * (beanIndex * 3 + i),
      });
    }
  });

  return { beans, records };
};

export const calculateAverageScore = (flavor: FlavorProfile): number => {
  const values = Object.values(flavor);
  return values.reduce((sum, val) => sum + val, 0) / values.length;
};

export const getScoreColor = (score: number): string => {
  const normalized = (score - 1) / 9;
  const r = Math.round(255 * (1 - normalized));
  const g = Math.round(255 * normalized);
  return `rgb(${r}, ${g}, 50)`;
};
