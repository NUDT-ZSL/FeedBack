// 离线批量验证入口。用法:
//   npm test                          # 默认参数全量运行
//   npm test -- --seed=123            # 指定随机种子（可复现失败）
//   npm test -- --fuzz-ops=5000       # 调整每个 fuzz 种子的操作步数
//   npm test -- --fuzz-seeds=10       # 调整 fuzz 种子数量
// 退出码: 0 = 全部不变量通过; 1 = 存在失败或套件异常。
import { runAll, printReport } from './harness';

// 注册全部套件（import 副作用）
import './suites/price-bounds';
import './suites/cargo-capacity';
import './suites/sell-conservation';
import './suites/buy-limits';
import './suites/history';
import './suites/reset';
import './suites/normal-flow';
import './suites/fuzz';

interface CliConfig {
  seed: number;
  fuzzOps: number;
  fuzzSeeds: number;
}

function parseArgs(argv: string[]): CliConfig {
  const cfg: CliConfig = { seed: 1, fuzzOps: 500, fuzzSeeds: 3 };
  for (const arg of argv) {
    const m = arg.match(/^--(seed|fuzz-ops|fuzz-seeds)=(\d+)$/);
    if (!m) {
      console.error(`无法识别的参数: ${arg}（支持 --seed=N --fuzz-ops=N --fuzz-seeds=N）`);
      process.exit(2);
    }
    const value = parseInt(m[2], 10);
    if (m[1] === 'seed') cfg.seed = value;
    else if (m[1] === 'fuzz-ops') cfg.fuzzOps = value;
    else cfg.fuzzSeeds = value;
  }
  return cfg;
}

const cfg = parseArgs(process.argv.slice(2));

// 注入 fuzz 配置（fuzz 套件在注册时读取）
(globalThis as Record<string, unknown>).__FUZZ_CONFIG__ = {
  seeds: cfg.fuzzSeeds,
  ops: cfg.fuzzOps,
  baseSeed: cfg.seed
};

const result = runAll();
printReport(result, { seed: cfg.seed, fuzzOps: cfg.fuzzOps, fuzzSeeds: cfg.fuzzSeeds });

process.exit(result.failures.length === 0 && result.suiteErrors.length === 0 ? 0 : 1);
