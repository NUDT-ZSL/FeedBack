import type { Product } from './types';

export const mockProducts: Product[] = [
  {
    id: 'p1',
    name: '智能音箱 Pro',
    price: 1299,
    size: 25,
    color: '黑',
    material: '塑料',
    stock: 150,
    maxStock: 500,
    description: '高品质音效，支持多房间联动'
  },
  {
    id: 'p2',
    name: '无线耳机 Air',
    price: 899,
    size: 15,
    color: '白',
    material: '塑料',
    stock: 320,
    maxStock: 500,
    description: '主动降噪，续航30小时'
  },
  {
    id: 'p3',
    name: '智能手表 S3',
    price: 2499,
    size: 42,
    color: '蓝',
    material: '金属',
    stock: 80,
    maxStock: 500,
    description: '心率监测，GPS定位，防水50米'
  },
  {
    id: 'p4',
    name: '蓝牙键盘',
    price: 459,
    size: 38,
    color: '黑',
    material: '金属',
    stock: 200,
    maxStock: 500,
    description: '机械轴体，RGB背光，Type-C充电'
  },
  {
    id: 'p5',
    name: '陶瓷花瓶',
    price: 299,
    size: 30,
    color: '白',
    material: '陶瓷',
    stock: 45,
    maxStock: 200,
    description: '手工制作，简约现代风格'
  },
  {
    id: 'p6',
    name: '木质收纳盒',
    price: 189,
    size: 20,
    color: '绿',
    material: '木材',
    stock: 120,
    maxStock: 300,
    description: '天然胡桃木，多格收纳设计'
  },
  {
    id: 'p7',
    name: '运动水杯',
    price: 129,
    size: 18,
    color: '红',
    material: '塑料',
    stock: 500,
    maxStock: 500,
    description: '食品级材质，保温保冷'
  },
  {
    id: 'p8',
    name: '金属台灯',
    price: 699,
    size: 45,
    color: '黑',
    material: '金属',
    stock: 60,
    maxStock: 200,
    description: '护眼LED，三档调光，可调节角度'
  }
];
