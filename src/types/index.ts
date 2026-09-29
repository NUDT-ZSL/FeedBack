export interface Attraction {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
}

export interface TripSpot {
  id: string;
  attractionId: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  arrivalTime: string;
  duration: number;
  dayIndex: number;
  order: number;
  isNew?: boolean;
}

export interface DaySchedule {
  dayIndex: number;
  spots: TripSpot[];
}

export interface Trip {
  id: string;
  name: string;
  days: number;
  schedules: DaySchedule[];
  shareCode?: string;
  createdAt: number;
}

export const DAY_COLORS = [
  '#FF6B6B',
  '#FFC857',
  '#4ECDC4',
  '#95E1D3',
  '#F38181',
  '#AA96DA',
  '#FCBAD3',
  '#A8E6CF',
  '#88D8B0',
  '#FFEAA7',
  '#74B9FF',
  '#A29BFE',
  '#FD79A8',
  '#E17055',
];

export const PRESET_ATTRACTIONS: Attraction[] = [
  {
    id: 'gugong',
    name: '故宫博物院',
    description: '明清两代皇家宫殿，世界文化遗产，中国古代宫廷建筑精华',
    lat: 39.9163,
    lng: 116.3972,
  },
  {
    id: 'xihu',
    name: '杭州西湖',
    description: '三面云山一面城，人间天堂，世界文化景观遗产',
    lat: 30.2587,
    lng: 120.1305,
  },
  {
    id: 'zhangjiajie',
    name: '张家界国家森林公园',
    description: '阿凡达取景地，奇峰异石，世界自然遗产',
    lat: 29.3247,
    lng: 110.4358,
  },
  {
    id: 'huangshan',
    name: '黄山风景区',
    description: '五岳归来不看山，黄山归来不看岳，奇松怪石云海温泉',
    lat: 30.1288,
    lng: 118.1684,
  },
  {
    id: 'jiuzhaigou',
    name: '九寨沟',
    description: '童话世界，翠海叠瀑彩林雪峰藏情，世界自然遗产',
    lat: 33.1647,
    lng: 103.9138,
  },
  {
    id: 'lijiang',
    name: '丽江古城',
    description: '纳西族古城，小桥流水人家，世界文化遗产',
    lat: 26.8721,
    lng: 100.2299,
  },
  {
    id: 'bingmayong',
    name: '秦始皇兵马俑',
    description: '世界第八大奇迹，古代地下军事博物馆',
    lat: 34.3845,
    lng: 109.279,
  },
  {
    id: 'shanghaita',
    name: '上海东方明珠',
    description: '上海地标建筑，现代都市天际线代表',
    lat: 31.2397,
    lng: 121.4998,
  },
  {
    id: 'xiamen',
    name: '厦门鼓浪屿',
    description: '海上花园，万国建筑博览，世界文化遗产',
    lat: 24.4496,
    lng: 118.0669,
  },
  {
    id: 'dali',
    name: '大理古城',
    description: '风花雪月，苍山洱海，白族文化发源地',
    lat: 25.6963,
    lng: 100.1677,
  },
  {
    id: 'sanya',
    name: '三亚亚龙湾',
    description: '天下第一湾，热带海滨度假胜地',
    lat: 18.2155,
    lng: 109.6391,
  },
  {
    id: 'guilin',
    name: '桂林漓江',
    description: '桂林山水甲天下，喀斯特地貌精华',
    lat: 25.2736,
    lng: 110.2908,
  },
];

export const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    TIME_OPTIONS.push(
      `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    );
  }
}

export const DURATION_OPTIONS: number[] = [];
for (let d = 0.5; d <= 8; d += 0.5) {
  DURATION_OPTIONS.push(d);
}

export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
