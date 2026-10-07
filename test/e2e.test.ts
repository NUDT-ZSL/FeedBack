import { describe, it, assert, assertEqual, assertDeepEqual } from './harness';
import { ValleySimulator } from '../src/game/core/simulator';
import { createSeededRandom } from '../src/game/core/random';
import { createValleyHeightFunction } from '../src/game/core/height';
import { DEFAULT_PLACEMENT_CONFIG } from '../src/game/core/placement';
import { ELEMENT_NAMES, ElementType, HerbData } from '../src/types';

const heightAt = createValleyHeightFunction(100);

function newSim(seed: number): ValleySimulator {
  return new ValleySimulator(createSeededRandom(seed), heightAt, DEFAULT_PLACEMENT_CONFIG);
}

/** 确定性地找到一个五行元素齐全的种子（搜索过程本身固定可复现） */
function seedWithAllElements(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const sim = newSim(seed);
    const elements = new Set(sim.populateTerrain().map((h) => h.data.element));
    if (ELEMENT_NAMES.every((el) => elements.has(el))) return seed;
  }
  throw new Error('未找到五行齐全的种子');
}

function collectAll(sim: ValleySimulator): void {
  for (const herb of sim.getHerbs()) {
    if (herb.collected) continue;
    const p = herb.data.position;
    const got = sim.moveAndCollect(p.x, p.y, p.z, 1.5);
    assert(got !== null, `走到草药位置必然采到 ${herb.data.id}`);
  }
}

function pickMatchingSet(sim: ValleySimulator): HerbData[] {
  const basket = sim.getBasket();
  const picked: HerbData[] = [];
  for (const element of ELEMENT_NAMES) {
    const found = basket.find((h) => h.element === element && !picked.includes(h));
    assert(found, `药篓中应有 ${element} 元素草药`);
    picked.push(found!);
  }
  return picked;
}

interface PipelineResult {
  herbs: HerbData[];
  collectedCount: number;
  basketAfter: Array<{ id: string; element: ElementType }>;
  slots: Array<{ element: ElementType; hasHerb: boolean; isCorrect: boolean }>;
  furnaceColor: number;
  pill: { id: string; name: string; quality: string; matchScore: number; color: number };
}

/** 用固定脚本跑完整链路：生成 -> 全采集 -> 每种元素选一株 -> 按给定槽位顺序投料 -> 成丹 */
function runPipeline(seed: number, slotOrder: number[]): PipelineResult {
  const sim = newSim(seed);
  const herbs = sim.populateTerrain();
  collectAll(sim);
  const enter = sim.tryEnterRefining();
  assertEqual(enter, true, '采集 25 株后应能进入炼丹');

  const set = pickMatchingSet(sim);
  for (const slotIndex of slotOrder) {
    const herb = set[slotIndex];
    const result = sim.placeHerb(herb.id, slotIndex);
    assertEqual(result.accepted, true, `草药 ${herb.id} 投入槽 ${slotIndex} 应被接受`);
    assertEqual(result.placeResult.ok && result.placeResult.correct, true, '同元素投料应正确匹配');
  }

  const pill = sim.completeRefining();
  return {
    herbs: herbs.map((h) => h.data),
    collectedCount: sim.getHerbs().filter((h) => h.collected).length,
    basketAfter: sim.getBasket().map((h) => ({ id: h.id, element: h.element })),
    slots: sim.getSlots().map((s) => ({ element: s.element, hasHerb: s.herb !== null, isCorrect: s.isCorrect })),
    furnaceColor: sim.getFurnaceColor(),
    pill: { id: pill.id, name: pill.name, quality: pill.quality, matchScore: pill.matchScore, color: pill.color }
  };
}

