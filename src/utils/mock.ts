import type { Goods, ForeignTrader, Transaction } from '../types';

export const initialGoods: Goods[] = [
  {
    id: '1',
    name: '胡椒',
    emoji: '🌶️',
    stock: 15,
    defaultStock: 10,
    price: 120,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '2',
    name: '肉桂',
    emoji: '🪵',
    stock: 20,
    defaultStock: 10,
    price: 80,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '3',
    name: '蓝宝石',
    emoji: '💎',
    stock: 8,
    defaultStock: 10,
    price: 5000,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '4',
    name: '红宝石',
    emoji: '❤️',
    stock: 5,
    defaultStock: 10,
    price: 8000,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '5',
    name: '丝绸',
    emoji: '🧣',
    stock: 25,
    defaultStock: 10,
    price: 1500,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '6',
    name: '香料',
    emoji: '✨',
    stock: 18,
    defaultStock: 10,
    price: 200,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '7',
    name: '琉璃杯',
    emoji: '🍷',
    stock: 12,
    defaultStock: 10,
    price: 3000,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '8',
    name: '羚羊角',
    emoji: '🦌',
    stock: 6,
    defaultStock: 10,
    price: 600,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '9',
    name: '象牙',
    emoji: '🐘',
    stock: 3,
    defaultStock: 10,
    price: 10000,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '10',
    name: '珊瑚',
    emoji: '🪸',
    stock: 10,
    defaultStock: 10,
    price: 2500,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '11',
    name: '沉香',
    emoji: '🪔',
    stock: 7,
    defaultStock: 10,
    price: 3500,
    purchaseRecords: [],
    saleRecords: []
  },
  {
    id: '12',
    name: '翡翠',
    emoji: '💚',
    stock: 4,
    defaultStock: 10,
    price: 15000,
    purchaseRecords: [],
    saleRecords: []
  }
];

const traderNames = ['阿里', '哈桑', '易卜拉欣', '穆萨', '萨利赫', '阿巴斯', '马哈茂德', '优素福', '奥马尔', '艾哈迈德'];
const traderOrigins = ['大食', '回鹘', '波斯', '天竺', '昆仑', '倭马亚', '阿拔斯', '吐蕃'];
const skinColors = ['#d4a574', '#c68642', '#8d5524', '#e0ac69', '#f1c27d'];
const clothingColors = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#7b2cbf'];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateForeignTrader(): ForeignTrader {
  return {
    id: `trader-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: randomItem(traderNames),
    origin: randomItem(traderOrigins),
    skinColor: randomItem(skinColors),
    clothingColor: randomItem(clothingColors)
  };
}

export function generateInitialOffer(originalPrice: number): number {
  const discount = 0.2 + Math.random() * 0.3;
  return Math.round(originalPrice * (1 - discount));
}

export function generateCounterOffer(userOffer: number, previousOffer: number): number {
  const adjustment = 0.05 + Math.random() * 0.1;
  const direction = userOffer > previousOffer ? 1 : -1;
  const baseValue = (userOffer + previousOffer) / 2;
  return Math.round(baseValue * (1 + direction * adjustment));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function getDateString(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getTimeString(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function groupTransactionsByDate(transactions: Transaction[]): Record<string, Transaction[]> {
  const groups: Record<string, Transaction[]> = {};
  for (const t of transactions) {
    const date = getDateString(t.timestamp);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(t);
  }
  return groups;
}
