/**
 * 离线验证入口：不渲染组件，直接驱动研磨/抛光纯逻辑链路。
 *
 * 运行：npm run verify:grinding
 *
 * 覆盖场景：
 *  1. 粗磨（120目）力度超阈值产生划痕，划痕数越界触发受损标记
 *  2. 受损后通过精磨（1200目）与抛光修复划痕并解除受损标记
 *  3. 抛光推进抛光进度并按公式提升反射率
 *  4. 同一份带时刻与力度的输入序列，不同帧率喂入结果完全一致
 *  5. 边界：力度越界、目数为空、重复停止等给出稳定结果
 */
import assert from 'node:assert/strict';
import { GrindingEngine, replay } from '../src/logic/grindingEngine.ts';
import type { EngineSnapshot, GrindingOp } from '../src/logic/grindingEngine.ts';
import { MAX_REFLECTIVITY, MIN_REFLECTIVITY, SCRATCH_THRESHOLD } from '../src/types/index.ts';

const SEED = 20261007;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function grindSequence(
  grit: 120 | 400 | 1200,
  force: number,
  startMs: number,
  endMs: number,
  stepMs: number,
  direction = 90
): GrindingOp[] {
  const ops: GrindingOp[] = [{ type: 'startGrinding', grit, time: startMs }];
  for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
    ops.push({
      type: 'grind',
      time: t,
      force,
      direction,
      position: { x: 0.5, y: 0.5 },
    });
  }
  ops.push({ type: 'stopGrinding', time: endMs + stepMs });
  return ops;
}

function polishSequence(
  force: number,
  startMs: number,
  endMs: number,
  stepMs: number
): GrindingOp[] {
  const ops: GrindingOp[] = [{ type: 'startPolishing', time: startMs }];
  for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
    ops.push({ type: 'polish', time: t, force });
  }
  ops.push({ type: 'stopPolishing', time: endMs + stepMs });
  return ops;
}

function printSteps(label: string, results: ReturnType<typeof replay>): void {
  console.log(`\n== ${label}：每步状态 ==`);
  console.log('step  progress uniformity reflectivity clarity scratches damaged polish');
  results.forEach((r, i) => {
    const s = r.state;
    console.log(
      [
        String(i).padStart(4),
        s.grindingProgress.toFixed(3).padStart(9),
        s.uniformity.toFixed(3).padStart(10),
        s.reflectivity.toFixed(3).padStart(12),
        s.patternClarity.toFixed(3).padStart(8),
        String(s.scratchCount).padStart(9),
        String(s.isDamaged).padStart(8),
        s.polishProgress.toFixed(3).padStart(8),
      ].join(' ')
    );
  });
}

async function feedWithPacing(
  ops: GrindingOp[],
  intervalMs: number
): Promise<EngineSnapshot> {
  const engine = new GrindingEngine(SEED);
  for (const op of ops) {
    engine.step(op);
    if (intervalMs > 0) await sleep(intervalMs);
  }
  return engine.getState();
}

