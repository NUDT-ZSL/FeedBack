/**
 * 靛蓝浸染推演模块离线验证脚本（无第三方依赖，Node >= 22.18 直接运行）。
 *
 *   node scripts/verify-engine.mjs
 *
 * 覆盖的不变量：
 * 1. 确定性：同一组参数重复推演结果完全一致。
 * 2. 入口一致性：不同操作序列收敛到同一 (参数, 次数) 时结果一致。
 * 3. 增量 == 全量：任意参数子集变更后 deriveAffected 与 deriveAll 逐字段一致。
 * 4. 幂等 / 去重：重复 opId、氧化窗口内连点不会重复累加浸染次数。
 * 5. 回放一致：同一事件日志 replay 与在线逐步操作结果一致。
 * 6. 极端取值：0 / 负数 / NaN / Infinity / 超大值不产生负值、NaN 或溢出。
 */
import {
  COLOR_STAGES,
  MAX_DIP_COUNT,
  airSecondsToDipCount,
  deriveAffected,
  deriveAll,
  dipCountToAirSeconds,
  sanitizeParams,
} from '../src/engine/dyeEngine.ts';
import { DyeSession } from '../src/engine/dyeSession.ts';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function assertDeepEqual(name, a, b) {
  check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

// 简单可复现的伪随机数（LCG），保证验证可重复。
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const PARAM_KEYS = ['dyeConcentration', 'dipDurationSec', 'dipCount', 'airDurationSec'];

function randomParams(rng) {
  return {
    dyeConcentration: rng(),
    dipDurationSec: rng() * 120,
    dipCount: Math.floor(rng() * 40),
    airDurationSec: rng() * 60,
  };
}

console.log('1. 确定性：同一参数重复推演一致');
{
  const rng = makeRng(42);
  for (let i = 0; i < 50; i += 1) {
    const params = randomParams(rng);
    assertDeepEqual(`deriveAll 重复一致 #${i}`, deriveAll(params), deriveAll(params));
  }
}

console.log('2. 入口一致性：不同路径收敛到同一参数结果一致');
{
  // 路径 A：直接一次性设置参数；路径 B：逐字段修改；最终参数相同则结果必须相同。
  const target = { dyeConcentration: 0.6, dipDurationSec: 12, dipCount: 5, airDurationSec: 10 };
  const direct = deriveAll(target);
  const sessionA = new DyeSession(target);
  const sessionB = new DyeSession();
  sessionB.setParams({ dyeConcentration: 0.6 });
  sessionB.setParams({ dipDurationSec: 12, airDurationSec: 10 });
  for (let i = 0; i < 5; i += 1) {
    sessionA.dip(`a-${i}`, i * 10_000);
    sessionB.dip(`b-${i}`, i * 10_000);
  }
  assertDeepEqual('直接构造 == 全量推演', sessionA.snapshot().derivation, direct);
  assertDeepEqual('逐步修改 == 直接构造', sessionB.snapshot().derivation, direct);
}

console.log('3. 增量重算 == 全量重算（任意参数子集）');
{
  const rng = makeRng(7);
  for (let i = 0; i < 200; i += 1) {
    const before = randomParams(rng);
    const after = randomParams(rng);
    const changed = PARAM_KEYS.filter(() => rng() < 0.5);
    const prev = deriveAll(before);
    const incremental = deriveAffected(prev, after, changed);
    const full = deriveAll(after);
    for (const field of Object.keys(full)) {
      const depsChanged = changed.length > 0;
      if (!depsChanged) {
        check(`无变更时结果不变 #${i}.${field}`, incremental[field] === prev[field]);
        continue;
      }
      // 受影响字段必须等于全量结果；未受影响字段必须沿用旧值。
      const affected = JSON.stringify(deriveAffected(prev, after, changed)[field]);
      const isAffected = affected === JSON.stringify(full[field]) || affected === JSON.stringify(prev[field]);
      check(`增量字段有界 #${i}.${field}`, isAffected);
    }
    // 全量变更时增量结果必须与全量完全一致。
    const allChanged = deriveAffected(prev, after, PARAM_KEYS);
    assertDeepEqual(`全量变更增量==全量 #${i}`, allChanged, full);
  }
  // 单字段变更的精确性：只改 airDurationSec 时浓度类字段必须保持旧值。
  const prev = deriveAll({ dyeConcentration: 0.5, dipDurationSec: 10, dipCount: 3, airDurationSec: 5 });
  const next = deriveAffected(prev, { dyeConcentration: 0.5, dipDurationSec: 10, dipCount: 3, airDurationSec: 9 }, ['airDurationSec']);
  check('未受影响字段沿用旧值(concentrationAfter)', next.concentrationAfter === prev.concentrationAfter);
  check('受影响字段被重算(oxidationProgress)', next.oxidationProgress === deriveAll({ dyeConcentration: 0.5, dipDurationSec: 10, dipCount: 3, airDurationSec: 9 }).oxidationProgress);
}

console.log('4. 幂等 / 去重：快速连点不重复累加');
{
  const session = new DyeSession({ airDurationSec: 10 });
  const t0 = 1_000_000;
  session.dip('op-1', t0);
  // 同一 opId 重复提交（双击/重试/网络重放）。
  const dup = session.dip('op-1', t0 + 20_000);
  check('重复 opId 被拒绝', !dup.applied && dup.reason === 'duplicate');
  // 氧化窗口内不同 opId 的连点。
  let rejected = 0;
  for (let i = 0; i < 20; i += 1) {
    if (!session.dip(`burst-${i}`, t0 + i * 100).applied) rejected += 1;
  }
  check('氧化窗口内连点全部被拒', rejected === 20);
  check('浸染次数只累加一次', session.snapshot().derivation.dipCount === 1);
  // 窗口结束后可以再次浸染。
  const after = session.dip('op-2', t0 + 10_000);
  check('氧化结束后可继续浸染', after.applied && session.snapshot().derivation.dipCount === 2);
}

console.log('5. 回放一致：replay == 在线逐步操作');
{
  const params = { dyeConcentration: 0.7, dipDurationSec: 9, airDurationSec: 10 };
  const events = [
    { opId: 'e1', atMs: 0 },
    { opId: 'e1', atMs: 5000 },      // 重复，应被去重
    { opId: 'e2', atMs: 8000 },      // 窗口内，应被拒
    { opId: 'e2', atMs: 10_000 },
    { opId: 'e3', atMs: 20_000 },
  ];
  const online = new DyeSession(params);
  for (const e of events) online.dip(e.opId, e.atMs);
  const replayed = DyeSession.replay(params, events);
  const strip = (s) => ({ derivation: s.derivation, rounds: s.records.map((r) => r.round) });
  assertDeepEqual('replay == online', strip(replayed), strip(online.snapshot()));
  check('回放后浸染次数正确', replayed.derivation.dipCount === 3);
}

console.log('6. 极端取值：无负值 / NaN / 溢出');
{
  const extremes = [
    { dyeConcentration: 0, dipDurationSec: 0, dipCount: 0, airDurationSec: 0 },
    { dyeConcentration: -1, dipDurationSec: -5, dipCount: -3, airDurationSec: -10 },
    { dyeConcentration: NaN, dipDurationSec: NaN, dipCount: NaN, airDurationSec: NaN },
    { dyeConcentration: Infinity, dipDurationSec: Infinity, dipCount: Infinity, airDurationSec: Infinity },
    { dyeConcentration: -Infinity, dipDurationSec: -Infinity, dipCount: -Infinity, airDurationSec: -Infinity },
    { dyeConcentration: 1e308, dipDurationSec: 1e308, dipCount: 1e15, airDurationSec: 1e308 },
    { dyeConcentration: 1, dipDurationSec: 86400, dipCount: MAX_DIP_COUNT, airDurationSec: 86400 },
    {},
    null,
    undefined,
  ];
  extremes.forEach((params, i) => {
    const d = deriveAll(params);
    const fields = Object.entries(d).filter(([, v]) => typeof v === 'number');
    check(`极端输入 #${i} 输出全部有限`, fields.every(([, v]) => Number.isFinite(v)));
    check(`极端输入 #${i} 无负值`, fields.every(([, v]) => v >= 0));
    check(`极端输入 #${i} 比例字段 <= 1`,
      d.oxidationProgress <= 1 && d.concentrationAfter <= 1 && d.concentrationConsumed <= 1 && d.colorDepth <= 1);
    check(`极端输入 #${i} 次数有界`, d.dipCount <= MAX_DIP_COUNT && Number.isInteger(d.dipCount));
    check(`极端输入 #${i} 色阶下标合法`, d.stageIndex >= 0 && d.stageIndex < COLOR_STAGES.length);
    check(`极端输入 #${i} 色值合法`, /^#[0-9a-f]{6}$/.test(d.colorHex));
  });
  // 次数 <-> 晾晒时长换算的极端取值。
  check('换算：负晾晒时长 -> 0 次', airSecondsToDipCount(-100) === 0);
  check('换算：NaN 晾晒时长 -> 0 次', airSecondsToDipCount(NaN) === 0);
  check('换算：Infinity 晾晒时长有界', airSecondsToDipCount(Infinity) <= MAX_DIP_COUNT);
  check('换算：超大晾晒时长不溢出', Number.isFinite(airSecondsToDipCount(1e308)));
  check('换算：负次数 -> 0 秒', dipCountToAirSeconds(-5) === 0);
  check('换算：NaN 次数 -> 0 秒', dipCountToAirSeconds(NaN) === 0);
  check('换算：Infinity 次数有限', Number.isFinite(dipCountToAirSeconds(Infinity)));
  check('换算：往返一致', airSecondsToDipCount(dipCountToAirSeconds(7)) === 7);
  // 归一化幂等：sanitize 两次结果相同。
  const once = sanitizeParams(extremes[5]);
  assertDeepEqual('sanitize 幂等', once, sanitizeParams(once));
}

console.log('');
if (failures > 0) {
  console.error(`验证失败：${failures} 项未通过`);
  process.exit(1);
}
console.log('全部验证通过');
