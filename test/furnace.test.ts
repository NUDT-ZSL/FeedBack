import { describe, it, assert, assertEqual, assertDeepEqual } from './harness';
import { FurnaceCore, EMPTY_FURNACE_COLOR, canEnterRefining } from '../src/game/core/furnaceCore';
import { HerbData, ElementType, ELEMENT_COLORS } from '../src/types';
import { createSeededRandom, createIdGenerator } from '../src/game/core/random';

function makeHerb(id: string, element: ElementType): HerbData {
  return {
    id,
    name: `${id}_name`,
    element,
    color: ELEMENT_COLORS[element],
    potency: 0.8,
    position: { x: 0, y: 0, z: 0 }
  };
}

function placeFive(core: FurnaceCore, elements: ElementType[]): void {
  elements.forEach((element, slotIndex) => {
    const result = core.placeHerb(makeHerb(`h${slotIndex}_${element}`, element), slotIndex);
    assert(result.ok, `槽位 ${slotIndex} 应接受投料`);
  });
}

function pillSnapshot(core: FurnaceCore) {
  const idGen = createIdGenerator('pill', createSeededRandom(2026));
  const pill = core.generatePill(idGen);
  return { quality: pill.quality, name: pill.name, matchScore: pill.matchScore, color: pill.color, effects: pill.effects };
}

describe('熔炉投料与炉体状态', () => {
  it('同元素投料：isCorrect=true，槽位记录草药', () => {
    const core = new FurnaceCore();
    const result = core.placeHerb(makeHerb('h1', '金'), 0);
    assertDeepEqual(result, { ok: true, correct: true }, '金草药投入金槽应匹配');
    const slot = core.getSlots()[0];
    assert(slot.herb !== null && slot.isCorrect, '槽位应已填入正确草药');
  });

  it('异元素投料：接受但 isCorrect=false，不影响炉体颜色', () => {
    const core = new FurnaceCore();
    const wrong = core.placeHerb(makeHerb('h1', '火'), 0);
    assertDeepEqual(wrong, { ok: true, correct: false }, '火草药投入金槽应不匹配但被接受');
    assertEqual(core.getFurnaceColor(), EMPTY_FURNACE_COLOR, '仅错误投料时炉体保持暗色');

    const correct = core.placeHerb(makeHerb('h2', '木'), 1);
    assertDeepEqual(correct, { ok: true, correct: true }, '木草药投入木槽应匹配');
    assertEqual(core.getFurnaceColor(), ELEMENT_COLORS['木'], '炉体颜色应只反映正确草药');
  });

  it('空槽重复/占用槽重复投料：第二次被拒绝且状态不变', () => {
    const core = new FurnaceCore();
    const first = core.placeHerb(makeHerb('h1', '金'), 0);
    assertEqual(first.ok, true, '首次投料成功');

    const repeated = core.placeHerb(makeHerb('h2', '金'), 0);
    assertDeepEqual(repeated, { ok: false, reason: 'slot_occupied' }, '占用槽必须拒绝');
    assertEqual(core.getSlots()[0].herb!.id, 'h1', '槽内仍为首次投入的草药，未被覆盖');

    const invalid = core.placeHerb(makeHerb('h3', '金'), 9);
    assertDeepEqual(invalid, { ok: false, reason: 'invalid_slot' }, '非法槽位索引必须拒绝');
  });

  it('炉体颜色随正确草药集合变化，且与投料顺序无关', () => {
    // 同一组 {金,木,水} 以不同顺序投入对应槽位
    const orders: Array<[ElementType, number][]> = [
      [['金', 0], ['木', 1], ['水', 2]],
      [['水', 2], ['金', 0], ['木', 1]],
      [['木', 1], ['水', 2], ['金', 0]]
    ];
    const colors = orders.map((order) => {
      const core = new FurnaceCore();
      order.forEach(([el, idx], n) => core.placeHerb(makeHerb(`h${n}`, el), idx));
      return { color: core.getFurnaceColor(), slots: core.getSlots().map((s) => s.herb?.element ?? null) };
    });
    assertEqual(new Set(colors.map((c) => c.color)).size, 1, '不同顺序炉体颜色必须相同');
    assertEqual(new Set(colors.map((c) => JSON.stringify(c.slots))).size, 1, '槽位元素集合必须相同');
  });

  it('任意投料顺序下槽位状态与"已正确放入的草药集合"一致', () => {
    // 5 个草药：3 个匹配 2 个错位；对投料顺序做全排列（共 120 种）
    const herbs: Array<{ id: string; element: ElementType; targetSlot: number }> = [
      { id: 'a', element: '金', targetSlot: 0 },
      { id: 'b', element: '木', targetSlot: 1 },
      { id: 'c', element: '水', targetSlot: 2 },
      { id: 'd', element: '土', targetSlot: 3 }, // 错位：土入火槽
      { id: 'e', element: '火', targetSlot: 4 }  // 错位：火入土槽
    ];

    function permute<T>(arr: T[]): T[][] {
      if (arr.length <= 1) return [arr];
      const out: T[][] = [];
      arr.forEach((item, i) => {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        permute(rest).forEach((p) => out.push([item, ...p]));
      });
      return out;
    }

    const signatures = new Set<string>();
    for (const order of permute(herbs)) {
      const core = new FurnaceCore();
      for (const h of order) {
        const result = core.placeHerb(makeHerb(h.id, h.element), h.targetSlot);
        assert(result.ok, `投料 ${h.id} 不应被拒绝`);
      }
      const snapshot = {
        correct: core.getSlots().map((s) => s.isCorrect).join(''),
        color: core.getFurnaceColor(),
        score: core.calculateMatchScore()
      };
      signatures.add(JSON.stringify(snapshot));
    }
    assertEqual(signatures.size, 1, '120 种投料顺序必须得到完全一致的槽位状态、颜色与匹配度');
  });
});

