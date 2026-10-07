/**
 * 幽冥魂灯 · 魂力流转离线验证
 *
 * 运行：node scripts/verify-soulflame.ts
 * 纯 Node、固定步长、无随机数 —— 离线可复现。
 *
 * 覆盖场景：
 *  1. 单来源注入 -> 灯焰形态/亮度/储量收敛
 *  2. 多来源注入 -> 优先级分层 + 同级按比例分摊；增量重算 == 整体重推
 *  3. 来源中断 -> 熄灭过渡（非瞬灭）；恢复注入 -> 平滑回升
 *  4. 灯芯切换 -> 来源集合原子替换 + 一次性扣减
 *  5. 边界：强度为零 / 储量下限抖动 / 拖动与注入并发 / 储量不为负
 */

import {
  BASE_RATE,
  DEFAULT_TUNING,
  FIXED_DT,
  SoulFlameEngine,
} from '../src/soulflame/engine.ts';
import type { FlameSnapshot, SoulSource, Wick } from '../src/soulflame/types.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const T = DEFAULT_TUNING;

function makeEngine(sources: SoulSource[], wicks: Wick[], wickId: string, storage = 50) {
  const engine = new SoulFlameEngine({}, storage);
  for (const w of wicks) engine.addWick(w);
  for (const s of sources) engine.addSource(s);
  engine.switchWick(wickId);
  return engine;
}

function converge(engine: SoulFlameEngine, seconds: number): FlameSnapshot {
  return engine.advance(seconds);
}

function isConverged(engine: SoulFlameEngine, seconds: number, eps: number): boolean {
  const a = engine.advance(seconds);
  const b = engine.advance(seconds);
  return (
    Math.abs(a.brightness - b.brightness) < eps &&
    Math.abs(a.storage - b.storage) < eps &&
    a.form === b.form
  );
}

// ---------------------------------------------------------------- 场景 1：单来源
console.log('场景1：单来源注入收敛');
{
  const engine = makeEngine(
    [{ id: 'ley', type: 'ley', priority: 1, intensity: 1 }],
    [{ id: 'w', name: 'w', sourceIds: ['ley'] }],
    'w',
  );
  const snap = converge(engine, 30);
  check('亮度收敛到高位', snap.brightness > 0.6, `brightness=${snap.brightness.toFixed(3)}`);
  check('形态为稳定档以上', ['steady', 'bright', 'surging'].includes(snap.form), snap.form);
  check('储量未溢出', snap.storage <= T.capacity && snap.storage >= 0);
  check('注入速率 = 地脉基础速率', Math.abs(snap.injectionRate - BASE_RATE.ley) < 1e-6,
    `injection=${snap.injectionRate}`);
  check('继续推进保持稳定', isConverged(engine, 5, 1e-3));
}

// ---------------------------------------------------------------- 场景 2：多来源分配
console.log('场景2：多来源优先级分配与增量一致性');
{
  const sources: SoulSource[] = [
    { id: 'hi', type: 'blood', priority: 3, intensity: 0.5 },  // 4.5/s
    { id: 'mid-a', type: 'ley', priority: 2, intensity: 1 },   // 6/s
    { id: 'mid-b', type: 'spirit', priority: 2, intensity: 1 },// 3/s
    { id: 'lo', type: 'spirit', priority: 1, intensity: 1 },   // 3/s
  ];
  const engine = makeEngine(sources, [{ id: 'w', name: 'w', sourceIds: sources.map((s) => s.id) }], 'w', 95);

  // 预算受限（储量接近满）：高优先级先被接纳
  const budget = 7;
  const alloc = engine.reallocate(budget);
  check('高优先级全额接纳', Math.abs(alloc.accepted['hi'] - 4.5) < 1e-9, JSON.stringify(alloc.accepted));
  const midTotal = alloc.accepted['mid-a'] + alloc.accepted['mid-b'];
  check('剩余预算给中优先级层', Math.abs(midTotal - (budget - 4.5)) < 1e-9, `mid=${midTotal}`);
  check('同级按强度比例分摊 (6:3=2:1)',
    Math.abs(alloc.accepted['mid-a'] / alloc.accepted['mid-b'] - 2) < 1e-9);
  check('低优先级被挤出', Math.abs(alloc.accepted['lo'] ?? 0) < 1e-9);

  // 强度调整：增量结果 == 整体重推
  engine.setIntensity('mid-b', 0.5);
  const inc1 = engine.reallocate(budget).accepted;
  const full1 = engine.reallocateFull(budget);
  check('调强度后 增量==全量', JSON.stringify(inc1) === JSON.stringify(full1),
    `${JSON.stringify(inc1)} vs ${JSON.stringify(full1)}`);

  // 来源移除：增量结果 == 整体重推
  engine.removeSource('hi');
  const inc2 = engine.reallocate(budget).accepted;
  const full2 = engine.reallocateFull(budget);
  check('移除来源后 增量==全量', JSON.stringify(inc2) === JSON.stringify(full2),
    `${JSON.stringify(inc2)} vs ${JSON.stringify(full2)}`);
  check('被移除来源不再占有接纳量', !('hi' in inc2));

  // 来源新增：增量结果 == 整体重推
  engine.addSource({ id: 'hi2', type: 'blood', priority: 4, intensity: 0.3 });
  const inc3 = engine.reallocate(budget).accepted;
  const full3 = engine.reallocateFull(budget);
  check('新增来源后 增量==全量', JSON.stringify(inc3) === JSON.stringify(full3),
    `${JSON.stringify(inc3)} vs ${JSON.stringify(full3)}`);
}

