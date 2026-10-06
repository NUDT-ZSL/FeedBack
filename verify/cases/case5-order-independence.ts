/**
 * 风险4：同一批输入在不同导入顺序、不同批次切分下
 * 必须得到相同的回放结论与影响范围（含裁决后结论与各推进时刻）。
 */
import { ReplayEngine } from '../core/engine.ts';
import { canonicalJson, diffConclusion } from '../core/canonical.ts';
import { baseEvents } from '../fixtures/datasets.ts';
import type { ImportInput } from '../core/types.ts';
import { assert, assertEqual, seededRandom, shuffled } from './assert.ts';

export const id = '05-order-batch-independence';
export const category = 'order-batch-independence';

const records = [
  { id: 'r1', objectId: 'obj-A', timestamp: 100, state: 'idle' },
  { id: 'r2', objectId: 'obj-A', timestamp: 200, state: 'moving', dependsOn: ['r1'] },
  { id: 'r2b', objectId: 'obj-A', timestamp: 200, state: 'stopped', dependsOn: ['r1'] },
  { id: 'r3', objectId: 'obj-B', timestamp: 150, state: 'idle' },
  { id: 'r4', objectId: 'obj-B', timestamp: 250, state: 'active', dependsOn: ['r2'] },
  { id: 'r5', objectId: 'obj-C', timestamp: 300, state: 'standby' },
];
const events = baseEvents;

/** 对一组输入执行完整判定链路（含裁决），返回各关键推进时刻的规范化结论。 */
function runPipeline(batches: ImportInput[]): { full: string; t150: string; t200: string; t300: string } {
  const engine = new ReplayEngine(batches);
  engine.adjudicate('obj-A', 200, 'r2');
  const snapshot = (t: number) => canonicalJson(engine.advance(t).conclusion);
  return { full: snapshot(Number.POSITIVE_INFINITY), t150: snapshot(150), t200: snapshot(200), t300: snapshot(300) };
}

/** 按确定性切分点把拍平后的输入切成 k 批。 */
function splitIntoBatches(flatRecords: typeof records, flatEvents: typeof events, k: number, seed: number): ImportInput[] {
  const rand = seededRandom(seed);
  const batches: ImportInput[] = Array.from({ length: k }, () => ({ records: [], events: [] }));
  for (const record of flatRecords) batches[Math.floor(rand() * k)].records!.push(record);
  for (const event of flatEvents) batches[Math.floor(rand() * k)].events!.push(event);
  return batches;
}

export function run(): void {
  const reference = runPipeline([{ records, events }]);
  const variantLabels: string[] = ['单批原始顺序'];

  // 变体 1：单批、多种确定性洗牌
  for (let seed = 1; seed <= 6; seed++) {
    const label = `单批洗牌 seed=${seed}`;
    variantLabels.push(label);
    const result = runPipeline([{ records: shuffled(records, seed * 31), events: shuffled(events, seed * 17) }]);
    for (const key of ['full', 't150', 't200', 't300'] as const) {
      assert(result[key] === reference[key], category, `${label} 在 ${key} 时刻回放结论与基线不一致`);
    }
  }

  // 变体 2：多批次切分（2~4 批，多种切分种子）
  for (const k of [2, 3, 4]) {
    for (let seed = 100; seed <= 103; seed++) {
      const label = `${k}批切分 seed=${seed}`;
      variantLabels.push(label);
      const batches = splitIntoBatches(shuffled(records, seed + 7), shuffled(events, seed + 3), k, seed);
      const result = runPipeline(batches);
      for (const key of ['full', 't150', 't200', 't300'] as const) {
        assert(result[key] === reference[key], category, `${label} 在 ${key} 时刻回放结论与基线不一致`);
      }
    }
  }

  // 变体 3：记录与事件交叉混在同一乱序批次
  const mixed: ImportInput = {
    records: shuffled(records, 999),
    events: shuffled(events, 777),
  };
  const mixedResult = runPipeline([mixed]);
  for (const key of ['full', 't150', 't200', 't300'] as const) {
    assert(mixedResult[key] === reference[key], category, `记录/事件混排批次在 ${key} 时刻结论不一致`);
  }
  variantLabels.push('记录/事件混排');

  // 反向构造一次分歧，确认比对器确实能发现并归因到具体类别
  const engineA = new ReplayEngine([{ records, events }]);
  engineA.adjudicate('obj-A', 200, 'r2');
  const engineB = new ReplayEngine([{ records: shuffled(records, 5), events }]);
  engineB.adjudicate('obj-A', 200, 'r2b'); // 不同胜方 -> 结论应不同
  const section = diffConclusion(engineA.advance().conclusion, engineB.advance().conclusion);
  assert(section !== null, category, '不同裁决必须产生可检测的分歧');
  assertEqual(section, 'timelines', category, '裁决分歧应被归因到 timelines 类别');

  assert(variantLabels.length >= 18, category, `顺序/批次变体数量不足，实际 ${variantLabels.length}`);
}
