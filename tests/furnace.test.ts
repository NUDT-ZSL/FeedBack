import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FurnaceCore, computeFurnaceColor, REFINING_DURATION_SECONDS } from '../src/core/furnace';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../src/types';
import type { ElementType, HerbData } from '../src/types';

let herbSeq = 0;
function makeHerb(element: ElementType, name = `测试草${herbSeq}`): HerbData {
  herbSeq += 1;
  return {
    id: `test_herb_${herbSeq}`,
    name,
    element,
    color: ELEMENT_COLORS[element],
    potency: 0.8,
    position: { x: 0, y: 0, z: 0 }
  };
}

const IDLE_COLOR = 0x333333;

test('同元素投料：接受且匹配，炉体颜色变为该元素色', () => {
  const furnace = new FurnaceCore();
  const result = furnace.placeHerb(makeHerb('火'), 2); // 槽位2 = 水? 按 ELEMENT_NAMES 顺序取对应槽位
  const fireSlot = ELEMENT_NAMES.indexOf('火');
  const furnace2 = new FurnaceCore();
  const r2 = furnace2.placeHerb(makeHerb('火'), fireSlot);

  assert.equal(r2.accepted, true);
  assert.equal(r2.isCorrect, true);
  assert.equal(furnace2.getCurrentColor(), computeFurnaceColor(['火']));
  assert.equal(furnace2.getSlots()[fireSlot].isCorrect, true);
  // result 是异元素（除非槽位2恰好是火），仅验证返回结构
  assert.equal(typeof result.accepted, 'boolean');
});

test('异元素投料：进入槽位但不匹配，炉体颜色保持空闲色', () => {
  const furnace = new FurnaceCore();
  const waterSlot = ELEMENT_NAMES.indexOf('水');
  const result = furnace.placeHerb(makeHerb('火'), waterSlot);

  assert.equal(result.accepted, true);
  assert.equal(result.isCorrect, false);
  assert.equal(furnace.getCurrentColor(), IDLE_COLOR);
  const slot = furnace.getSlots()[waterSlot];
  assert.equal(slot.herb?.element, '火');
  assert.equal(slot.isCorrect, false);
});

test('空槽重复投料被拒绝，槽位保持首次内容', () => {
  const furnace = new FurnaceCore();
  const slot = ELEMENT_NAMES.indexOf('金');
  const first = makeHerb('金', '第一株');
  const second = makeHerb('金', '第二株');

  assert.deepEqual(furnace.placeHerb(first, slot), { accepted: true, isCorrect: true });
  assert.deepEqual(furnace.placeHerb(second, slot), { accepted: false, isCorrect: false });

  const slots = furnace.getSlots();
  assert.equal(slots[slot].herb?.name, '第一株');
  assert.equal(furnace.getCurrentColor(), computeFurnaceColor(['金']));
});

test('非法槽位索引被拒绝', () => {
  const furnace = new FurnaceCore();
  assert.deepEqual(furnace.placeHerb(makeHerb('土'), -1), { accepted: false, isCorrect: false });
  assert.deepEqual(furnace.placeHerb(makeHerb('土'), 5), { accepted: false, isCorrect: false });
});

test('炉体颜色与已正确放入的草药集合一致，与投料顺序无关（全排列）', () => {
  // 5 株草药：3 株放对（金/木/水），2 株放错（火槽放土、土槽放火）
  const assignments: Array<{ herb: HerbData; slot: number }> = [
    { herb: makeHerb('金'), slot: ELEMENT_NAMES.indexOf('金') },
    { herb: makeHerb('木'), slot: ELEMENT_NAMES.indexOf('木') },
    { herb: makeHerb('水'), slot: ELEMENT_NAMES.indexOf('水') },
    { herb: makeHerb('土'), slot: ELEMENT_NAMES.indexOf('火') },
    { herb: makeHerb('火'), slot: ELEMENT_NAMES.indexOf('土') }
  ];

  const expectedColor = computeFurnaceColor(['金', '木', '水']);
  const snapshots = new Set<string>();

  const permutations = permute([0, 1, 2, 3, 4]);
  assert.equal(permutations.length, 120);

  for (const order of permutations) {
    const furnace = new FurnaceCore();
    for (const i of order) {
      furnace.placeHerb(assignments[i].herb, assignments[i].slot);
    }
    assert.equal(furnace.getCurrentColor(), expectedColor, `投料顺序 ${order} 的炉体颜色不一致`);
    assert.equal(furnace.calculateMatchScore(), 3 / 5);
    snapshots.add(JSON.stringify({ slots: furnace.getSlots(), pill: furnace.generatePill() }));
  }

  assert.equal(snapshots.size, 1, '120 种投料顺序必须得到完全一致的槽位状态与成丹结论');
});

