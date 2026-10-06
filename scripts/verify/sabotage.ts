import { Workshop } from '../../src/workshop/workshop.ts';
import type { SubmitPatternInput, SubmitPatternResult, StepOptions } from '../../src/workshop/workshop.ts';
import type { Order } from '../../src/workshop/types.ts';
import { INITIAL_STOCK, sampleOrders } from './fixtures.ts';
import { buildSuites } from './scenarios.test.ts';
import { runSuites } from './harness.ts';

export class UnatomicSubmitWorkshop extends Workshop {
  protected override rollback(): void {
    // 人为破坏：失败时不执行任何补偿回滚
  }
}

export class DoubleDeductWorkshop extends Workshop {
  private counter = 0;

  override submitPattern(input: SubmitPatternInput, options: StepOptions = {}): SubmitPatternResult {
    // 人为破坏：幂等键形同虚设，每次提交都被当作新提交
    this.counter += 1;
    return super.submitPattern(
      { ...input, idempotencyKey: `${input.idempotencyKey}#${this.counter}` },
      options,
    );
  }
}

export class BrokenUndoWorkshop extends Workshop {
  override submitPattern(input: SubmitPatternInput, options: StepOptions = {}): SubmitPatternResult {
    const result = super.submitPattern(input, options);
    if (!result.deduplicated) {
      // 人为破坏：栈顶压入一个不做任何补偿的撤销记录，使最近一次撤销失效
      this.history.push({
        kind: 'pattern.submit',
        label: `${input.name} (broken undo)`,
        undo: () => {},
      });
    }
    return result;
  }
}

export class OneSidedOrderWorkshop extends Workshop {
  override transitionOrder(orderId: string, options: StepOptions = {}): Order {
    // 人为破坏：先流转状态再扣料，中途失败留下“订单已流转而库存未扣”的单边结果
    const internal = this.orders.get(orderId);
    if (!internal) throw new Error(`order not found: ${orderId}`);
    internal.status = 'in_progress';
    if (options.failAt === 'order.afterInventoryDeducted') {
      throw new Error('injected fault at order.afterInventoryDeducted');
    }
    this.inventory.deduct(internal.materials);
    return { ...internal };
  }
}

interface Drill {
  name: string;
  makeWorkshop: () => Workshop;
  expectSuitesFailed: string[];
}

const DRILLS: Drill[] = [
  {
    name: '破坏点：合成/流转失败不回滚',
    makeWorkshop: () => {
      const w = new UnatomicSubmitWorkshop(INITIAL_STOCK);
      for (const order of sampleOrders()) w.addOrder(order);
      return w;
    },
    expectSuitesFailed: ['纹样合成与库存扣减的原子性', '订单状态流转的原子性'],
  },
  {
    name: '破坏点：幂等键失效导致重复扣料',
    makeWorkshop: () => {
      const w = new DoubleDeductWorkshop(INITIAL_STOCK);
      for (const order of sampleOrders()) w.addOrder(order);
      return w;
    },
    expectSuitesFailed: ['重复提交的幂等性'],
  },
  {
    name: '破坏点：撤销不回补库存与纹样状态',
    makeWorkshop: () => {
      const w = new BrokenUndoWorkshop(INITIAL_STOCK);
      for (const order of sampleOrders()) w.addOrder(order);
      return w;
    },
    expectSuitesFailed: ['撤销历史的一致性'],
  },
  {
    name: '破坏点：订单先流转后扣料产生单边结果',
    makeWorkshop: () => {
      const w = new OneSidedOrderWorkshop(INITIAL_STOCK);
      for (const order of sampleOrders()) w.addOrder(order);
      return w;
    },
    expectSuitesFailed: ['订单状态流转的原子性'],
  },
];

export function runSabotageDrills(log: (line: string) => void): boolean {
  let allCaught = true;
  for (const drill of DRILLS) {
    const results = runSuites(buildSuites(drill.makeWorkshop), { quiet: true });
    const failedSuites = new Set(
      results.filter((r) => r.failed.length > 0).map((r) => r.name),
    );
    const caught = drill.expectSuitesFailed.every((name) => failedSuites.has(name));
    log(
      `  ${caught ? '\u2713' : '\u2717'} ${drill.name} -> ${
        caught
          ? `已被验证套件捕获（失败套件：${[...failedSuites].join('、')}）`
          : '未被验证套件捕获！'
      }`,
    );
    if (!caught) allCaught = false;
  }
  return allCaught;
}
