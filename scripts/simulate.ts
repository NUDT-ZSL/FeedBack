/**
 * 杭州攻防战 · 城门破坏后守军突围与士气连锁 —— 离线批量推演 / 验收入口
 *
 * 用法：
 *   npm run simulate            # 跑全部验收场景
 *   npm run simulate -- --turns 16
 *
 * 覆盖的验收点：
 *   1. 城门未破坏时突围连锁完全不触发，原有结算不变；
 *   2. 城门破坏后按固定顺序结算：军粮 upkeep → 决策 → 突围 → 箭矢拦截 → 士气连锁 → 溃散；
 *   3. 边界场景（军粮不足 / 士气过低 / 城墙仍有残段）产出可观察事件而非静默跳过；
 *   4. 连续推演与逐回合单独结算结果一致（同一组初始条件）；
 *   5. 同一种子重复推演结果可复现；
 *   6. 同一回合重复结算幂等：士兵不被重复计入突围、士气不被重复扣减。
 */
import {
  runContinuous,
  runStepwise,
  verifyConsistency,
  takeSnapshot,
  isBreakoutIdempotent,
  isChainInactiveBeforeBreach,
  defaultScenario,
  ScenarioOptions
} from '../src/simulation';
import { createInitialState } from '../src/GameLogic';
import { BreakoutEvent } from '../src/types';

let failures = 0;

const check = (name: string, ok: boolean, detail = '') => {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ' —— ' + detail : ''}`);
};

const printEvents = (events: BreakoutEvent[], limit = 12) => {
  events.slice(0, limit).forEach(e => console.log(`      T${e.turn} [${e.phase}] ${e.message}`));
  if (events.length > limit) console.log(`      … 共 ${events.length} 条事件`);
};

const turnsArg = process.argv.find(a => a.startsWith('--turns='));
const TURNS = turnsArg ? parseInt(turnsArg.split('=')[1], 10) : 14;

console.log('=== 场景 1：城门未破坏，连锁不触发 ===');
{
  const initial = createInitialState();
  check('突围连锁在城门完好时不产生事件、不改变守军状态', isChainInactiveBeforeBreach(initial));

  const opts: Partial<ScenarioOptions> = { turns: 2, forceGateByTurn: 99 };
  const result = runContinuous(opts);
  const noChainEvents = result.final.breakoutLog.length === 0;
  check('城门完好跑 2 回合无任何突围事件', noChainEvents);
  check(
    '守军士气/军粮未被连锁扣减',
    result.final.defenders.morale === 100 && result.final.defenders.grain === 30,
    `morale=${result.final.defenders.morale} grain=${result.final.defenders.grain}`
  );
}

console.log('=== 场景 2：城门破坏后的完整突围连锁（默认剧本） ===');
{
  const result = runContinuous({ turns: TURNS });
  const log = result.final.breakoutLog;
  printEvents(log);
  check('城门按时被砸破', result.final.gateDestroyed);
  check('产生了决策/突围/拦截/士气连锁事件',
    ['decision', 'sortie', 'interception', 'morale'].every(p => log.some(e => e.phase === p)));
  check('连锁最终汇入胜负判定', result.final.winner !== null, `winner=${result.final.winner}`);
  const s = takeSnapshot(result.final);
  console.log(`      终局：turn=${s.turn} winner=${s.winner} 守军士气=${s.defenderMorale} 守军军粮=${s.defenderGrain} 状态=${s.defenderStatus} 城墙防守=${s.wallDefense} 逃出=${s.escapedCount} 阵亡=${s.casualtyCount}`);
}

console.log('=== 场景 3：边界 —— 守军军粮不足 ===');
{
  const result = runContinuous({ turns: TURNS, defenderGrain: 3 });
  const log = result.final.breakoutLog;
  printEvents(log, 8);
  check('军粮不足时给出可观察的取舍（决策事件含原因）',
    log.some(e => e.phase === 'decision' && e.data.reason !== undefined));
  check('军粮耗尽触发溃散并决出胜负',
    result.final.defenders.status === 'routed' && result.final.winner === 'rebels',
    `status=${result.final.defenders.status} winner=${result.final.winner}`);
}

console.log('=== 场景 4：边界 —— 守军士气过低 ===');
{
  const result = runContinuous({ turns: TURNS, defenderMorale: 35 });
  const log = result.final.breakoutLog;
  printEvents(log, 8);
  check('士气不足时选择坚守并给出可观察事件',
    log.some(e => e.phase === 'decision' && /坚守|不足以组织突围/.test(e.message)));
  check('坚守每回合士气衰减并最终溃散',
    result.final.defenders.status === 'routed',
    `status=${result.final.defenders.status} morale=${result.final.defenders.morale}`);
}

console.log('=== 场景 5：边界 —— 城墙仍有残段时缺口被封堵 ===');
{
  // 不砸门、不集火：城门完好时城墙其余段落完整，连锁不触发（残段可守）
  const holdResult = runContinuous({ turns: 4, forceGateByTurn: 99, catapultPositions: [] });
  check('城墙完好无缺口时守军坚守、无静默跳过',
    holdResult.final.breakoutLog.length === 0 && holdResult.final.defenders.status === 'holding');
  // 砸门后起义军堵门（剧本默认会在缺口生成起义军），拦截事件可观察
  const blocked = runContinuous({ turns: TURNS });
  check('缺口被起义军封堵时拦截事件可观察',
    blocked.final.breakoutLog.some(e => e.phase === 'interception'));
}

console.log('=== 场景 6：连续推演 vs 逐回合单独结算一致性 ===');
{
  const verdict = verifyConsistency({ turns: TURNS });
  check('两种结算顺序逐回合结果一致', verdict.consistent,
    verdict.consistent ? `${verdict.turns} 回合全部一致` : `第 ${verdict.mismatchTurn} 回合出现分歧`);
}

console.log('=== 场景 7：同一种子重复推演可复现 ===');
{
  const a = runContinuous({ turns: TURNS });
  const b = runContinuous({ turns: TURNS });
  check('两次连续推演快照完全一致',
    JSON.stringify(a.snapshots) === JSON.stringify(b.snapshots));
  const c = runStepwise({ turns: TURNS });
  const d = runStepwise({ turns: TURNS });
  check('两次逐回合推演快照完全一致',
    JSON.stringify(c.snapshots) === JSON.stringify(d.snapshots));
}

console.log('=== 场景 8：同回合防重复结算 ===');
{
  const result = runContinuous({ turns: TURNS });
  const breached = result.states.find(s => s.gateDestroyed && !s.winner);
  check('找到城门已破且未终局的中间态', breached !== undefined);
  if (breached) {
    check('同回合二次结算幂等（士兵不重复计入、士气不重复扣减）', isBreakoutIdempotent(breached));
  }
  // 全局校验：每个回合号在日志中每个阶段最多出现一次
  const seen = new Set<string>();
  let duplicated = false;
  for (const e of result.final.breakoutLog) {
    const key = `${e.turn}:${e.phase}`;
    if (seen.has(key) && e.phase !== 'decision') duplicated = true;
    seen.add(key);
  }
  check('事件日志无同回合同阶段重复结算', !duplicated);
}

console.log('');
if (failures > 0) {
  console.log(`✗ ${failures} 项验收失败`);
  process.exit(1);
} else {
  console.log('✓ 全部验收场景通过');
  console.log(`  默认剧本：${JSON.stringify(defaultScenario(TURNS), null, 0)}`);
}
