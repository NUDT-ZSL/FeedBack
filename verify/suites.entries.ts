/** 套件四：跨入口一致性 —— 同一批数据从任一入口触发，结论逐字节一致 */
import { canonicalDiff, canonicalEquals } from '../src/scheduling/canonical.ts';
import { FULL_ENTRIES } from '../src/scheduling/entries.ts';
import {
  capabilityGapInput,
  cycleInput,
  isolatedChainsInput,
  loomIdTieInput,
  missingRefInput,
  normalInput,
  priorityOverEarliestInput,
  releaseGatedInput,
  tightChainInput,
} from './fixtures/index.ts';
import { assert, check, suite } from './lib/harness.ts';

suite('跨入口一致性');

const datasets: { name: string; input: (typeof normalInput) }[] = [
  { name: '正常数据集', input: normalInput },
  { name: '单机紧凑链', input: tightChainInput },
  { name: '织机id决胜', input: loomIdTieInput },
  { name: '投料门控', input: releaseGatedInput },
  { name: '优先级压空档', input: priorityOverEarliestInput },
  { name: '隔离链', input: isolatedChainsInput },
  { name: '依赖闭环(失败)', input: cycleInput },
  { name: '指向缺失(失败)', input: missingRefInput },
  { name: '能力缺口(失败)', input: capabilityGapInput },
];

for (const { name, input } of datasets) {
  check(`数据集「${name}」：${FULL_ENTRIES.length} 个入口结论一致`, () => {
    const results = FULL_ENTRIES.map((entry) => ({ entry, result: entry.fn(input) }));
    const [first, ...rest] = results;
    for (const other of rest) {
      assert(
        canonicalEquals(first.result, other.result),
        `入口「${first.entry.name}」与「${other.entry.name}」结论不一致：\n  ${canonicalDiff(first.result, other.result)}`,
      );
    }
  });
}