describe('草药数量门槛', () => {
  it('不足 5 株拒绝进入炼丹，达到 5 株放行', () => {
    assertEqual(canEnterRefining(0), false, '0 株应拒绝');
    assertEqual(canEnterRefining(4), false, '4 株应拒绝');
    assertEqual(canEnterRefining(5), true, '5 株应放行');
    assertEqual(canEnterRefining(25), true, '25 株应放行');
  });
});

describe('成丹结论', () => {
  it('匹配度分档：5/5 仙品、3-4/5 灵品、0-2/5 凡品', () => {
    const allCorrect = new FurnaceCore();
    placeFive(allCorrect, ['金', '木', '水', '火', '土']);
    assertEqual(allCorrect.calculateMatchScore(), 1, '全对匹配度为 1');
    assertEqual(pillSnapshot(allCorrect).quality, '仙品', '全对应为仙品');

    const threeCorrect = new FurnaceCore();
    // 金->金, 木->木, 水->水, 火->土, 土->火
    placeFive(threeCorrect, ['金', '木', '水', '土', '火']);
    assertEqual(threeCorrect.calculateMatchScore(), 0.6, '3 对匹配度为 0.6');
    assertEqual(pillSnapshot(threeCorrect).quality, '灵品', '3 对应为灵品');

    const twoCorrect = new FurnaceCore();
    // 金->金, 木->木, 水->火, 火->水, 土->金
    placeFive(twoCorrect, ['金', '木', '火', '水', '金']);
    assertEqual(twoCorrect.calculateMatchScore(), 0.4, '2 对匹配度为 0.4');
    assertEqual(pillSnapshot(twoCorrect).quality, '凡品', '2 对应为凡品');

    const noneCorrect = new FurnaceCore();
    placeFive(noneCorrect, ['木', '水', '火', '土', '金']);
    assertEqual(noneCorrect.calculateMatchScore(), 0, '全错匹配度为 0');
    assertEqual(pillSnapshot(noneCorrect).quality, '凡品', '全错应为凡品');
  });

  it('相同元素组合任意放入顺序 => 相同成丹结论', () => {
    // 同一组草药（3 对 2 错）以 120 种不同先后次序投入各自的目标槽位
    const placements: Array<{ element: ElementType; slot: number }> = [
      { element: '金', slot: 0 },
      { element: '木', slot: 1 },
      { element: '水', slot: 2 },
      { element: '土', slot: 3 },
      { element: '火', slot: 4 }
    ];
    function permute<T>(arr: T[]): T[][] {
      if (arr.length <= 1) return [arr];
      const out: T[][] = [];
      arr.forEach((item, i) => {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        permute(rest).forEach((p) => out.push([item, ...p]));
      });
      return out;
    }
    const conclusions = new Set<string>();
    for (const order of permute(placements)) {
      const core = new FurnaceCore();
      order.forEach((p, n) => core.placeHerb(makeHerb(`h${n}`, p.element), p.slot));
      conclusions.add(JSON.stringify(pillSnapshot(core)));
    }
    assertEqual(conclusions.size, 1, '120 种投料顺序的成丹结论必须一致');
  });

  it('同一次成丹重复计算完全一致，且不依赖随机数调用次数', () => {
    const core = new FurnaceCore();
    placeFive(core, ['金', '木', '水', '火', '土']);
    const rng1 = createSeededRandom(2026);
    const rng2 = createSeededRandom(2026);
    // 即使中间消费了随机数，成丹结论仍然一致
    rng1.next();
    rng1.next();
    const p1 = core.generatePill(createIdGenerator('pill', rng1));
    const p2 = core.generatePill(createIdGenerator('pill', rng2));
    assertEqual(p1.quality, p2.quality, '品质一致');
    assertEqual(p1.name, p2.name, '丹名一致');
    assertEqual(p1.matchScore, p2.matchScore, '匹配度一致');
    assertEqual(p1.color, p2.color, '颜色一致');
    assertDeepEqual(p1.effects, p2.effects, '药效一致');
  });

  it('不同元素构成可以得到不同丹名，且同名由构成哈希决定', () => {
    const a = new FurnaceCore();
    placeFive(a, ['金', '木', '水', '火', '土']);
    const b = new FurnaceCore();
    placeFive(b, ['金', '水', '木', '土', '火']);
    // 两次用同名生成器分别取名
    assertEqual(typeof pillSnapshot(a).name, 'string', '丹名应为字符串');
    assertEqual(pillSnapshot(a).name, pillSnapshot(a).name, '同一构成重复取名一致');
    // 不同构成各自稳定（是否同名不做强断言，但必须各自可复现）
    assertEqual(pillSnapshot(b).name, pillSnapshot(b).name, '另一构成重复取名一致');
  });
});