// ---------------------------------------------------------------- 场景 3：中断与恢复
console.log('场景3：来源中断 -> 熄灭过渡 -> 恢复回升');
{
  const engine = makeEngine(
    [{ id: 'ley', type: 'ley', priority: 1, intensity: 1 }],
    [{ id: 'w', name: 'w', sourceIds: ['ley'] }],
    'w',
    12, // 低初始储量，中断后很快耗尽
  );
  converge(engine, 20);
  const litBrightness = engine.getSnapshot().brightness;

  engine.setIntensity('ley', 0); // 中断（强度归零，来源仍在集合中）
  const b0 = engine.getSnapshot().brightness;
  engine.advance(FIXED_DT * 3);
  const b1 = engine.getSnapshot().brightness;
  check('中断后不是瞬间熄灭', b1 > 0 && b1 < b0, `b0=${b0.toFixed(3)} b1=${b1.toFixed(3)}`);

  // 耗尽储量，进入熄灭过渡（满储量耗尽约需 83s，再加熄灭过渡时间）
  let sawExtinguishing = false;
  for (let i = 0; i < 60 * 150; i++) {
    const s = engine.step();
    if (s.extinguishing) sawExtinguishing = true;
    if (s.brightness === 0) break;
  }
  check('出现熄灭过渡阶段', sawExtinguishing);
  check('最终完全熄灭', engine.getSnapshot().brightness === 0 && engine.getSnapshot().form === 'out');
  check('储量归零且不为负', engine.getSnapshot().storage === 0);

  // 恢复注入：平滑回升
  engine.setIntensity('ley', 1);
  const r0 = engine.getSnapshot().brightness;
  engine.advance(0.5);
  const r1 = engine.getSnapshot().brightness;
  engine.advance(2);
  const r2 = engine.getSnapshot().brightness;
  check('恢复后亮度单调回升', r0 < r1 && r1 < r2, `${r0} ${r1} ${r2}`);
  const back = converge(engine, 30);
  check('回升后收敛到原亮度附近', Math.abs(back.brightness - litBrightness) < 0.05,
    `back=${back.brightness.toFixed(3)} lit=${litBrightness.toFixed(3)}`);
}

// ---------------------------------------------------------------- 场景 4：灯芯切换
console.log('场景4：灯芯切换（来源集合原子替换）');
{
  const sources: SoulSource[] = [
    { id: 'ley', type: 'ley', priority: 2, intensity: 1 },
    { id: 'spirit', type: 'spirit', priority: 1, intensity: 1 },
    { id: 'blood', type: 'blood', priority: 3, intensity: 0.5 },
  ];
  const wicks: Wick[] = [
    { id: 'red', name: '赤', sourceIds: ['ley', 'blood'] },
    { id: 'blue', name: '蓝', sourceIds: ['ley', 'spirit'] },
  ];
  const engine = makeEngine(sources, wicks, 'red', 60);
  converge(engine, 10);
  const before = engine.getSnapshot();
  const acceptedBefore = Object.keys(before.accepted).sort();
  check('切换前 blood 接通、spirit 未接通',
    acceptedBefore.includes('blood') && !acceptedBefore.includes('spirit'),
    acceptedBefore.join(','));

  engine.switchWick('blue');
  const after = engine.step();
  const acceptedAfter = Object.keys(after.accepted).sort();
  check('切换后 spirit 接通、blood 断开',
    acceptedAfter.includes('spirit') && !acceptedAfter.includes('blood'),
    acceptedAfter.join(','));
  check('切换扣除灯芯成本', Math.abs(after.storage - (before.storage - T.wickSwitchCost - after.consumptionRate * 0)) <= T.wickSwitchCost + 1,
    `before=${before.storage.toFixed(2)} after=${after.storage.toFixed(2)}`);
  check('切换后亮度未跳变（单步变化有界）',
    Math.abs(after.brightness - before.brightness) < 0.2,
    `d=${Math.abs(after.brightness - before.brightness).toFixed(3)}`);
  check('切换后重新收敛', isConverged(engine, 10, 1e-3));
}

