export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Dish {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  rating: number;
  description: string;
  image: string;
  isRecommended: boolean;
}

export interface OrderItem {
  dishId: string;
  quantity: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  totalAmount: number;
  waitTime: number;
  createdAt: Date;
}

const categories: Category[] = [
  { id: 'recommended', name: '推荐', icon: '⭐' },
  { id: 'sichuan', name: '川菜', icon: '🌶️' },
  { id: 'cantonese', name: '粤菜', icon: '🥢' },
  { id: 'dessert', name: '甜点', icon: '🍰' }
];

const dishes: Dish[] = [
  {
    id: 'd1',
    categoryId: 'recommended',
    name: '招牌红烧肉',
    price: 58,
    rating: 4.8,
    description: '肥而不腻，入口即化，秘制酱汁炖煮',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=300&fit=crop',
    isRecommended: true
  },
  {
    id: 'd2',
    categoryId: 'recommended',
    name: '黄金脆皮鸡',
    price: 68,
    rating: 4.6,
    description: '外酥里嫩，秘制腌料，香气四溢',
    image: 'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?w=400&h=300&fit=crop',
    isRecommended: true
  },
  {
    id: 'd3',
    categoryId: 'recommended',
    name: '海鲜大咖',
    price: 188,
    rating: 4.9,
    description: '多种海鲜拼盘，新鲜直达，美味共享',
    image: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=400&h=300&fit=crop',
    isRecommended: true
  },
  {
    id: 'd4',
    categoryId: 'recommended',
    name: '什锦炒饭',
    price: 28,
    rating: 4.3,
    description: '多种食材搭配，粒粒分明，美味可口',
    image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400&h=300&fit=crop',
    isRecommended: true
  },
  {
    id: 'd5',
    categoryId: 'sichuan',
    name: '麻婆豆腐',
    price: 32,
    rating: 4.5,
    description: '麻辣鲜香，豆腐嫩滑，正宗川味',
    image: 'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd6',
    categoryId: 'sichuan',
    name: '水煮鱼',
    price: 88,
    rating: 4.7,
    description: '麻辣鲜香，鱼肉嫩滑，经典川菜',
    image: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd7',
    categoryId: 'sichuan',
    name: '宫保鸡丁',
    price: 38,
    rating: 4.4,
    description: '鸡肉鲜嫩，花生酥脆，酸甜微辣',
    image: 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd8',
    categoryId: 'sichuan',
    name: '回锅肉',
    price: 42,
    rating: 4.6,
    description: '肥瘦相间，酱香浓郁，下饭神器',
    image: 'https://images.unsplash.com/photo-1574484284002-952d92456975?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd9',
    categoryId: 'sichuan',
    name: '夫妻肺片',
    price: 36,
    rating: 4.5,
    description: '麻辣鲜香，口感丰富，开胃前菜',
    image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd10',
    categoryId: 'cantonese',
    name: '白切鸡',
    price: 68,
    rating: 4.7,
    description: '皮爽肉滑，原汁原味，广东名菜',
    image: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd11',
    categoryId: 'cantonese',
    name: '蜜汁叉烧',
    price: 52,
    rating: 4.8,
    description: '甜香软嫩，色泽红亮，经典粤菜',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd12',
    categoryId: 'cantonese',
    name: '虾饺皇',
    price: 38,
    rating: 4.6,
    description: '皮薄馅靓，虾肉鲜美，早茶必点',
    image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd13',
    categoryId: 'cantonese',
    name: '广式煲仔饭',
    price: 45,
    rating: 4.5,
    description: '锅巴香脆，腊味香浓，风味独特',
    image: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd14',
    categoryId: 'cantonese',
    name: '清蒸石斑鱼',
    price: 168,
    rating: 4.9,
    description: '鱼肉鲜嫩，清淡鲜美，宴席佳肴',
    image: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd15',
    categoryId: 'dessert',
    name: '芒果班戟',
    price: 28,
    rating: 4.7,
    description: '新鲜芒果，奶油香浓，口感细腻',
    image: 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd16',
    categoryId: 'dessert',
    name: '杨枝甘露',
    price: 32,
    rating: 4.8,
    description: '芒果西柚，椰汁西米，经典港式甜品',
    image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd17',
    categoryId: 'dessert',
    name: '双皮奶',
    price: 22,
    rating: 4.5,
    description: '奶香浓郁，口感滑嫩，顺德名吃',
    image: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd18',
    categoryId: 'dessert',
    name: '提拉米苏',
    price: 36,
    rating: 4.6,
    description: '意式经典，咖啡香浓，层次丰富',
    image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400&h=300&fit=crop',
    isRecommended: false
  },
  {
    id: 'd19',
    categoryId: 'dessert',
    name: '红豆冰沙',
    price: 18,
    rating: 4.3,
    description: '红豆绵软，冰沙细腻，消暑佳品',
    image: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=400&h=300&fit=crop',
    isRecommended: false
  }
];

export function getCategories(): Category[] {
  return categories;
}

export function getDishesByCategory(categoryId: string): Dish[] {
  if (categoryId === 'recommended') {
    return dishes.filter(d => d.isRecommended);
  }
  return dishes.filter(d => d.categoryId === categoryId);
}

export function getDishById(id: string): Dish | undefined {
  return dishes.find(d => d.id === id);
}

export function getAllDishes(): Dish[] {
  return dishes;
}
