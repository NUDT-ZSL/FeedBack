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
  capacity: number;
}

export interface Catalog {
  fillings: Filling[];
  molds: Mold[];
}

export interface OrderSnapshot {
  version: 1;
  fillings: Filling[];
  mold: Mold;
  drawingData: string;
  recipientName: string;
  blessing: string;
  createdAt: string;
}

export interface StoredOrder {
  id: string;
  orderId: string;
  idempotencyKey: string | null;
  snapshot: OrderSnapshot;
  snapshotHash: string;
  createdAt: string;
}
