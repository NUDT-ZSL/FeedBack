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
  maxFillings?: number;
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
  duplicated?: boolean;
}

export interface OrderSnapshot {
  fillings: Filling[];
  mold: Mold;
  drawingData: string;
  recipientName: string;
  blessing: string;
}

export interface OrderDetail {
  orderId: string;
  createdAt: string;
  snapshot: OrderSnapshot;
}

export interface ApiErrorDetail {
  field: string;
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: ApiErrorDetail[];
}