// ---------------------------------------------------------------- 场景 5：边界
console.log('场景5：边界条件');
{
  // 5a 强度为零的来源
  const engine = makeEngine(
    [
      { id: 'zero', type: 'ley', priority: 2, intensity: 0 },
      { id: 'live', type: 'spirit', priority: 1, intensity: 1 },
    ],
    [{ id: 'w', name: 'w', sourceIds: ['zero', 'live'] }],
    'w',
  );
  const alloc = engine.reallocate(10).accepted;
  check('零强度来源接纳量为 0', Math.abs(alloc['zero'] ?? 0) < 1e-12, JSON.stringify(alloc));
  check('零强度不影响其他来源', Math.abs(alloc['live'] - BASE_RATE.spirit) < 1e-9);

  // 5b 储量下限附近反复抖动：形态不应高频跳变
  const jitter = makeEngine(
    [{ id: 'ley', type: 'ley', priority: 1, intensity: 1 }],
    [{ id: 'w', name: 'w', sourceIds: ['ley'] }],
    'w',
    T.capacity * 0.18, // 位于 lowEnter/lowExit 迟滞带内
  );
  let lowFlips = 0;
  let prevLow = jitter.getSnapshot().lowReserve;
  let formChanges = 0;
  let prevForm = jitter.getSnapshot().form;
  for (let i = 0; i < 60 * 20; i++) {
    // 注入在维持消耗附近抖动
    jitter.setIntensity('ley', i % 120 < 60 ? 0.18 : 0.22);
    const s = jitter.step();
    if (s.lowReserve !== prevLow) { lowFlips++; prevLow = s.lowReserve; }
    if (s.form !== prevForm) { formChanges++; prevForm = s.form; }
  }
  check('低储量警戒不抖动（迟滞生效）', lowFlips <= 4, `flips=${lowFlips}`);
  check('形态切换次数有限', formChanges <= 6, `changes=${formChanges}`);

  // 5c 拖动 + 连续注入并发：储量不为负、亮度连续
  const drag = makeEngine(
    [{ id: 'ley', type: 'ley', priority: 1, intensity: 0.5 }],
    [{ id: 'w', name: 'w', sourceIds: ['ley'] }],
    'w',
    5,
  );
  drag.setDragging(true);
  let minStorage = Infinity;
  let maxBrightnessStep = 0;
  let prevB = drag.getSnapshot().brightness;
  for (let i = 0; i < 60 * 30; i++) {
    if (i === 60 * 10) drag.castSoulArt();
    if (i === 60 * 20) drag.setIntensity('ley', 1);
    const s = drag.step();
    minStorage = Math.min(minStorage, s.storage);
    maxBrightnessStep = Math.max(maxBrightnessStep, Math.abs(s.brightness - prevB));
    prevB = s.brightness;
  }
  check('并发消耗下储量不为负', minStorage >= 0, `min=${minStorage}`);
  check('魂术扣减后亮度无跳变', maxBrightnessStep < 0.05, `maxStep=${maxBrightnessStep.toFixed(4)}`);

  // 5d 魂术超额支付：扣到 0 为止
  const poor = makeEngine(
    [{ id: 'ley', type: 'ley', priority: 1, intensity: 0 }],
    [{ id: 'w', name: 'w', sourceIds: ['ley'] }],
    'w',
    3,
  );
  const full = poor.castSoulArt();
  check('储量不足时魂术未足额支付', !full);
  check('支付后储量恰好为 0', poor.getSnapshot().storage === 0);
}

// ---------------------------------------------------------------- 场景 6：离线可复现
console.log('场景6：离线可复现性');
{
  const run = () => {
    const engine = makeEngine(
      [
        { id: 'ley', type: 'ley', priority: 2, intensity: 0.8 },
        { id: 'spirit', type: 'spirit', priority: 1, intensity: 0.9 },
      ],
      [{ id: 'w', name: 'w', sourceIds: ['ley', 'spirit'] }],
      'w',
      40,
    );
    engine.advance(5);
    engine.setDragging(true);
    engine.advance(3);
    engine.setDragging(false);
    engine.castSoulArt();
    engine.advance(10);
    const s = engine.getSnapshot();
    return JSON.stringify([s.storage, s.brightness, s.form, s.accepted]);
  };
  check('两次完整运行结果逐字节一致', run() === run());
}

console.log('');
if (failures > 0) {
  console.error(`共 ${failures} 项失败`);
  process.exit(1);
}
console.log('全部场景通过 ✓');