test('匹配度与品质分档：5对→仙品，4对/3对→灵品，2对及以下→凡品', () => {
  const cases: Array<{ correct: number; score: number; quality: string }> = [
    { correct: 5, score: 1, quality: '仙品' },
    { correct: 4, score: 0.8, quality: '灵品' },
    { correct: 3, score: 0.6, quality: '灵品' },
    { correct: 2, score: 0.4, quality: '凡品' },
    { correct: 1, score: 0.2, quality: '凡品' },
    { correct: 0, score: 0, quality: '凡品' }
  ];

  for (const { correct, score, quality } of cases) {
    const furnace = new FurnaceCore();
    ELEMENT_NAMES.forEach((element, slot) => {
      const herbElement = slot < correct ? element : ELEMENT_NAMES[(slot + 1) % 5];
      furnace.placeHerb(makeHerb(herbElement), slot);
    });
    assert.equal(furnace.calculateMatchScore(), score, `correct=${correct} 匹配度`);
    const pill = furnace.generatePill();
    assert.equal(pill.quality, quality, `correct=${correct} 品质`);
    assert.equal(pill.matchScore, score);
  }
});

test('成丹结论只由元素构成决定：换名称/药性的同元素组合结论逐字段一致', () => {
  const build = (namePrefix: string, potency: number) => {
    const furnace = new FurnaceCore();
    ELEMENT_NAMES.forEach((element, slot) => {
      const herb = makeHerb(element, `${namePrefix}${element}`);
      herb.potency = potency;
      furnace.placeHerb(herb, slot);
    });
    return furnace.generatePill();
  };

  const a = build('灵芝', 0.5);
  const b = build('毒藤', 0.99);
  assert.deepEqual(a, b, '元素构成相同则品质/名称/ID/药效必须完全一致');
});

test('相同构成重复取丹结果一致；不同构成结论不同', () => {
  const furnace = new FurnaceCore();
  ELEMENT_NAMES.forEach((element, slot) => furnace.placeHerb(makeHerb(element), slot));
  const first = furnace.generatePill();
  const second = furnace.generatePill();
  assert.deepEqual(first, second);

  const other = new FurnaceCore();
  ELEMENT_NAMES.forEach((element, slot) =>
    other.placeHerb(makeHerb(ELEMENT_NAMES[(slot + 1) % 5]), slot)
  );
  const otherPill = other.generatePill();
  assert.notEqual(otherPill.id, first.id);
  assert.notEqual(otherPill.quality, first.quality);
});

test('槽位未满时拒绝开始炼制', () => {
  const furnace = new FurnaceCore();
  assert.equal(furnace.startRefining(), false);
  furnace.placeHerb(makeHerb('金'), 0);
  assert.equal(furnace.startRefining(), false);
  assert.equal(furnace.isCurrentlyRefining(), false);
});

test('炼制时间完全由注入的 deltaTime 推进，累计满时长恰好完成一次', () => {
  const furnace = new FurnaceCore();
  ELEMENT_NAMES.forEach((element, slot) => furnace.placeHerb(makeHerb(element), slot));
  assert.equal(furnace.startRefining(), true);

  assert.equal(furnace.update(0.5), false);
  assert.equal(furnace.update(0.5), false);
  assert.equal(furnace.update(0.5), false);
  assert.ok(Math.abs(furnace.getRefiningProgress() - 1.5 / REFINING_DURATION_SECONDS) < 1e-9);
  assert.equal(furnace.update(0.5), true, '累计2秒整应恰好完成');
  assert.equal(furnace.isCurrentlyRefining(), false);
  assert.equal(furnace.update(0.5), false, '完成后不应再次触发完成');

  // 单帧大步长同样只完成一次
  const furnace2 = new FurnaceCore();
  ELEMENT_NAMES.forEach((element, slot) => furnace2.placeHerb(makeHerb(element), slot));
  furnace2.startRefining();
  assert.equal(furnace2.update(10), true);
  assert.equal(furnace2.update(10), false);
});

test('reset 清空槽位与颜色，可重新投料', () => {
  const furnace = new FurnaceCore();
  furnace.placeHerb(makeHerb('金'), 0);
  furnace.reset();
  assert.equal(furnace.getCurrentColor(), IDLE_COLOR);
  assert.ok(furnace.getSlots().every(s => s.herb === null && !s.isCorrect));
  assert.deepEqual(furnace.placeHerb(makeHerb('木'), 0), { accepted: true, isCorrect: false });
});

test('炉体颜色与 THREE.Color 管线逐位一致（全部32种正确槽位组合）', () => {
  const threeColorOf = (elements: ElementType[]): number => {
    if (elements.length === 0) return IDLE_COLOR;
    let r = 0, g = 0, b = 0;
    elements.forEach(element => {
      const color = new THREE.Color(ELEMENT_COLORS[element]);
      r += color.r;
      g += color.g;
      b += color.b;
    });
    return new THREE.Color().setRGB(r / elements.length, g / elements.length, b / elements.length).getHex();
  };

  for (let mask = 0; mask < 32; mask++) {
    const elements = ELEMENT_NAMES.filter((_, i) => mask & (1 << i));
    assert.equal(
      computeFurnaceColor(elements),
      threeColorOf(elements),
      `组合 ${elements.join(',') || '(空)'} 的颜色与 THREE 管线不一致`
    );
  }
});

function permute(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  const result: number[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permute(rest)) {
      result.push([item, ...tail]);
    }
  });
  return result;
}
