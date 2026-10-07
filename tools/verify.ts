// 批量推演 + 一致性校验 CLI（脱离渲染层运行）：
//   node tools/verify.ts [--start 0] [--end 120000] [--step 500] [--bodies 30] [--seed 42]
// 退出码非 0 表示校验失败。
import { runVerification, DEFAULT_VERIFY_OPTIONS, type VerifyOptions } from '../src/engine/verify.ts';

function parseArgs(): VerifyOptions {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  return {
    start: get('start', DEFAULT_VERIFY_OPTIONS.start),
    end: get('end', DEFAULT_VERIFY_OPTIONS.end),
    step: get('step', DEFAULT_VERIFY_OPTIONS.step),
    bodies: get('bodies', DEFAULT_VERIFY_OPTIONS.bodies),
    seed: get('seed', DEFAULT_VERIFY_OPTIONS.seed)
  };
}

const report = runVerification(parseArgs());
for (const r of report.results) {
  console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
}
console.log('----REPORT----');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) {
  console.error(`${report.results.filter((r) => !r.passed).length} 项校验失败`);
  process.exit(1);
}
