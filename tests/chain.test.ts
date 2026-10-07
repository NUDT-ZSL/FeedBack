import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHerbPositions, HERB_COUNT } from '../src/core/terrain';
import { createHerbData } from '../src/core/herbs';
import { createSeededRandom } from '../src/core/random';
import { AlchemySession } from '../src/core/session';
import { ELEMENT_NAMES, ELEMENT_COLORS } from '../src/types';
import type { ElementType, HerbData, PillData } from '../src/types';
import { TerrainGenerator } from '../src/game/TerrainGenerator';

const SIZE = 100;

/** 与 TerrainGenerator 相同的顺序：先落点、再逐株生成草药数据。 */
function buildValley(seed: number): { positions: unknown[]; herbs: HerbData[] } {
  const random = createSeededRandom(seed);
  const positions = generateHerbPositions(HERB_COUNT, SIZE, random);
  const herbs = positions.map((p, i) => createHerbData(p, random, `herb_${i}`));
  return { positions, herbs };
}

/** 每种元素各取一株；采集结果缺少某元素时用固定样例补足（确定性替代）。 */
function pickOnePerElement(session: AlchemySession): Map<ElementType, string> {
  const chosen = new Map<ElementType, string>();
  for (const element of ELEMENT_NAMES) {
    const found = session.getBasket().find(h => h.element === element);
    if (found) {
      chosen.set(element, found.id);
    } else {
      const fixed: HerbData = {
        id: `fixed_${element}`,
        name: `固定样例_${element}`,
        element,
        color: ELEMENT_COLORS[element],
        potency: 0.75,
        position: { x: 0, y: 0, z: 0 }
      };
      session.collect(fixed);
      chosen.set(element, fixed.id);
    }
  }
  return chosen;
}

interface ChainResult {
  positions: unknown[];
  herbs: HerbData[];
  pill: PillData | null;
  completionTick: number;
  basketAfter: string[];
}

/**
 * 完整链路：地形生成 → 采集 → 投料（含拒绝路径）→ 炼丹 → 成丹。
 * feedOrder 为槽位投放顺序；wrongSlot 非空时先向该槽位投入异元素草药。
 */
function runChain(seed: number, feedOrder: number[], deltas: number[], wrongSlot: number | null): ChainResult {
  const { positions, herbs } = buildValley(seed);
  assert.equal(herbs.length, HERB_COUNT);

  const session = new AlchemySession();

  // 采集前 4 株时必须被拒绝进入炼丹
  herbs.slice(0, 4).forEach(h => session.collect(h));
  assert.equal(session.canEnterRefining(), false, '4株草药必须被拒绝进入炼丹');
  herbs.slice(4).forEach(h => session.collect(h));
  assert.equal(session.canEnterRefining(), true);

  // 拒绝路径：药篓中不存在的草药
  assert.equal(session.dropHerbToSlot('no_such_herb', 0), false);

  const chosen = pickOnePerElement(session);

  // 拒绝路径：异元素投料（占用 wrongSlot 槽位但不匹配）
  if (wrongSlot !== null) {
    const wrongElement = ELEMENT_NAMES[(wrongSlot + 1) % 5];
    const wrongHerb = session
      .getBasket()
      .find(h => h.element === wrongElement && h.id !== chosen.get(wrongElement));
    if (wrongHerb) {
      assert.equal(session.dropHerbToSlot(wrongHerb.id, wrongSlot), false, '异元素投料应返回不匹配');
      assert.ok(session.getBasket().some(h => h.id === wrongHerb.id), '异元素草药必须留在药篓');
    }
  }

  // 按指定顺序投料；每次正确投料后尝试向已占用槽位重复投料
  let repeatRejected = 0;
  for (const slot of feedOrder) {
    const element = ELEMENT_NAMES[slot];
    const herbId = chosen.get(element)!;
    const isCorrect = session.dropHerbToSlot(herbId, slot);
    if (wrongSlot === slot) {
      assert.equal(isCorrect, false, '槽位已被异元素草药占用，正确草药应被拒绝');
    } else {
      assert.equal(isCorrect, true, `槽位${slot}(${element})同元素投料应成功`);
      const another = session.getBasket()[0];
      if (another && session.dropHerbToSlot(another.id, slot) === false) {
        repeatRejected += 1;
      }
    }
  }
  assert.ok(repeatRejected > 0, '重复投料必须被拒绝且草药留在药篓');

  assert.equal(session.isRefining(), true, '五个槽位放满后应自动开始炼制');

  // 注入固定时间步推进炼制
  let pill: PillData | null = null;
  let completionTick = -1;
  deltas.forEach((delta, tick) => {
    const result = session.update(delta);
    if (result) {
      assert.equal(pill, null, '丹药只能生成一次');
      pill = result;
      completionTick = tick;
    }
  });
  assert.ok(pill, '推进满炼制时长后必须成丹');

  return {
    positions,
    herbs,
    pill,
    completionTick,
    basketAfter: session.getBasket().map(h => h.id).sort()
  };
}

const ALL_SLOTS = [0, 1, 2, 3, 4];
const STEP_01 = Array.from({ length: 20 }, () => 0.1);
const STEP_04 = Array.from({ length: 5 }, () => 0.4);

test('端到端：相同种子与输入两次运行结果逐字节一致', () => {
  const a = runChain(2024, ALL_SLOTS, STEP_01, null);
  const b = runChain(2024, ALL_SLOTS, STEP_01, null);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.pill!.quality, '仙品');
  assert.equal(a.pill!.matchScore, 1);
  assert.equal(a.completionTick, 19, '0.1秒×20步应恰好第20步成丹');
});

test('端到端：投料顺序与时间步长不影响成丹结论', () => {
  const orders = [ALL_SLOTS, [4, 3, 2, 1, 0], [2, 0, 4, 1, 3]];
  const pills = orders.map(order => runChain(777, order, STEP_01, null).pill);
  pills.forEach(pill => assert.deepEqual(pill, pills[0]));

  const coarse = runChain(777, ALL_SLOTS, STEP_04, null);
  assert.deepEqual(coarse.pill, pills[0], '0.4秒×5步与0.1秒×20步必须得到相同丹药');
  assert.equal(coarse.completionTick, 4);
});

test('端到端：异元素投料占用槽位后结论仍为确定性的灵品', () => {
  const a = runChain(555, ALL_SLOTS, STEP_01, 2);
  const b = runChain(555, [3, 1, 4, 0, 2], STEP_01, 2);
  assert.deepEqual(a.pill, b.pill);
  assert.equal(a.pill!.quality, '灵品');
  assert.equal(a.pill!.matchScore, 0.8);
});

test('端到端：不同种子产生不同的草药分布', () => {
  const a = runChain(1, ALL_SLOTS, STEP_01, null);
  const b = runChain(2, ALL_SLOTS, STEP_01, null);
  assert.notDeepEqual(a.positions, b.positions);
});

test('TerrainGenerator 注入相同种子时草药落点与数据完全一致', () => {
  const run = () => {
    const generator = new TerrainGenerator(100, 64, createSeededRandom(88));
    const data = generator.generate();
    return {
      positions: data.herbPositions.map(p => ({ x: p.x, y: p.y, z: p.z })),
      herbs: data.herbs.map(h => h.getData())
    };
  };

  const a = run();
  const b = run();
  assert.equal(a.herbs.length, HERB_COUNT, '地形生成的草药数量必须恰好为25');
  assert.deepEqual(a, b);
});