async function main() {
  // 场景 1：粗磨产生划痕并触发受损
  {
    const ops = grindSequence(120, 2, 0, 3000, 50);
    const results = replay(ops, SEED);
    const final = results[results.length - 1].state;
    printSteps('场景1 粗磨(120目, 力度2)', results.filter((_, i) => i % 10 === 0 || i === results.length - 1));
    assert.ok(final.scratchCount >= SCRATCH_THRESHOLD, '粗磨重力度应产生足够划痕');
    assert.equal(final.isDamaged, true, '划痕数越过阈值应触发受损标记');
    const allEvents = results.flatMap((r) => r.events);
    assert.ok(allEvents.some((e) => e.type === 'scratch-added'), '应有划痕事件');
    assert.ok(allEvents.some((e) => e.type === 'damaged'), '应有受损事件');
    // 同种子重放，结果完全一致
    const again = replay(ops, SEED);
    assert.deepEqual(again[again.length - 1].state, final, '同种子重放结果必须一致');
    console.log('场景1 通过：划痕数 =', final.scratchCount, '受损 =', final.isDamaged);
  }

  // 场景 2：受损后修复（精磨 + 抛光）
  {
    const engine = new GrindingEngine(SEED);
    const eventKinds: string[] = [];
    const run = (ops: GrindingOp[]) =>
      ops.forEach((op) => {
        engine.step(op).events.forEach((e) => eventKinds.push(e.type));
      });
    run(grindSequence(120, 2, 0, 3000, 50));
    const damaged = engine.getState();
    assert.equal(damaged.isDamaged, true);

    const fineGrindEventsBefore = eventKinds.filter((k) => k === 'scratch-fixed').length;
    run(grindSequence(1200, 1.2, 4000, 14000, 50));
    const afterFineGrind = engine.getState();
    assert.ok(
      eventKinds.filter((k) => k === 'scratch-fixed').length > fineGrindEventsBefore,
      '精磨阶段应发生划痕修复'
    );

    run(polishSequence(1.5, 15000, 60000, 50));
    const afterPolish = engine.getState();
    assert.equal(afterPolish.scratchCount, 0, '抛光后划痕应被全部修复');
    assert.equal(afterPolish.isDamaged, false, '修复后受损标记应解除');
    console.log(
      '场景2 通过：受损划痕',
      damaged.scratchCount,
      '→ 精磨后',
      afterFineGrind.scratchCount,
      '→ 抛光后',
      afterPolish.scratchCount
    );
  }

  // 场景 3：抛光提升反射率
  {
    const engine = new GrindingEngine(SEED);
    const run = (ops: GrindingOp[]) => ops.map((op) => engine.step(op));
    run(grindSequence(400, 1, 0, 5000, 50));
    const beforePolish = engine.getState();
    run(polishSequence(1.5, 6000, 16000, 50));
    const afterPolish = engine.getState();
    assert.ok(afterPolish.polishProgress > 0, '抛光进度应推进');
    assert.ok(
      afterPolish.reflectivity > beforePolish.reflectivity,
      '抛光应提升反射率'
    );
    const expected = Math.min(
      MAX_REFLECTIVITY,
      MIN_REFLECTIVITY +
        afterPolish.grindingProgress * 0.5 +
        afterPolish.polishProgress * 0.25
    );
    assert.ok(
      Math.abs(afterPolish.reflectivity - expected) < 1e-9,
      '反射率应由研磨进度与抛光进度共同决定'
    );
    console.log(
      '场景3 通过：反射率',
      beforePolish.reflectivity.toFixed(3),
      '→',
      afterPolish.reflectivity.toFixed(3)
    );
  }

  // 场景 4：同一输入序列，不同帧率喂入结果一致
  {
    const ops: GrindingOp[] = [
      ...grindSequence(120, 2, 0, 2000, 40),
      ...grindSequence(400, 1, 3000, 5000, 40),
      ...polishSequence(1.5, 6000, 9000, 40),
    ];
    const pacing = [0, 4, 16];
    const snapshots: EngineSnapshot[] = [];
    for (const interval of pacing) {
      snapshots.push(await feedWithPacing(ops, interval));
    }
    for (let i = 1; i < snapshots.length; i++) {
      assert.deepEqual(
        snapshots[i],
        snapshots[0],
        `喂入间隔 ${pacing[i]}ms 与 ${pacing[0]}ms 的最终状态必须一致`
      );
    }
    // 逐条喂入与一次性批量重放也必须一致
    const batch = replay(ops, SEED);
    assert.deepEqual(
      batch[batch.length - 1].state,
      snapshots[0],
      '批量重放与逐条喂入结果必须一致'
    );
    console.log('场景4 通过：帧率 0/4/16ms 喂入与批量重放最终状态完全一致');
  }

  // 场景 5：边界输入给出稳定结果
  {
    const engine = new GrindingEngine(SEED);
    const initial = engine.getState();

    // 目数为空时研磨：状态不变并给出 ignored 事件
    const noGrit = engine.step({ type: 'grind', time: 100, force: 1, direction: 0 });
    assert.deepEqual(noGrit.state, initial);
    assert.deepEqual(noGrit.events, [{ type: 'ignored', reason: 'no-active-grit' }]);

    // 重复停止：稳定返回 ignored，不抛错、不改状态
    engine.step({ type: 'stopGrinding' });
    const stopAgain = engine.step({ type: 'stopGrinding' });
    assert.deepEqual(stopAgain.events, [{ type: 'ignored', reason: 'not-grinding' }]);
    const stopPolish = engine.step({ type: 'stopPolishing' });
    assert.deepEqual(stopPolish.events, [{ type: 'ignored', reason: 'not-polishing' }]);

    // 未开始抛光时抛光：ignored
    const noPolish = engine.step({ type: 'polish', time: 200, force: 1 });
    assert.deepEqual(noPolish.events, [{ type: 'ignored', reason: 'not-polishing' }]);

    // 力度越界：钳制到 [0, 2] 并记录事件，结果确定
    engine.step({ type: 'startGrinding', grit: 400, time: 0 });
    const clampedHigh = engine.step({ type: 'grind', time: 100, force: 5, direction: 0 });
    assert.ok(clampedHigh.events.some((e) => e.type === 'force-clamped'));
    const reference = new GrindingEngine(SEED);
    reference.step({ type: 'startGrinding', grit: 400, time: 0 });
    const refResult = reference.step({ type: 'grind', time: 100, force: 2, direction: 0 });
    assert.deepEqual(clampedHigh.state, refResult.state, '力度 5 应等价于力度 2');

    const clampedLow = engine.step({ type: 'grind', time: 200, force: -3, direction: 0 });
    assert.ok(clampedLow.events.some((e) => e.type === 'force-clamped'));
    assert.equal(clampedLow.state.grindingProgress, clampedHigh.state.grindingProgress);

    // 无效目数：ignored
    const invalidGrit = engine.step({ type: 'startGrinding', grit: 999 as never, time: 0 });
    assert.deepEqual(invalidGrit.events, [{ type: 'ignored', reason: 'invalid-grit' }]);
    assert.equal(invalidGrit.state.currentGrit, 400, '无效目数不应覆盖当前目数');

    console.log('场景5 通过：力度越界/目数为空/重复停止/无效目数均返回稳定结果');
  }

  console.log('\n全部验证通过 ✔');
}

main().catch((err) => {
  console.error('验证失败:', err);
  process.exit(1);
});
