import type { MaterialCost, Order, Stock } from '../../src/workshop/types.ts';

export const INITIAL_STOCK: Stock = { gold: 10, silver: 8, copper: 20 };

export const PANCHI_RECIPE: MaterialCost[] = [
  { metal: 'gold', amount: 2 },
  { metal: 'copper', amount: 3 },
];

export const YUNLEI_RECIPE: MaterialCost[] = [
  { metal: 'silver', amount: 2 },
  { metal: 'copper', amount: 2 },
];

export const OVERSIZED_RECIPE: MaterialCost[] = [{ metal: 'gold', amount: 999 }];

export function sampleOrders(): Order[] {
  return [
    {
      id: 'order-1',
      title: '错金云纹豆',
      status: 'pending',
      materials: [
        { metal: 'gold', amount: 1 },
        { metal: 'copper', amount: 2 },
      ],
    },
    {
      id: 'order-2',
      title: '错银铜牛灯',
      status: 'pending',
      materials: [{ metal: 'silver', amount: 3 }],
    },
  ];
}
