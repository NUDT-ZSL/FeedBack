import { Workshop } from '../../src/workshop/workshop.ts';
import { stockEquals } from '../../src/workshop/inventory.ts';
import {
  INITIAL_STOCK,
  OVERSIZED_RECIPE,
  PANCHI_RECIPE,
  YUNLEI_RECIPE,
  sampleOrders,
} from './fixtures.ts';
import {
  expect,
  expectDeepEqual,
  expectEqual,
  expectThrows,
  suite,
} from './harness.ts';
import type { Suite } from './harness.ts';

export type WorkshopFactory = () => Workshop;

export function defaultFactory(): Workshop {
  const workshop = new Workshop(INITIAL_STOCK);
  for (const order of sampleOrders()) workshop.addOrder(order);
  return workshop;
}

export function buildSuites(makeWorkshop: WorkshopFactory): Suite[] {
  const atomicitySuite = suite('纹样合成与库存扣减的原子性', (test) => {
    test('正常提交：纹样入库且库存按配方扣减', () => {
      const workshop = makeWorkshop();
      const result = workshop.submitPattern({
        idempotencyKey: 'submit-1',
        name: '蟠螭纹',
        recipe: PANCHI_RECIPE,
      });
      expect(!result.deduplicated, 'first submit should not be deduplicated');
      expectEqual(workshop.listPatterns().length, 1, 'pattern count');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 8, silver: 8, copper: 17 },
        'stock after submit',
      );
      expectEqual(workshop.history.size, 1, 'history size');
    });

    test('扣料成功后纹样提交前发生故障：不留已提交纹样，库存恢复', () => {
      const workshop = makeWorkshop();
      const before = workshop.inventory.snapshot();
      expectThrows(
        () =>
          workshop.submitPattern(
            { idempotencyKey: 'submit-fault', name: '云雷纹', recipe: YUNLEI_RECIPE },
            { failAt: 'pattern.afterInventoryDeducted' },
          ),
        'faulty submit',
        'InjectedFault',
      );
      expect(stockEquals(workshop.inventory.snapshot(), before), 'stock must be fully restored');
      expectEqual(workshop.listPatterns().length, 0, 'no pattern may remain committed');
      expectEqual(workshop.history.size, 0, 'no undoable history may remain');
    });

    test('故障后同一幂等键可安全重试并成功', () => {
      const workshop = makeWorkshop();
      expectThrows(
        () =>
          workshop.submitPattern(
            { idempotencyKey: 'retry-key', name: '云雷纹', recipe: YUNLEI_RECIPE },
            { failAt: 'pattern.afterInventoryDeducted' },
          ),
        'faulty submit',
      );
      const retry = workshop.submitPattern({
        idempotencyKey: 'retry-key',
        name: '云雷纹',
        recipe: YUNLEI_RECIPE,
      });
      expect(!retry.deduplicated, 'retry after failure must execute as a fresh submit');
      expectEqual(workshop.listPatterns().length, 1, 'pattern count after retry');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 10, silver: 6, copper: 18 },
        'stock deducted exactly once after retry',
      );
    });

    test('库存不足时提交失败：纹样与库存均不变', () => {
      const workshop = makeWorkshop();
      const before = workshop.inventory.snapshot();
      expectThrows(
        () =>
          workshop.submitPattern({
            idempotencyKey: 'too-big',
            name: '超量纹样',
            recipe: OVERSIZED_RECIPE,
          }),
        'oversized submit',
      );
      expect(stockEquals(workshop.inventory.snapshot(), before), 'stock must be unchanged');
      expectEqual(workshop.listPatterns().length, 0, 'no pattern may be committed');
    });
  });

  const idempotencySuite = suite('重复提交的幂等性', (test) => {
    test('相同幂等键连续提交两次：只扣一次料，只留一条纹样', () => {
      const workshop = makeWorkshop();
      const input = { idempotencyKey: 'double-click', name: '蟠螭纹', recipe: PANCHI_RECIPE };
      const first = workshop.submitPattern(input);
      const second = workshop.submitPattern(input);
      expect(second.deduplicated, 'second submit must be deduplicated');
      expectEqual(second.record.id, first.record.id, 'same pattern record returned');
      expectEqual(workshop.listPatterns().length, 1, 'only one pattern committed');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 8, silver: 8, copper: 17 },
        'stock deducted exactly once',
      );
      expectEqual(workshop.history.size, 1, 'only one undoable entry');
    });

    test('不同幂等键提交同名纹样：视为两次独立提交', () => {
      const workshop = makeWorkshop();
      workshop.submitPattern({ idempotencyKey: 'a', name: '蟠螭纹', recipe: PANCHI_RECIPE });
      workshop.submitPattern({ idempotencyKey: 'b', name: '蟠螭纹', recipe: PANCHI_RECIPE });
      expectEqual(workshop.listPatterns().length, 2, 'two independent patterns');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 6, silver: 8, copper: 14 },
        'stock deducted twice',
      );
    });
  });

  const undoSuite = suite('撤销历史的一致性', (test) => {
    test('撤销后库存与纹样状态回到提交前', () => {
      const workshop = makeWorkshop();
      const before = workshop.inventory.snapshot();
      workshop.submitPattern({ idempotencyKey: 'u1', name: '蟠螭纹', recipe: PANCHI_RECIPE });
      workshop.submitPattern({ idempotencyKey: 'u2', name: '云雷纹', recipe: YUNLEI_RECIPE });
      expect(workshop.undoLast(), 'undo of second submit succeeds');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 8, silver: 8, copper: 17 },
        'stock back to state between the two submits',
      );
      expectEqual(workshop.listPatterns().length, 1, 'only first pattern remains');
      expect(workshop.undoLast(), 'undo of first submit succeeds');
      expect(stockEquals(workshop.inventory.snapshot(), before), 'stock fully restored');
      expectEqual(workshop.listPatterns().length, 0, 'no pattern remains');
    });

    test('撤销释放幂等键：同键可重新提交且只扣一次料', () => {
      const workshop = makeWorkshop();
      workshop.submitPattern({ idempotencyKey: 'reuse', name: '蟠螭纹', recipe: PANCHI_RECIPE });
      workshop.undoLast();
      const resubmitted = workshop.submitPattern({
        idempotencyKey: 'reuse',
        name: '蟠螭纹',
        recipe: PANCHI_RECIPE,
      });
      expect(!resubmitted.deduplicated, 'resubmit after undo must be a fresh submit');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 8, silver: 8, copper: 17 },
        'stock deducted exactly once after resubmit',
      );
    });

    test('空历史上撤销：安全返回 false，状态不变', () => {
      const workshop = makeWorkshop();
      const before = workshop.inventory.snapshot();
      expect(!workshop.undoLast(), 'undo on empty history returns false');
      expect(stockEquals(workshop.inventory.snapshot(), before), 'stock unchanged');
    });
  });

  const orderSuite = suite('订单状态流转的原子性', (test) => {
    test('正常流转：待制作 -> 制作中，库存同步扣减', () => {
      const workshop = makeWorkshop();
      const order = workshop.transitionOrder('order-1');
      expectEqual(order.status, 'in_progress', 'order status');
      expectEqual(workshop.getOrder('order-1')?.status, 'in_progress', 'persisted status');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 9, silver: 8, copper: 18 },
        'stock deducted for order-1',
      );
    });

    test('流转中途失败：订单不得已流转而库存未扣，也不得库存已扣而订单未流转', () => {
      const workshop = makeWorkshop();
      const before = workshop.inventory.snapshot();
      expectThrows(
        () => workshop.transitionOrder('order-1', { failAt: 'order.afterInventoryDeducted' }),
        'faulty transition',
        'InjectedFault',
      );
      expectEqual(workshop.getOrder('order-1')?.status, 'pending', 'order must stay pending');
      expect(stockEquals(workshop.inventory.snapshot(), before), 'stock must be fully restored');
    });

    test('失败后可安全重试同一订单流转', () => {
      const workshop = makeWorkshop();
      expectThrows(
        () => workshop.transitionOrder('order-1', { failAt: 'order.afterInventoryDeducted' }),
        'faulty transition',
      );
      const order = workshop.transitionOrder('order-1');
      expectEqual(order.status, 'in_progress', 'retry transitions the order');
      expectDeepEqual(
        workshop.inventory.snapshot(),
        { gold: 9, silver: 8, copper: 18 },
        'stock deducted exactly once after retry',
      );
    });

    test('非待制作状态重复流转：拒绝且库存不变', () => {
      const workshop = makeWorkshop();
      workshop.transitionOrder('order-1');
      const before = workshop.inventory.snapshot();
      expectThrows(() => workshop.transitionOrder('order-1'), 'duplicate transition');
      expect(stockEquals(workshop.inventory.snapshot(), before), 'stock unchanged');
    });

    test('库存不足时流转失败：订单保持待制作', () => {
      const workshop = makeWorkshop();
      for (let i = 0; i < 5; i += 1) {
        workshop.submitPattern({
          idempotencyKey: `drain-${i}`,
          name: `备料纹样-${i}`,
          recipe: PANCHI_RECIPE,
        });
      }
      expectThrows(() => workshop.transitionOrder('order-1'), 'transition without stock');
      expectEqual(workshop.getOrder('order-1')?.status, 'pending', 'order stays pending');
    });
  });

  return [atomicitySuite, idempotencySuite, undoSuite, orderSuite];
}

export const suites = buildSuites(defaultFactory);
