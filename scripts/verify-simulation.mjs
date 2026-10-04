// 离线验证靛蓝浸染推演模块：
//   npm run verify
// 用 esbuild 把纯 TS 推演模块打包为临时 ESM（不启动界面、不依赖浏览器），
// 然后校验：参数清洗与边界、确定性、增量重算 == 全量重算、
// 操作幂等/快速连点去重、引擎与推演结果一致、完成态可达。
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'node_modules', '.cache');
const outFile = join(outDir, 'sim-verify.mjs');
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'simulation', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'silent',
});

const sim = await import(pathToFileURL(outFile).href);

let failures = 0;
let passed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertFiniteResult(result, label) {
  const fields = [
    'dipCount',
    'initialConcentration',
    'dyeConcentration',
    'concentrationLoss',
    'totalAirDrySec',
    'oxidationProgress',
    'colorDepth',
    'stage',
  ];
  for (const field of fields) {
    const v = result[field];
    check(
      `${label}: ${field} 有限且非负 (${v})`,
      typeof v === 'number' && Number.isFinite(v) && v >= 0,
    );
  }
  check(`${label}: 氧化进度 <= 1`, result.oxidationProgress <= 1);
  check(`${label}: 着色深度 <= 1`, result.colorDepth <= 1);
  check(
    `${label}: 剩余浓度 <= 初始浓度`,
    result.dyeConcentration <= result.initialConcentration + 1e-12,
  );
  check(
    `${label}: 消耗量 + 剩余 ≈ 初始`,
    Math.abs(result.concentrationLoss + result.dyeConcentration - result.initialConcentration) <
      1e-9,
  );
  check(`${label}: stage 在 0..9`, result.stage >= 0 && result.stage <= 9);
  check(`${label}: dipCount 为整数`, Number.isInteger(result.dipCount));
}

console.log('\n[1] 参数清洗与极端取值边界');
{
  const extremes = [
    { dyeConcentration: Number.NaN, dipDurationSec: -100, dipCount: 1e15, airDrySec: Number.POSITIVE_INFINITY },
    { dyeConcentration: Number.NEGATIVE_INFINITY, dipDurationSec: Number.NaN, dipCount: -5, airDrySec: -1 },
    { dyeConcentration: 5, dipDurationSec: 1e9, dipCount: 99.9, airDrySec: 0 },
    { dyeConcentration: 0, dipDurationSec: 0, dipCount: 0, airDrySec: 0 },
  ];
  extremes.forEach((p, i) => {
    const { result, params } = sim.derive(p);
    assertFiniteResult(result, `极端用例 ${i + 1}`);
    check(`极端用例 ${i + 1}: dipCount 已钳制为整数 (${params.dipCount})`, params.dipCount <= sim.MAX_DIP_COUNT);
    check(
      `极端用例 ${i + 1}: 总晾晒时长未溢出 (${result.totalAirDrySec})`,
      result.totalAirDrySec <= sim.MAX_TOTAL_AIR_DRY_SEC,
    );
  });
  const zero = sim.derive({
    dyeConcentration: 0,
    dipDurationSec: 0,
    dipCount: 0,
    airDrySec: 0,
  }).result;
  check('零参数：氧化进度为 0', zero.oxidationProgress === 0);
  check('零参数：着色深度为 0', zero.colorDepth === 0);
}

console.log('\n[2] 同参数推演确定性');
{
  const p = { dyeConcentration: 0.72, dipDurationSec: 6, dipCount: 8, airDrySec: 12 };
  const a = sim.derive(p);
  const b = sim.derive(p);
  check('重复推演结果完全一致', deepEqual(a.result, b.result));
  const c = sim.derive(p, b);
  check('以缓存再推演仍一致', deepEqual(c.result, b.result));
}

console.log('\n[3] 增量重算与全量重算一致');
{
  const base = { ...sim.DEFAULT_PARAMS, dipCount: 7 };
  const mutations = [
    { dyeConcentration: 0.45 },
    { dipDurationSec: 12 },
    { dipCount: 9 },
    { airDrySec: 20 },
    { dyeConcentration: 0.3, airDrySec: 25 },
    { dipDurationSec: 2, dipCount: 18 },
  ];
  let prev = sim.derive(base);
  mutations.forEach((mutation, i) => {
    const nextParams = { ...base, ...mutation };
    const incremental = sim.derive(nextParams, prev);
    const full = sim.derive(nextParams);
    check(`用例 ${i + 1}: result 一致`, deepEqual(incremental.result, full.result));
    check(
      `用例 ${i + 1}: 中间阶段一致`,
      deepEqual(incremental.uptake, full.uptake) &&
        deepEqual(incremental.oxidation, full.oxidation),
    );
    prev = incremental;
  });

  // 连续只改浓度：氧化阶段必须原样复用，且与全量结果一致
  const baseDerivation = sim.derive(base);
  const onlyConcentration = sim.derive(
    { ...base, dyeConcentration: 0.2 },
    baseDerivation,
  );
  check('只改浓度时氧化阶段复用', onlyConcentration.oxidation === baseDerivation.oxidation);
  check('只改浓度时复用结果仍等于全量', deepEqual(onlyConcentration.result, sim.derive({ ...base, dyeConcentration: 0.2 }).result));

  // 只改晾晒时长：吸色阶段复用
  const onlyAirDry = sim.derive({ ...base, airDrySec: 30 }, baseDerivation);
  check('只改晾晒时长时吸色阶段复用', onlyAirDry.uptake === baseDerivation.uptake);
}

