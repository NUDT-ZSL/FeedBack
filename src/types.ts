export interface Product {
  id: string;
  name: string;
  price: number;
  size: number;
  color: string;
  material: string;
  stock: number;
  maxStock: number;
  description: string;
}

export interface FilterState {
  priceRange: [number, number];
  sizeRange: [number, number];
  colors: string[];
  materials: string[];
}

export const AVAILABLE_COLORS = ['红', '蓝', '绿', '黑', '白'];
export const AVAILABLE_MATERIALS = ['塑料', '金属', '木材', '陶瓷'];
export const COLOR_MAP: Record<string, string> = {
  '红': '#e94560',
  '蓝': '#4a90d9',
  '绿': '#4ade80',
  '黑': '#2d2d2d',
  '白': '#f0f0f0'
};