describe('端到端确定性链路', () => {
  const seed = seedWithAllElements();

  it('正常路径：生成25株 -> 全部采集 -> 五行各一株投料 -> 仙品成丹', () => {
    const result = runPipeline(seed, [0, 1, 2, 3, 4]);
    assertEqual(result.herbs.length, 25, '地形必须有 25 株草药');
    assertEqual(result.collectedCount, 25, '必须全部可采集');
    assertEqual(result.basketAfter.length, 20, '投料消耗 5 株，药篓余 20 株');
    assert(result.slots.every((s) => s.hasHerb && s.isCorrect), '五个槽位均应正确匹配');
    assertEqual(result.pill.quality, '仙品', '五行全对应成仙品');
    assertEqual(result.pill.matchScore, 1, '匹配度为 1');
  });

  it('同输入完全复现：两次运行各阶段数据逐字节一致', () => {
    const a = runPipeline(seed, [0, 1, 2, 3, 4]);
    const b = runPipeline(seed, [0, 1, 2, 3, 4]);
    assertDeepEqual(a, b, '同种子同脚本两次运行必须完全一致');
  });

  it('成丹结论与投料顺序无关：所有投料排列得到相同结论', () => {
    const orders: number[][] = [
      [0, 1, 2, 3, 4],
      [4, 3, 2, 1, 0],
      [2, 0, 4, 1, 3],
      [3, 1, 4, 0, 2]
    ];
    const conclusions = new Set(
      orders.map((order) => JSON.stringify(runPipeline(seed, order).pill))
    );
    assertEqual(conclusions.size, 1, '不同投料顺序的成丹结论必须完全一致');

    // 炉体颜色与槽位状态也必须一致
    const states = new Set(
      orders.map((order) => {
        const r = runPipeline(seed, order);
        return JSON.stringify({ slots: r.slots, color: r.furnaceColor });
      })
    );
    assertEqual(states.size, 1, '不同投料顺序的炉体状态必须完全一致');
  });

  it('草药数量不足时进入炼丹被拒绝，补齐后放行', () => {
    const sim = newSim(seed);
    sim.populateTerrain();
    const herbs = sim.getHerbs();
    for (let i = 0; i < 3; i++) {
      const p = herbs[i].data.position;
      sim.moveAndCollect(p.x, p.y, p.z, 1.5);
    }
    assertEqual(sim.tryEnterRefining(), false, '仅 3 株应拒绝进入炼丹');
    assert(/至少需要/.test(sim.getRefusalReason() ?? ''), '拒绝原因应明确说明数量要求');

    for (let i = 3; i < 5; i++) {
      const p = herbs[i].data.position;
      sim.moveAndCollect(p.x, p.y, p.z, 1.5);
    }
    assertEqual(sim.tryEnterRefining(), true, '补齐到 5 株应放行');
  });

  it('异元素投料：被接受但标记错误，草药从药篓消耗，炉色不变', () => {
    const sim = newSim(seed);
    sim.populateTerrain();
    collectAll(sim);
    sim.tryEnterRefining();

    const fireHerb = sim.getBasket().find((h) => h.element === '火')!;
    const beforeBasket = sim.getBasket().length;
    const result = sim.placeHerb(fireHerb.id, 0); // 火投入金槽
    assertDeepEqual(result.placeResult, { ok: true, correct: false }, '异元素应被接受但不匹配');
    assertEqual(sim.getBasket().length, beforeBasket - 1, '草药必须从药篓消耗，不能重复投放');
    assertEqual(sim.getFurnaceColor(), 0x333333, '全错时炉体保持暗色');
    assertDeepEqual(
      sim.getSlots()[0],
      { element: '金', herb: fireHerb, isCorrect: false },
      '槽位应记录这株错误草药'
    );
  });

  it('占用槽重复投料：被拒绝，草药仍在药篓，炉体状态不变', () => {
    const sim = newSim(seed);
    sim.populateTerrain();
    collectAll(sim);
    sim.tryEnterRefining();

    const metal = sim.getBasket().find((h) => h.element === '金')!;
    sim.placeHerb(metal.id, 0);
    const colorAfterFirst = sim.getFurnaceColor();
    const basketAfterFirst = sim.getBasket().length;

    const another = sim.getBasket().find((h) => h.id !== metal.id)!;
    const repeat = sim.placeHerb(another.id, 0);
    assertDeepEqual(repeat.placeResult, { ok: false, reason: 'slot_occupied' }, '占用槽必须拒绝');
    assertEqual(sim.getBasket().length, basketAfterFirst, '被拒绝的草药不应消耗');
    assertEqual(sim.getFurnaceColor(), colorAfterFirst, '炉体颜色必须不变');
    assertEqual(sim.getSlots()[0].herb!.id, metal.id, '槽内仍是第一株草药');
  });

  it('未填满五行槽时不允许成丹', () => {
    const sim = newSim(seed);
    sim.populateTerrain();
    collectAll(sim);
    sim.tryEnterRefining();
    const metal = sim.getBasket().find((h) => h.element === '金')!;
    sim.placeHerb(metal.id, 0);
    let threw = false;
    try {
      sim.completeRefining();
    } catch {
      threw = true;
    }
    assert(threw, '槽未满时成丹必须报错');
  });

  it('不同种子通常得到不同地形与分布（验证种子确实驱动差异）', () => {
    const a = newSim(seed);
    const aHerbs = a.populateTerrain().map((h) => h.data);
    const otherSeed = seed === 1 ? 2 : 1;
    const b = newSim(otherSeed);
    const bHerbs = b.populateTerrain().map((h) => h.data);
    assert(JSON.stringify(aHerbs) !== JSON.stringify(bHerbs), '不同种子的分布应有差异');
  });
});
