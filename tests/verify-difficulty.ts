/**
 * Deterministic verification for the difficulty engine and spawn quota.
 * Run with: node tests/verify-difficulty.ts
 */
import { DifficultyEngine, DEFAULT_THRESHOLDS } from '../src/ai/DifficultyEngine.ts';
import type { DifficultyEvent, LevelChangeRecord } from '../src/ai/DifficultyEngine.ts';
import { DifficultyManager } from '../src/ai/DifficultyManager.ts';
import {
  SpawnQuotaTracker,
  computeQuotaSnapshot,
  computeNextSpawnType,
  normalizeWeights,
  zeroCounts
} from '../src/ai/SpawnQuota.ts';
import type { EnemyBehavior } from '../src/configs/enemyTemplates.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail: string = ''): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`);
  }
}

const kill = (t: number): DifficultyEvent => ({ time: t, type: 'kill' });
const kills = (t: number, n: number): DifficultyEvent[] =>
  Array.from({ length: n }, () => kill(t));
const hp = (t: number, h: number, max: number = 100): DifficultyEvent => ({
  time: t,
  type: 'healthChange',
  health: h,
  maxHealth: max
});
const adv = (t: number): DifficultyEvent => ({ time: t, type: 'timeAdvance' });
const hit = (t: number): DifficultyEvent => ({ time: t, type: 'playerHit' });

interface SimpleRec {
  time: number;
  from: number;
  to: number;
  reasons: string[];
}