console.log('\n[4] 浸染操作幂等与快速连点去重');
{
  const params = sim.DEFAULT_PARAMS;
  let outcome = sim.applyDip(sim.createEngineState(), 'op-1', 1_000, params);
  check('首次浸染受理', outcome.status === 'applied' && outcome.state.dipCount === 1);
  const afterFirst = outcome.state;
  outcome = sim.applyDip(afterFirst, 'op-1', 2_000, params);
  check('相同 opId 重复提交 -> duplicate 且次数不累加', outcome.status === 'duplicate' && outcome.state.dipCount === 1);
  check('duplicate 时状态引用不变', outcome.state === afterFirst);
  outcome = sim.applyDip(afterFirst, 'op-2', 5_000, params);
  check('氧化锁定窗口内快速连点 -> locked', outcome.status === 'locked' && outcome.state.dipCount === 1);
  check('locked 时状态引用不变', outcome.state === afterFirst);
  outcome = sim.applyDip(afterFirst, 'op-2', 1_000 + params.airDrySec * 1000, params);
  check('锁定解除后相同操作可受理', outcome.status === 'applied' && outcome.state.dipCount === 2);
  outcome = sim.applyDip(afterFirst, 'op-3', 0, params);
  check('锁定解除边界：早 1ms 仍拒绝', outcome.status === 'locked');
  outcome = sim.applyDip(afterFirst, 'op-3', 11_000, params);
  check('锁定解除边界：整 10s 受理', outcome.status === 'applied');
}

console.log('\n[5] 引擎记录与推演结果一致');
{
  const params = sim.DEFAULT_PARAMS;
  let state = sim.createEngineState();
  const timeline = [];
  for (let i = 1; i <= 12; i += 1) {
    const now = i * 20_000;
    const outcome = sim.applyDip(state, `op-${i}`, now, params);
    if (outcome.status !== 'applied') throw new Error('unexpected non-applied in fixed sequence');
    state = outcome.state;
    timeline.push({ round: i, record: outcome.record, now });
  }
  const derived = sim.derive({ ...params, dipCount: state.dipCount }).result;
  check('当前色值与最后一条记录一致', state.records.at(-1).colorHex === derived.colorHex);
  timeline.forEach(({ round, record }) => {
    const expected = sim.derive({ ...params, dipCount: round }).result.colorHex;
    check(`第 ${round} 轮记录色值与推演一致`, record.colorHex === expected);
  });

  const reverted = sim.revertTo(state, 5);
  check('回退后浸染次数 = 5', reverted.dipCount === 5 && reverted.records.length === 5);
  check('回退解除氧化锁定', sim.remainingLockMs(reverted, Number.POSITIVE_INFINITY) === 0);
  const revertedColor = sim.derive({ ...params, dipCount: 5 }).result.colorHex;
  check('回退后色值与第 5 轮推演一致', reverted.records.at(-1).colorHex === revertedColor);

  // 回退后重新浸染到 8 轮：推演结果必须与全新推演完全一致
  let rebuilt = reverted;
  for (let i = 6; i <= 8; i += 1) {
    const outcome = sim.applyDip(rebuilt, `redo-${i}`, i * 20_000 + 1_000_000, params);
    rebuilt = outcome.state;
  }
  const rebuiltColor = sim.derive({ ...params, dipCount: 8 }).result.colorHex;
  check('回退后重新浸染，色值与全新推演一致', rebuilt.records.at(-1).colorHex === rebuiltColor);
}

console.log('\n[6] 单调性、上限与完成态可达');
{
  const params = sim.DEFAULT_PARAMS;
  let previous = sim.derive({ ...params, dipCount: 0 }).result;
  let completedAt = -1;
  for (let n = 1; n <= 50; n += 1) {
    const current = sim.derive({ ...params, dipCount: n }).result;
    check(`第 ${n} 轮：着色深度不回退`, current.colorDepth + 1e-12 >= previous.colorDepth);
    check(`第 ${n} 轮：剩余浓度不上升`, current.dyeConcentration <= previous.dyeConcentration + 1e-12);
    check(`第 ${n} 轮：氧化进度不回退`, current.oxidationProgress + 1e-12 >= previous.oxidationProgress);
    if (completedAt < 0 && current.isComplete) completedAt = n;
    previous = current;
  }
  check(`默认参数下完成态可达（第 ${completedAt} 轮）`, completedAt > 0, '50 轮内未达最深色阶');
  const finalColor = sim.derive({ ...params, dipCount: completedAt }).result.colorHex;
  check('完成态色值为最深靛蓝', finalColor === sim.COLOR_STAGES[sim.MAX_STAGE]);

  // 极端次数下结果仍有界
  const huge = sim.derive({ ...params, dipCount: sim.MAX_DIP_COUNT }).result;
  assertFiniteResult(huge, '最大浸染次数');
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${passed} passed, ${failures} failed`);
rmSync(outFile, { force: true });
process.exit(failures === 0 ? 0 : 1);
