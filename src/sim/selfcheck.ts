/**
 * 一致性自检：对配置施加一系列扰动（逐波参数调整 + 全局参数调整），
 * 每次分别用「增量重推」与「整体重推」计算结果，断言两者完全一致。
 * 用于验证"只重算受影响时间区间"与"整体重推"的结论等价。
 */
import { IncrementalRunner, IncrementalOutcome } from './incremental.js';
import { SimConfig, SimResult } from './types.js';

export interface CheckCase {
  name: string;
  pass: boolean;
  affectedFromMs: number;
  reusedUntilMs: number;
  recomputedRangeMs: [number, number];
}

export interface CheckReport {
  allPassed: boolean;
  caseCount: number;
  cases: CheckCase[];
}

interface Mutation {
  name: string;
  mutate: (config: SimConfig) => void;
}

export function selfCheck(config: SimConfig): CheckReport {
  const mutations: Mutation[] = [];

  config.waves.forEach((wave, i) => {
    mutations.push({
      name: `wave-${i + 1}-enemyCount+1`,
      mutate: c => {
        c.waves[i].enemyCount += 1;
      }
    });
    mutations.push({
      name: `wave-${i + 1}-spawnInterval-200`,
      mutate: c => {
        c.waves[i].spawnIntervalMs = Math.max(100, c.waves[i].spawnIntervalMs - 200);
      }
    });
    mutations.push({
      name: `wave-${i + 1}-armorChance`,
      mutate: c => {
        c.waves[i].armorChance = wave.armorChance >= 0.5 ? 0 : wave.armorChance + 0.15;
      }
    });
  });

  mutations.push({
    name: 'global-maxEnergy-10',
    mutate: c => {
      c.maxEnergy = Math.max(10, c.maxEnergy - 10);
    }
  });
  if (config.killPolicy.type === 'interval') {
    const everyMs = config.killPolicy.everyMs;
    mutations.push({
      name: 'global-killInterval-half',
      mutate: c => {
        c.killPolicy = { type: 'interval', everyMs: Math.max(50, Math.floor(everyMs / 2)) };
      }
    });
  }

  const runner = new IncrementalRunner();
  runner.runFull(structuredClone(config), 'base');

  const cases: CheckCase[] = [];
  for (const m of mutations) {
    const mutated = structuredClone(config);
    m.mutate(mutated);

    const incremental: IncrementalOutcome = runner.applyChange(
      structuredClone(mutated),
      'incremental'
    );

    const freshRunner = new IncrementalRunner();
    const full: SimResult = freshRunner.runFull(structuredClone(mutated), 'incremental');

    const pass = JSON.stringify(incremental.result) === JSON.stringify(full);
    cases.push({
      name: m.name,
      pass,
      affectedFromMs: incremental.affectedFromMs,
      reusedUntilMs: incremental.reusedUntilMs,
      recomputedRangeMs: incremental.recomputedRangeMs
    });
  }

  return { allPassed: cases.every(c => c.pass), caseCount: cases.length, cases };
}
