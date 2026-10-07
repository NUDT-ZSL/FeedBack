export interface Filling {
  id: string;
  name: string;
  description: string;
  image: string;
}

export interface Mold {
  id: string;
  name: string;
  shape: string;
}

export interface OrderData {
  fillings: Filling[];
  mold: Mold | null;
  drawingData: string;
  baked: boolean;
  recipientName: string;
  blessing: string;
}

export interface OrderResponse {
  orderId: string;
  shareLink: string;
}

export interface SavedOrder {
  id: string;
  orderId: string;
  fillings: string;
  mold: string;
  drawingData: string;
  recipientName: string;
  blessing: string;
  createdAt: string;
}
