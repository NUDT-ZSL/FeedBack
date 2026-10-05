/**
 * 统一批量入口（离线）：
 *   npm run simulate -- --input <配置目录|配置文件> --out <输出目录> [--check]
 *
 * 对输入目录中的每个 *.json 配置执行确定性推演，输出 <名称>.result.json，
 * 内容包含：逐 tick 能量曲线、全量事件流（生成/狂暴/开火/死亡/逃逸）、
 * 能量账本（区分击杀来源与核弹重置）、核弹清场清单与得分归属、波次摘要。
 * --check 额外输出 <名称>.check.json，验证增量重推与整体重推一致。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { IncrementalRunner } from './incremental.js';
import { selfCheck } from './selfcheck.js';
import { SimConfig } from './types.js';

interface Args {
  input: string;
  out: string;
  check: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { input: 'sim-configs', out: 'sim-results', check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--check') args.check = true;
  }
  return args;
}

function configFiles(input: string): string[] {
  const stat = existsSync(input) ? readdirOrNull(input) : null;
  if (stat) {
    return stat
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => join(input, f));
  }
  if (existsSync(input)) return [input];
  throw new Error(`输入不存在: ${input}`);
}

function readdirOrNull(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

function hashConfig(config: SimConfig): string {
  return createHash('sha1').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}

function loadConfig(file: string): SimConfig {
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SimConfig>;
  const config = raw as SimConfig;
  if (!Array.isArray(config.waves) || config.waves.length === 0) {
    throw new Error(`${file}: 配置缺少 waves`);
  }
  config.tickMs = config.tickMs ?? 50;
  config.seed = config.seed ?? 1;
  return config;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const files = configFiles(args.input);
  mkdirSync(args.out, { recursive: true });

  let failed = 0;
  for (const file of files) {
    const name = basename(file, '.json');
    const config = loadConfig(file);
    const hash = hashConfig(config);

    const runner = new IncrementalRunner();
    const result = runner.runFull(config, hash);
    const outFile = join(args.out, `${name}.result.json`);
    writeFileSync(outFile, JSON.stringify(result, null, 2));

    const t = result.totals;
    console.log(
      `[${name}] hash=${hash} 时长=${result.meta.durationMs}ms 波次=${result.meta.waves} ` +
        `得分=${t.score} 击杀=${t.kills} 逃逸=${t.escaped} 核弹=${t.nukeCount} ` +
        `峰值能量=${t.maxEnergyObserved} 事件=${result.meta.eventCount}`
    );
    for (const nuke of result.nukes) {
      console.log(
        `  核弹 t=${nuke.t}ms 清场=[${nuke.clearedEnemyIds.join(',')}] ` +
          `得分+${nuke.scoreGained} 能量 ${nuke.energyBefore}->${nuke.energyAfter}`
      );
    }

    if (args.check) {
      const report = selfCheck(config);
      const checkFile = join(args.out, `${name}.check.json`);
      writeFileSync(checkFile, JSON.stringify(report, null, 2));
      const status = report.allPassed ? 'PASS' : 'FAIL';
      console.log(`  增量一致性自检: ${status} (${report.caseCount} 个扰动用例)`);
      for (const c of report.cases.filter(c => !c.pass)) {
        console.log(`    FAIL: ${c.name}`);
      }
      if (!report.allPassed) failed++;
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
