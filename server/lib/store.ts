import fs from 'fs';
import path from 'path';
import { StoredOrder } from './types';

export class OrderStore {
  private readonly dbPath: string;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'orders.json');
  }

  private readAll(): StoredOrder[] {
    if (!fs.existsSync(this.dbPath)) {
      return [];
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private writeAll(orders: StoredOrder[]): void {
    const tmpPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(orders, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbPath);
  }

  findByOrderId(orderId: string): StoredOrder | undefined {
    return this.readAll().find(o => o.orderId === orderId);
  }

  findByIdempotencyKey(key: string): StoredOrder | undefined {
    return this.readAll().find(o => o.idempotencyKey === key);
  }

  insert(order: StoredOrder): void {
    const orders = this.readAll();
    orders.push(order);
    this.writeAll(orders);
  }

  count(): number {
    return this.readAll().length;
  }
}