function simplify(timeline: LevelChangeRecord[]): SimpleRec[] {
  return timeline.map(r => ({
    time: r.time,
    from: r.fromLevel,
    to: r.toLevel,
    reasons: r.trigger.reasons
  }));
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Constructed scenario mixing kills, hits, health swings and time advance. */
function scenarioEvents(): DifficultyEvent[] {
  return [
    ...kills(1, 5),          // streak upgrade 1->2 at t=1
    hit(2), hp(2, 70),       // streak broken at t=2
    hp(2.5, 100),            // recover
    ...kills(3, 5),          // streak upgrade 2->3 at t=3
    hp(4, 20),               // health downgrade 3->2 at t=4
    hp(5, 100),              // recover
    ...kills(6, 5),          // streak upgrade 2->3 at t=6
    adv(130)                 // time-based upgrade 3->4 at t=130
  ];
}

const EXPECTED_SCENARIO: SimpleRec[] = [
  { time: 1, from: 1, to: 2, reasons: ['consecutiveKills>=5', 'healthRatio>=0.8'] },
  { time: 3, from: 2, to: 3, reasons: ['consecutiveKills>=5', 'healthRatio>=0.8'] },
  { time: 4, from: 3, to: 2, reasons: ['healthRatio<=0.3'] },
  { time: 6, from: 2, to: 3, reasons: ['consecutiveKills>=5', 'healthRatio>=0.8'] },
  { time: 130, from: 3, to: 4, reasons: ['levelTime>=120', 'killRate>=0.08', 'healthRatio>=0.5'] }
];

console.log('1. constructed scenario reproduces a deterministic timeline');
{
  const a = new DifficultyEngine();
  a.ingest(scenarioEvents());
  const t1 = simplify(a.getTimeline());
  check('timeline matches expected records', eq(t1, EXPECTED_SCENARIO), JSON.stringify(t1));

  const b = new DifficultyEngine();
  b.ingest(scenarioEvents());
  check('re-run is identical', eq(simplify(b.getTimeline()), t1));

  for (const seed of [7, 42, 1337]) {
    const c = new DifficultyEngine();
    c.ingest(shuffle(scenarioEvents(), seed));
    check(`shuffled arrival order (seed ${seed}) yields same timeline`, eq(simplify(c.getTimeline()), t1));
  }

  // Splitting into batches at timestamp-group boundaries also matches.
  const d = new DifficultyEngine();
  const evs = scenarioEvents();
  d.ingest(evs.slice(0, 7));   // t = 1, 2
  d.ingest(evs.slice(7, 14));  // t = 2.5, 3, 4
  d.ingest(evs.slice(14));     // t = 5, 6, 130
  check('batched ingest (distinct timestamps) yields same timeline', eq(simplify(d.getTimeline()), t1));

  // Trigger basis is recorded with concrete metric values.
  const first = a.getTimeline()[0];
  check(
    'trigger basis carries metric values',
    first.trigger.consecutiveKills === 5 &&
      first.trigger.healthRatio === 1 &&
      first.trigger.consecutiveFailures === 0 &&
      typeof first.trigger.killRate === 'number'
  );
}

console.log('2. same-timestamp events merge into a single level change');
{
  // 10 kills at one timestamp: merged streak of 10 still only climbs one level.
  const e = new DifficultyEngine();
  e.ingest(kills(5, 10));
  const tl = e.getTimeline();
  check('10 kills at one timestamp -> exactly one change', tl.length === 1);
  check('change is a single step 1->2 at t=5',
    tl.length === 1 && tl[0].fromLevel === 1 && tl[0].toLevel === 2 && tl[0].time === 5);
  check('streak counter reset after upgrade', e.getState().consecutiveKills === 0);

  // Kill + hit at the same timestamp: hit breaks the streak, order-independent.
  for (const seed of [1, 2, 3]) {
    const f = new DifficultyEngine();
    f.ingest(shuffle([...kills(1, 5), hit(1)], seed));
    check(`kill+hit same timestamp (seed ${seed}) -> no change, streak 0`,
      f.getTimeline().length === 0 && f.getState().consecutiveKills === 0);
  }

  // Same timestamp split across two ingests: evaluated only once.
  const g = new DifficultyEngine();
  g.ingest(kills(5, 3));
  g.ingest(kills(5, 7));
  check('same timestamp across ingests -> at most one change at that time',
    g.getTimeline().filter(r => r.time === 5).length <= 1);
}

console.log('3. upgrade suppresses downgrade within the same evaluation');
{
  // At t=1000 the streak upgrade (5 kills, full health) and the time-based
  // downgrade (killRate 5/1000 < 0.02, levelTime >= 60, gate open) are both
  // valid. The upgrade must win and no downgrade may be recorded at t=1000.
  const e = new DifficultyEngine();
  e.ingest([
    adv(60),            // time-based downgrade evaluated at minLevel: no-op
    adv(1000),
    ...kills(1000, 5)   // streak upgrade conditions met at the same timestamp
  ]);
  const tl = e.getTimeline();
  const at1000 = tl.filter(r => r.time === 1000);
  check('exactly one change at t=1000', at1000.length === 1, JSON.stringify(simplify(tl)));
  check('the change is an upgrade 1->2',
    at1000.length === 1 && at1000[0].fromLevel === 1 && at1000[0].toLevel === 2);
  check('upgrade basis recorded (streak + health)',
    at1000.length === 1 &&
      at1000[0].trigger.reasons.includes('consecutiveKills>=5') &&
      at1000[0].trigger.reasons.includes('healthRatio>=0.8'));
  check('no downgrade recorded at t=1000', !tl.some(r => r.time === 1000 && r.toLevel < r.fromLevel));

  // Control: without the kills, the same time advance does downgrade.
  const c = new DifficultyEngine();
  c.ingest([...kills(5, 5), adv(300)]);
  const ctl = c.getTimeline();
  check('control: time-based downgrade fires when upgrade absent',
    ctl.length === 2 && ctl[1].time === 300 && ctl[1].fromLevel === 2 && ctl[1].toLevel === 1,
    JSON.stringify(simplify(ctl)));
}

console.log('4. simultaneous downgrade conditions drop only one level');
{
  // healthRatio<=0.3 and time-based killRate<0.02 fire together at t=300.
  const e = new DifficultyEngine();
  e.ingest([
    ...kills(5, 5),   // 1->2, killCount=5
    hp(300, 10),      // healthRatio 0.1 <= 0.3
    adv(300)          // killRate 5/300 < 0.02, levelTime>=60, gate open
  ]);
  const tl = e.getTimeline();
  const at300 = tl.filter(r => r.time === 300);
  check('exactly one change at t=300', at300.length === 1, JSON.stringify(simplify(tl)));
  check('single level drop 2->1',
    at300.length === 1 && at300[0].fromLevel === 2 && at300[0].toLevel === 1);
  check('both conditions recorded as basis',
    at300.length === 1 &&
      at300[0].trigger.reasons.includes('healthRatio<=0.3') &&
      at300[0].trigger.reasons.includes('killRate<0.02'));

  // consecutiveFailures and health both below limits: still one level.
  const f = new DifficultyEngine(100, {
    ...DEFAULT_THRESHOLDS,
    consecutiveFailuresForLevelDown: 1
  });
  f.ingest([...kills(5, 5), hp(6, 100), hp(7, 0)]);
  const ftl = f.getTimeline().filter(r => r.time === 7);
  check('failures+health together -> single drop with both reasons',
    ftl.length === 1 &&
      ftl[0].toLevel === 1 &&
      ftl[0].trigger.reasons.includes('healthRatio<=0.3') &&
      ftl[0].trigger.reasons.includes('consecutiveFailures>=1'),
    JSON.stringify(simplify(f.getTimeline())));
}

console.log('5. level bounds reset their related counters explicitly');
{
  // Climb to maxLevel, then further streaks reset instead of stacking.
  const e = new DifficultyEngine();
  e.ingest([
    ...kills(10, 5), ...kills(20, 5), ...kills(30, 5), ...kills(40, 5)
  ]);
  check('reached maxLevel 5', e.getCurrentLevel() === 5,
    `level=${e.getCurrentLevel()} ${JSON.stringify(simplify(e.getTimeline()))}`);
  e.ingest(kills(50, 8));
  check('no change beyond maxLevel', e.getCurrentLevel() === 5 && e.getTimeline().length === 4);
  check('kill streak reset at maxLevel', e.getState().consecutiveKills === 0);

  // At minLevel, repeated deaths reset failure pressure at the threshold.
  const f = new DifficultyEngine();
  f.ingest([hp(1, 0), hp(2, 100), hp(3, 0), hp(4, 100), hp(5, 0)]);
  check('no change below minLevel', f.getCurrentLevel() === 1 && f.getTimeline().length === 0);
  check('consecutiveFailures reset at minLevel threshold',
    f.getState().consecutiveFailures === 0,
    `failures=${f.getState().consecutiveFailures}`);
}

console.log('6. levelTime regression or repetition causes no extra changes');
{
  const e = new DifficultyEngine();
  e.ingest([...kills(10, 13), adv(130)]);
  const before = simplify(e.getTimeline());
  check('setup produced the time-based upgrade',
    before.length === 2 && before[1].time === 130 && before[1].to === 3,
    JSON.stringify(before));

  e.ingest([adv(130)]);        // duplicate advance
  e.ingest([adv(100)]);        // regression
  e.ingest([adv(130), adv(90)]); // duplicate + regression together
  check('no additional level changes', eq(simplify(e.getTimeline()), before));
  check('levelTime never moved backwards', e.getState().levelTime === 130);
}

console.log('7. spawn quota follows the difficulty level');
{
  const weightsFor = (level: number): Record<string, number> => {
    const melee = Math.max(30, 60 - level * 5);
    const suicide = Math.min(40, 10 + level * 6);
    const ranged = Math.max(10, 100 - melee - suicide);
    return { melee, ranged, suicide };
  };

  // Level 2: melee 50 / ranged 28 / suicide 22.
  const w2 = weightsFor(2);
  const tracker = new SpawnQuotaTracker(2, w2);
  const log: EnemyBehavior[] = [];
  const spawn = (t: EnemyBehavior) => { tracker.recordSpawn(t); log.push(t); };

  check('empty level spawns the largest target share first',
    tracker.getNextType() === 'melee');

  spawn('melee'); spawn('melee'); spawn('melee'); spawn('melee'); spawn('melee');
  const active: EnemyBehavior[] = ['melee', 'melee', 'ranged'];
  const snap = tracker.getSnapshot(active);
  const fresh = computeQuotaSnapshot(2, w2, log, active);
  check('tracker snapshot equals pure full recompute', eq(snap, fresh));
  check('over-represented type is not next', snap.nextType !== 'melee');
  check('next type closes the largest deficit (ranged)', snap.nextType === 'ranged');
  check('actual ratios come from spawn records',
    snap.actualRatios.melee === 1 && snap.spawnedCounts.melee === 5);
  check('active ratios come from active enemies',
    Math.abs(snap.activeRatios.melee - 2 / 3) < 1e-9);

  // Difficulty change: quota restarts from the new level, old quota dropped.
  const w4 = weightsFor(4);
  tracker.resetForLevel(4, w4);
  const snapAfter = tracker.getSnapshot([]);
  check('level switch clears previous level spawn records',
    eq(snapAfter.spawnedCounts, zeroCounts()) && snapAfter.level === 4);
  check('targets recomputed from new level weights',
    eq(snapAfter.targetRatios, normalizeWeights(w4)));
  const log2: EnemyBehavior[] = [];
  const t2 = tracker.getNextType();
  tracker.recordSpawn(t2); log2.push(t2);
  tracker.recordSpawn('suicide'); log2.push('suicide');
  check('post-switch snapshot equals full recompute under the new level',
    eq(tracker.getSnapshot(['suicide']), computeQuotaSnapshot(4, w4, log2, ['suicide'])));

  // Deterministic tie-break: equal deficits resolve by fixed type order.
  const even = { melee: 1, ranged: 1, suicide: 1 };
  check('tie-break is deterministic',
    computeNextSpawnType(normalizeWeights(even), zeroCounts()) === 'melee');
}

console.log('8. DifficultyManager batches one evaluation per frame');
{
  const m = new DifficultyManager();
  let notifications = 0;
  m.setOnDifficultyChange(() => notifications++);

  // Five kills within one frame -> a single level change on flush.
  for (let i = 0; i < 5; i++) m.recordKill();
  m.updateMetrics({ activeEnemies: 3 }); // incidental update: no flush
  check('no evaluation before the frame flush', m.getTimeline().length === 0);
  m.updateMetrics({ playerHealth: 100, maxPlayerHealth: 100, levelTime: 0 });
  check('one level change after the frame flush',
    m.getTimeline().length === 1 && m.getCurrentLevel() === 2);
  check('callback fired exactly once', notifications === 1);

  // Next frame: five more kills -> exactly one more level.
  for (let i = 0; i < 5; i++) m.recordKill();
  m.updateMetrics({ playerHealth: 100, maxPlayerHealth: 100, levelTime: 1 });
  check('second frame adds exactly one level',
    m.getTimeline().length === 2 && m.getCurrentLevel() === 3 && notifications === 2);

  // Timeline is exposed for replay/inspection.
  const tl = m.getTimeline();
  check('manager timeline records from/to and basis',
    tl[0].fromLevel === 1 && tl[0].toLevel === 2 && tl[0].trigger.reasons.length > 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
