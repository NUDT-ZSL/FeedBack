export interface Product {
  id: string;
  name: string;
  origin: string;
  cocoaContent: number;
  imageUrl: string;
  flavorTags: string[];
  price: number;
  description: string;
}

export interface BoxItem {
  productId: string;
  quantity: number;
}

export interface CustomBox {
  id: string;
  items: BoxItem[];
  greetingCard: string;
  totalPieces: number;
  estimatedPrice: number;
  createdAt: Date;
}

export enum OrderStage {
  INGREDIENT_PREP = 'ingredient_prep',
  TEMPERING = 'tempering',
  DECORATION = 'decoration',
  PACKING_SHIPPING = 'packing_shipping'
}

export const ORDER_STAGE_INFO: Record<OrderStage, { label: string; order: number }> = {
  [OrderStage.INGREDIENT_PREP]: { label: '原料准备', order: 0 },
  [OrderStage.TEMPERING]: { label: '巧克力调温', order: 1 },
  [OrderStage.DECORATION]: { label: '手工装饰', order: 2 },
  [OrderStage.PACKING_SHIPPING]: { label: '打包发货', order: 3 }
};

export interface Order {
  id: string;
  box: CustomBox;
  currentStage: OrderStage;
  stageProgress: number;
  estimatedCompletionTime: Date;
  createdAt: Date;
  products: Product[];
}

export interface OrderTrackerProps {
  orderId?: string;
  onBack?: () => void;
}

export interface CatalogProps {
  onSelectProduct: (productId: string) => void;
  selectedProductIds: Set<string>;
}

export interface CustomizerProps {
  selectedProducts: Product[];
  onRemoveProduct: (productId: string) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  quantities: Record<string, number>;
  onConfirm: (greetingCard: string) => void;
  onBack: () => void;
}
