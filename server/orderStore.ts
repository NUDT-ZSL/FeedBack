import fs from 'fs';
import path from 'path';

export interface StoredOrder {
  id: string;
  orderId: string;
  idempotencyKey: string;
  snapshot: string;
  snapshotHash: string;
  createdAt: string;
}

export class OrderStore {
  private dbPath: string;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'orders.json');
  }

  get filePath(): string {
    return this.dbPath;
  }

  readAll(): StoredOrder[] {
    if (!fs.existsSync(this.dbPath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(this.dbPath, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(orders: StoredOrder[]): void {
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(orders, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbPath);
  }

  insert(order: StoredOrder): void {
    const orders = this.readAll();
    orders.push(order);
    this.writeAll(orders);
  }

  findByOrderId(orderId: string): StoredOrder | undefined {
    return this.readAll().find(o => o.orderId === orderId);
  }

  findByIdempotencyKey(key: string): StoredOrder | undefined {
    return this.readAll().find(o => o.idempotencyKey === key);
  }
}
