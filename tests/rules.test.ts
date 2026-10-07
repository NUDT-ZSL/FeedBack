import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEnterRefining, dropHerbFromBasket, MIN_HERBS_FOR_REFINING } from '../src/core/rules';
import { FurnaceCore } from '../src/core/furnace';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../src/types';
import type { HerbData } from '../src/types';

function herb(element: HerbData['element'], id: string): HerbData {
  return {
    id,
    name: `草_${id}`,
    element,
    color: ELEMENT_COLORS[element],
    potency: 0.7,
    position: { x: 0, y: 0, z: 0 }
  };
}

test('进入炼丹的门槛：少于5株拒绝，5株及以上允许', () => {
  for (let n = 0; n <= 10; n++) {
    assert.equal(canEnterRefining(n), n >= MIN_HERBS_FOR_REFINING, `数量 ${n}`);
  }
});

test('药篓中不存在的草药投料：不发生任何变化', () => {
  const basket = [herb('金', 'h1')];
  const furnace = new FurnaceCore();
  const result = dropHerbFromBasket(basket, 'missing', () => {
    throw new Error('不应调用 place');
  });
  assert.deepEqual(result, { found: false, isCorrect: false });
  assert.equal(basket.length, 1);
  assert.equal(furnace.getSlots()[0].herb, null);
});

test('同元素投料成功后草药从药篓移除', () => {
  const basket = [herb('金', 'h1'), herb('木', 'h2')];
  const furnace = new FurnaceCore();
  const result = dropHerbFromBasket(basket, 'h1', h => furnace.placeHerb(h, 0).isCorrect);
  assert.deepEqual(result, { found: true, isCorrect: true });
  assert.deepEqual(basket.map(h => h.id), ['h2']);
  assert.equal(furnace.getSlots()[0].herb?.id, 'h1');
});

test('异元素投料失败时草药留在药篓且槽位记录为不正确', () => {
  const basket = [herb('火', 'h1')];
  const furnace = new FurnaceCore();
  const result = dropHerbFromBasket(basket, 'h1', h => furnace.placeHerb(h, 0).isCorrect); // 槽位0=金
  assert.deepEqual(result, { found: true, isCorrect: false });
  assert.deepEqual(basket.map(h => h.id), ['h1']);
  assert.equal(furnace.getSlots()[0].isCorrect, false);
});

test('空槽重复投料时草药留在药篓且首次内容不变', () => {
  const basket = [herb('金', 'first'), herb('金', 'second')];
  const furnace = new FurnaceCore();
  assert.equal(dropHerbFromBasket(basket, 'first', h => furnace.placeHerb(h, 0).isCorrect).isCorrect, true);
  assert.equal(dropHerbFromBasket(basket, 'second', h => furnace.placeHerb(h, 0).isCorrect).isCorrect, false);
  assert.deepEqual(basket.map(h => h.id), ['second']);
  assert.equal(furnace.getSlots()[0].herb?.id, 'first');
});

test('五种槽位元素顺序符合配置', () => {
  assert.deepEqual(ELEMENT_NAMES, ['金', '木', '水', '火', '土']);
});
