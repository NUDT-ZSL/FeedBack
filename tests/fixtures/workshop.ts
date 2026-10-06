import type { WorkshopState } from '../../src/domain/types.ts';
import { MetalType, OrderStatus } from '../../src/domain/types.ts';

export function createSeedState(): WorkshopState {
  return {
    patterns: [],
    patternsByKey: {},
    inventory: {
      [MetalType.GOLD]: 10,
      [MetalType.SILVER]: 8,
      [MetalType.COPPER]: 20,
    },
    orders: [
      {
        id: 'order-panchi',
        title: '蟠螭纹铜壶',
        status: OrderStatus.PENDING,
        materials: [
          { metal: MetalType.GOLD, amount: 2 },
          { metal: MetalType.COPPER, amount: 5 },
        ],
      },
      {
        id: 'order-yunlei',
        title: '云雷纹铜镜',
        status: OrderStatus.PENDING,
        materials: [{ metal: MetalType.SILVER, amount: 3 }],
      },
      {
        id: 'order-hungry',
        title: '大耗料摆件',
        status: OrderStatus.PENDING,
        materials: [{ metal: MetalType.GOLD, amount: 99 }],
      },
      {
        id: 'order-crafting',
        title: '已在制作中的弦纹卮',
        status: OrderStatus.CRAFTING,
        materials: [{ metal: MetalType.COPPER, amount: 1 }],
      },
    ],
  };
}
