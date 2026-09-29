import { generateOrders, generateInventory } from '@/utils/mockData';
import type { WorkerInitMessage, WorkerPayload } from '@/services/dataService';

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<WorkerInitMessage>) => {
  if (event.data?.type === 'generate') {
    const orderCount = event.data.orderCount ?? 500;
    const inventoryCount = event.data.inventoryCount ?? 200;

    const orders = generateOrders(orderCount);
    const inventory = generateInventory(inventoryCount);

    const payload: WorkerPayload = {
      type: 'init',
      orders,
      inventory,
    };
    ctx.postMessage(payload);
  }
};

export {};
