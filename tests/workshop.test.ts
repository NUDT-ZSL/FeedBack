import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workshop, STEP_SUBMIT_PATTERN, STEP_DEDUCT_INVENTORY, STEP_TRANSITION_ORDER } from '../src/domain/workshop.ts';
import { WorkshopError } from '../src/domain/errors.ts';
import { MetalType, OrderStatus } from '../src/domain/types.ts';
import { createSeedState } from './fixtures/workshop.ts';

function freshWorkshop(): Workshop {
  return new Workshop(createSeedState());
}

const panChiMaterials = [
  { metal: MetalType.GOLD, amount: 2 },
  { metal: MetalType.COPPER, amount: 3 },
];

test('合成提交与库存扣减: 正常路径两步同时生效', () => {
  const workshop = freshWorkshop();
  const result = workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  assert.equal(result.deduplicated, false);
  assert.equal(workshop.patterns.length, 1);
  assert.equal(workshop.inventory[MetalType.GOLD], 8);
  assert.equal(workshop.inventory[MetalType.COPPER], 17);
});

test('合成提交与库存扣减: 扣减失败时不留下已提交的纹样', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  assert.throws(
    () => workshop.synthesizePattern('饕餮纹', [{ metal: MetalType.GOLD, amount: 999 }]),
    (error: unknown) => error instanceof WorkshopError && error.code === 'INSUFFICIENT_STOCK',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('合成提交与库存扣减: 提交步被人为破坏时不扣库存', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  workshop.failNextStep(STEP_SUBMIT_PATTERN);
  assert.throws(
    () => workshop.synthesizePattern('蟠螭纹', panChiMaterials),
    (error: unknown) => error instanceof WorkshopError && error.code === 'STEP_FAILED',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('合成提交与库存扣减: 扣减步被人为破坏时不留下纹样', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  workshop.failNextStep(STEP_DEDUCT_INVENTORY);
  assert.throws(
    () => workshop.synthesizePattern('蟠螭纹', panChiMaterials),
    (error: unknown) => error instanceof WorkshopError && error.code === 'STEP_FAILED',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('幂等: 连续提交相同纹样不重复扣料', () => {
  const workshop = freshWorkshop();
  const first = workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  const second = workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  assert.equal(second.deduplicated, true);
  assert.equal(second.pattern.id, first.pattern.id);
  assert.equal(workshop.patterns.length, 1);
  assert.equal(workshop.inventory[MetalType.GOLD], 8);
  assert.equal(workshop.inventory[MetalType.COPPER], 17);
});

test('幂等: 材料顺序不同仍视为相同纹样', () => {
  const workshop = freshWorkshop();
  workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  const reordered = workshop.synthesizePattern('蟠螭纹', [
    { metal: MetalType.COPPER, amount: 3 },
    { metal: MetalType.GOLD, amount: 2 },
  ]);
  assert.equal(reordered.deduplicated, true);
  assert.equal(workshop.patterns.length, 1);
});

test('幂等: 不同纹样各自正常扣料', () => {
  const workshop = freshWorkshop();
  workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  workshop.synthesizePattern('云雷纹', [{ metal: MetalType.SILVER, amount: 1 }]);
  assert.equal(workshop.patterns.length, 2);
  assert.equal(workshop.inventory[MetalType.SILVER], 7);
});

test('撤销: 合成后库存与纹样回到提交前', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  workshop.undo();
  assert.deepEqual(workshop.snapshot(), before);
});

test('撤销: 撤销后可再次提交同一纹样', () => {
  const workshop = freshWorkshop();
  workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  workshop.undo();
  const result = workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  assert.equal(result.deduplicated, false);
  assert.equal(workshop.inventory[MetalType.GOLD], 8);
});

test('撤销: 多步操作按逆序回滚', () => {
  const workshop = freshWorkshop();
  const initial = workshop.snapshot();
  workshop.synthesizePattern('蟠螭纹', panChiMaterials);
  workshop.synthesizePattern('云雷纹', [{ metal: MetalType.SILVER, amount: 1 }]);
  workshop.undo();
  assert.equal(workshop.patterns.length, 1);
  assert.equal(workshop.inventory[MetalType.SILVER], 8);
  assert.equal(workshop.inventory[MetalType.GOLD], 8);
  workshop.undo();
  assert.deepEqual(workshop.snapshot(), initial);
});

test('撤销: 失败的操作不产生撤销记录', () => {
  const workshop = freshWorkshop();
  workshop.failNextStep(STEP_DEDUCT_INVENTORY);
  assert.throws(() => workshop.synthesizePattern('蟠螭纹', panChiMaterials));
  assert.equal(workshop.undoDepth, 0);
  assert.throws(
    () => workshop.undo(),
    (error: unknown) => error instanceof WorkshopError && error.code === 'NOTHING_TO_UNDO',
  );
});

test('订单流转: 待制作正常流转到制作中并扣料', () => {
  const workshop = freshWorkshop();
  const order = workshop.transitionOrderToCrafting('order-panchi');
  assert.equal(order.status, OrderStatus.CRAFTING);
  assert.equal(workshop.inventory[MetalType.GOLD], 8);
  assert.equal(workshop.inventory[MetalType.COPPER], 15);
});

test('订单流转: 扣料步失败时订单不得流转', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  workshop.failNextStep(STEP_DEDUCT_INVENTORY);
  assert.throws(
    () => workshop.transitionOrderToCrafting('order-panchi'),
    (error: unknown) => error instanceof WorkshopError && error.code === 'STEP_FAILED',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('订单流转: 流转步失败时库存不得单边扣减', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  workshop.failNextStep(STEP_TRANSITION_ORDER);
  assert.throws(
    () => workshop.transitionOrderToCrafting('order-panchi'),
    (error: unknown) => error instanceof WorkshopError && error.code === 'STEP_FAILED',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('订单流转: 库存不足时无单边结果', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  assert.throws(
    () => workshop.transitionOrderToCrafting('order-hungry'),
    (error: unknown) => error instanceof WorkshopError && error.code === 'INSUFFICIENT_STOCK',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('订单流转: 非待制作订单不得重复流转', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  assert.throws(
    () => workshop.transitionOrderToCrafting('order-crafting'),
    (error: unknown) => error instanceof WorkshopError && error.code === 'INVALID_ORDER_TRANSITION',
  );
  assert.deepEqual(workshop.snapshot(), before);
});

test('订单流转: 流转后可撤销回待制作且库存回补', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  workshop.transitionOrderToCrafting('order-panchi');
  workshop.undo();
  assert.deepEqual(workshop.snapshot(), before);
});

test('订单流转: 不存在的订单报错且状态不变', () => {
  const workshop = freshWorkshop();
  const before = workshop.snapshot();
  assert.throws(
    () => workshop.transitionOrderToCrafting('order-ghost'),
    (error: unknown) => error instanceof WorkshopError && error.code === 'ORDER_NOT_FOUND',
  );
  assert.deepEqual(workshop.snapshot(), before);
});
