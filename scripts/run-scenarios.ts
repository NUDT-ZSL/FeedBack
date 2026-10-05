/**
 * 离线批量推演入口（Node ≥ 22，原生运行 TypeScript，无需联网）
 *
 * 用法：
 *   npm run simulate                                  # 跑 scenarios/sample-scenarios.json
 *   npm run simulate -- --input scenarios/xxx.json    # 指定场景文件
 *   npm run simulate -- --out reports/my-report.json  # 指定报告输出路径
 *
 * 覆盖内容：
 *   1. 逐场景整体推演，输出可比较的结论表
 *   2. 同输入重复推演校验（确定性：两次 checksum 必须一致）
 *   3. 增量重算一致性校验（局部调整后只重算受影响部分 == 整体重算）
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createSampleScenario,
  runScenario,
  verifyIncrementalConsistency,
  type ScenarioInput,
  type SimulationCache,
} from '../src/simulation/index.ts';

interface ScenarioFile {
  description?: string;
  scenarios: ScenarioInput[];
}

function parseArgs(argv: string[]): { input: string; out: string } {
  let input = 'scenarios/sample-scenarios.json';
  let out = 'reports/batch-report.json';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[i + 1];
    if (argv[i] === '--out' && argv[i + 1]) out = argv[i + 1];
  }
  return { input, out };
}

function pad(text: string, width: number): string {
  const displayWidth = [...text].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(width - displayWidth, 0));
}

function main(): void {
  const { input, out } = parseArgs(process.argv.slice(2));
  const file = JSON.parse(readFileSync(resolve(input), 'utf-8')) as ScenarioFile;
  if (!Array.isArray(file.scenarios) || file.scenarios.length === 0) {
    throw new Error(`场景文件 ${input} 中没有可推演的场景`);
  }

  let failures = 0;
  const scenarioReports = [];

  console.log(`\n== 批量推演：${file.scenarios.length} 组场景（${input}）==\n`);
  const header = ['场景', '说明', '提水总量', '渠道弃水', '缺水田块数', '缺水田块', '校验和'];
  const widths = [18, 40, 10, 10, 12, 22, 10];
  console.log(header.map((h, i) => pad(h, widths[i])).join(''));

  for (const scenario of file.scenarios) {
    // 确定性校验：同一份输入重复推演两次，结果必须逐字节一致
    const first = runScenario(scenario);
    const second = runScenario(scenario);
    const deterministic = first.checksum === second.checksum;
    if (!deterministic) failures += 1;

    const deficitFields = first.fieldSummaries.filter((s) => s.deficit).map((s) => s.fieldId);
    const row = [
      scenario.id,
      scenario.label,
      first.totals.lifted.toFixed(2),
      first.totals.spilled.toFixed(2),
      String(first.totals.deficitFieldCount),
      deficitFields.length > 0 ? deficitFields.join(',') : '-',
      first.checksum,
    ];
    console.log(row.map((cell, i) => pad(cell, widths[i])).join(''));
    if (!deterministic) {
      console.log(`  ✗ 确定性校验失败：${first.checksum} != ${second.checksum}`);
    }

    scenarioReports.push({
      scenarioId: scenario.id,
      label: scenario.label,
      deterministic,
      checksum: first.checksum,
      totals: first.totals,
      fieldSummaries: first.fieldSummaries,
    });
  }

  // 增量重算一致性：在基准样例上分别施加五类局部调整，
  // 校验“只重算受影响部分”与“整体重算”的结论一致
  console.log('\n== 增量重算一致性校验（基准样例 + 局部调整）==\n');
  const baseInput = createSampleScenario({ id: 'incremental-base' });
  const cache: SimulationCache = { input: baseInput, result: runScenario(baseInput) };

  const mutations: Array<{ name: string; mutate: (draft: ScenarioInput) => void }> = [
    {
      name: '渠道分流比例调整（东支渠 0.40→0.55，西支渠 0.25→0.10）',
      mutate: (draft) => {
        draft.channels[0].shareRatio = 0.55;
        draft.channels[2].shareRatio = 0.1;
      },
    },
    {
      name: '上游来水量变化（100→55）',
      mutate: (draft) => {
        draft.upstreamInflow = 55;
      },
    },
    {
      name: '田块容量调整（东上田 120→70）',
      mutate: (draft) => {
        draft.fields[0].capacity = 70;
      },
    },
    {
      name: '作物需水阈值调整（西下田 50→75）',
      mutate: (draft) => {
        draft.fields[5].cropDemandThreshold = 75;
      },
    },
    {
      name: '水车工况变化（翻车开度 50→90）',
      mutate: (draft) => {
        draft.wheels[0].gateOpening = 90;
      },
    },
  ];

  const incrementalReports = [];
  for (const { name, mutate } of mutations) {
    const check = verifyIncrementalConsistency(cache, mutate);
    const status = check.consistent ? '✓ 一致' : '✗ 不一致';
    if (!check.consistent) failures += 1;
    console.log(
      `  ${status}  ${name}\n         重算渠道=[${check.report.recomputedChannels.join(',') || '无'}] ` +
        `重算田块=[${check.report.recomputedFields.join(',') || '无'}] ` +
        `复用田块=[${check.report.reusedFields.join(',') || '无'}]`,
    );
    incrementalReports.push({
      mutation: name,
      consistent: check.consistent,
      incrementalChecksum: check.incrementalChecksum,
      fullChecksum: check.fullChecksum,
      recomputedChannels: check.report.recomputedChannels,
      recomputedFields: check.report.recomputedFields,
      reusedChannels: check.report.reusedChannels,
      reusedFields: check.report.reusedFields,
    });
  }

  const reportPath = resolve(out);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedBy: 'scripts/run-scenarios.ts',
        source: input,
        scenarioReports,
        incrementalReports,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(`\n报告已写入 ${out}`);

  if (failures > 0) {
    console.error(`\n✗ 共 ${failures} 项校验失败`);
    process.exit(1);
  }
  console.log('\n✓ 全部校验通过：推演确定、增量与整体一致');
}

main();
