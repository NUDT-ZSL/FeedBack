import type {
  ProductStyle,
  LeatherType,
  PresetColor,
  OrderStage,
  OrderStatus,
} from './types';

export const STYLE_CONSUMPTION: Record<ProductStyle, number> = {
  wallet: 1.5,
  handbag: 4.0,
  belt: 0.8,
  keychain: 0.3,
};

export const COLOR_PALETTE: Record<PresetColor, string> = {
  tan: '#C8A572',
  dark_brown: '#5C4033',
  black: '#2C2416',
  burgundy: '#722F37',
  navy: '#1E3A5F',
  olive: '#556B2F',
};

export const COLOR_NAMES: Record<PresetColor, string> = {
  tan: '浅棕',
  dark_brown: '深棕',
  black: '墨黑',
  burgundy: '酒红',
  navy: '藏青',
  olive: '橄榄',
};

export const STYLE_NAMES: Record<ProductStyle, string> = {
  wallet: '钱包',
  handbag: '手提包',
  belt: '皮带',
  keychain: '钥匙扣',
};

export const LEATHER_NAMES: Record<LeatherType, string> = {
  vegetable_tanned: '植鞣革',
  chrome_tanned: '铬鞣革',
  cordovan: '马臀皮',
  crocodile: '鳄鱼皮',
};

export const STAGE_NAMES: Record<OrderStage, string> = {
  design: '设计确认',
  cutting: '开料',
  stitching: '缝制',
  edge_painting: '边油',
  hardware: '五金安装',
};

export const STAGE_ORDER: OrderStage[] = [
  'design',
  'cutting',
  'stitching',
  'edge_painting',
  'hardware',
];

export const STATUS_NAMES: Record<OrderStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  in_progress: '制作中',
  shipping: '待发货',
  completed: '已完成',
};

export const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
  in_progress: 'bg-purple-100 text-purple-800 border-purple-200',
  shipping: 'bg-orange-100 text-orange-800 border-orange-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
};

export const STATUS_BG_GRADIENTS: Record<OrderStatus, string> = {
  pending: 'from-amber-50 to-amber-100',
  confirmed: 'from-blue-50 to-blue-100',
  in_progress: 'from-purple-50 to-purple-100',
  shipping: 'from-orange-50 to-orange-100',
  completed: 'from-green-50 to-green-100',
};

export const STATUS_FLOW: OrderStatus[] = [
  'pending',
  'confirmed',
  'in_progress',
  'shipping',
  'completed',
];

export const SIZE_OPTIONS: Record<ProductStyle, string[]> = {
  wallet: ['长款', '短款', '对折'],
  handbag: ['小号', '中号', '大号'],
  belt: ['S', 'M', 'L', 'XL'],
  keychain: ['圆形', '方形', '定制'],
};

export const PRESET_COLORS: PresetColor[] = [
  'tan',
  'dark_brown',
  'black',
  'burgundy',
  'navy',
  'olive',
];

export const PRODUCT_STYLES: ProductStyle[] = [
  'wallet',
  'handbag',
  'belt',
  'keychain',
];

export const LEATHER_TYPES: LeatherType[] = [
  'vegetable_tanned',
  'chrome_tanned',
  'cordovan',
  'crocodile',
];

export const STATUS_FILTER: Array<OrderStatus | 'all'> = [
  'all',
  ...STATUS_FLOW,
];

export const STATUS_FILTER_NAMES: Record<OrderStatus | 'all', string> = {
  all: '全部',
  ...STATUS_NAMES,
};

export const REMARK_MAX_LENGTH = 200;
export const ORDER_ID_LENGTH = 6;
export const ASYNC_DELAY_MS = 50;
