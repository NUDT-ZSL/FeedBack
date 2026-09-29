export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'shipping'
  | 'completed';

export type ProductStyle = 'wallet' | 'handbag' | 'belt' | 'keychain';

export type LeatherType =
  | 'vegetable_tanned'
  | 'chrome_tanned'
  | 'cordovan'
  | 'crocodile';

export type PresetColor =
  | 'tan'
  | 'dark_brown'
  | 'black'
  | 'burgundy'
  | 'navy'
  | 'olive';

export type OrderStage =
  | 'design'
  | 'cutting'
  | 'stitching'
  | 'edge_painting'
  | 'hardware';

export type StageStatus = 'pending' | 'current' | 'completed';

export interface StageProgress {
  stage: OrderStage;
  name: string;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMinutes?: number;
  note?: string;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  style: ProductStyle;
  leatherType: LeatherType;
  color: PresetColor;
  size: string;
  remark: string;
  status: OrderStatus;
  stages: StageProgress[];
  createdAt: string;
  updatedAt: string;
  estimatedCompletionDate: string;
}

export interface InventoryItem {
  id: string;
  leatherType: LeatherType;
  color: PresetColor;
  areaSqft: number;
  purchaseDate: string;
  safeThreshold: number;
  recentConsumption: number;
}

export interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info';
  createdAt: number;
}

export type SwipeDirection = 'left' | 'right' | null;
