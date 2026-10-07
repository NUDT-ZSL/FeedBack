import crypto from 'crypto';
import { OrderSnapshot, StoredOrder } from './types';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSnapshotHash(snapshot: OrderSnapshot): string {
  return crypto.createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

export class SnapshotCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotCorruptedError';
  }
}

export function readSnapshot(order: StoredOrder): OrderSnapshot {
  if (!order.snapshot || typeof order.snapshot !== 'object') {
    throw new SnapshotCorruptedError(`订单 ${order.orderId} 的快照缺失或已损坏`);
  }
  const expectedHash = order.snapshotHash;
  const actualHash = canonicalSnapshotHash(order.snapshot);
  if (typeof expectedHash !== 'string' || expectedHash !== actualHash) {
    throw new SnapshotCorruptedError(`订单 ${order.orderId} 的快照校验失败，内容可能已被篡改`);
  }
  return order.snapshot;
}
