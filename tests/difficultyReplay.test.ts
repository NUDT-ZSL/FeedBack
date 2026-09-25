// Replay / determinism verification for the difficulty progression core.
// Compile together with the pure modules and run with node (see package script
// "test:difficulty"). No Phaser runtime is involved.

import { DifficultyEngine, DifficultyEvent } from '../src/ai/DifficultyEngine';
import { DifficultyManager } from '../src/ai/DifficultyManager';
import { SpawnQuotaPlanner, computeEnemyWeights } from '../src/ai/SpawnQuotaPlanner';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`ok: ${msg}`);
  else { failures++; console.error(`FAIL: ${msg}`); }
}
function assertEq(got: unknown, want: unknown, msg: string): void {
  assert(
    JSON.stringify(got) === JSON.stringify(want),
    `${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`
  );
}

const kill = (time: number): DifficultyEvent => ({ time, type: 'kill' });
const hit = (time: number): DifficultyEvent => ({ time, type: 'playerHit' });
const health = (time: number, value: number): DifficultyEvent =>
  ({ time, type: 'healthChange', health: value, maxHealth: 100 });
const advance = (time: number, levelTime: number): DifficultyEvent =>
  ({ time, type: 'timeAdvance', levelTime });
const kills = (time: number, n: number): DifficultyEvent[] =>
  Array.from({ length: n }, () => kill(time));

function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 1. Same-timestamp multi-kill: one evaluation, exactly one level up.
{
  const { timeline, state } = DifficultyEngine.replay(kills(5, 10));
  assertEq(timeline.length, 1, 'T1: 10 kills at one timestamp -> single level change');
  assertEq([timeline[0].fromLevel, timeline[0].toLevel], [1, 2], 'T1: level 1 -> 2 only');
  assertEq(timeline[0].triggers.consecutiveKills, 5, 'T1: trigger basis is consecutiveKills');
  assertEq(timeline[0].triggers.healthRatio, 1, 'T1: trigger basis includes healthRatio');
  assertEq(state.currentLevel, 2, 'T1: no multi-level jump in one frame');
}

// 2. Upgrade and downgrade conditions at one timestamp -> upgrade wins, one record.
{
  const events: DifficultyEvent[] = [
    ...kills(1, 5),                 // -> level 2 at t=1
    health(2, 0), health(2, 100),   // death+revive same tick: failures=1
    health(3, 0), health(3, 100),   // failures=2
    health(4, 0), health(4, 100),   // failures=3 then kills reset it
    ...kills(4, 5)                  // kills reach 5 with full health
  ];
  const { timeline } = DifficultyEngine.replay(events);
  assertEq(timeline.length, 2, 'T2: exactly two level changes');
  assertEq(timeline[1].direction, 'up', 'T2: upgrade wins at t=4, no same-tick downgrade');
  assertEq(timeline[1].toLevel, 3, 'T2: level 2 -> 3 at t=4');
}

// 3. consecutiveFailures + low health at one timestamp -> exactly one level down.
{
  const events: DifficultyEvent[] = [
    ...kills(1, 5), ...kills(2, 5), // -> level 3
    health(3, 0), health(3, 100),   // failures=1
    health(4, 0), health(4, 100),   // failures=2
    health(5, 0)                    // failures=3 AND healthRatio 0 <= 0.3
  ];
  const { timeline, state } = DifficultyEngine.replay(events);
  assertEq(timeline.length, 3, 'T3: two ups + one down');
  const down = timeline[2];
  assertEq([down.fromLevel, down.toLevel], [3, 2], 'T3: drops exactly one level');
  assertEq(down.triggers.consecutiveFailures, 3, 'T3: trigger basis has consecutiveFailures');
  assertEq(down.triggers.healthRatio, 0, 'T3: trigger basis has healthRatio');
  assertEq(state.currentLevel, 2, 'T3: ends at level 2');
}

// 4. Level bounds: floor/ceiling produce no record and reset related counters.
{
  const floor = DifficultyEngine.replay([health(1, 10)]);
  assertEq(floor.timeline.length, 0, 'T4: no downgrade below min level');
  assertEq(floor.state.consecutiveFailures, 0, 'T4: failures reset at floor');
  assertEq(floor.state.consecutiveKills, 0, 'T4: kills reset at floor');

  const ceil = DifficultyEngine.replay([
    ...kills(1, 5), ...kills(2, 5), ...kills(3, 5), ...kills(4, 5), // -> level 5
    ...kills(5, 7) // condition met at ceiling
  ]);
  assertEq(ceil.timeline.length, 4, 'T4: four upgrades up to the ceiling');
  assertEq(ceil.state.currentLevel, 5, 'T4: stays at max level');
  assertEq(ceil.state.consecutiveKills, 0, 'T4: consecutiveKills reset at ceiling');
}

// 5. levelTime regression / duplicate advance -> no extra level changes.
{
  const events: DifficultyEvent[] = [
    ...kills(1, 5),          // -> level 2, killCount 5
    advance(300, 300),       // killRate 5/300 < 0.02 -> downgrade to 1
    advance(301, 250),       // regression: dropped
    advance(302, 300),       // duplicate: dropped
    advance(303, 300)        // duplicate: dropped
  ];
  const { timeline, state } = DifficultyEngine.replay(events);
  assertEq(timeline.length, 2, 'T5: regressed/duplicate timeAdvance adds no changes');
  assertEq(timeline[1].direction, 'down', 'T5: low kill rate downgrade at t=300');
  assertEq(timeline[1].triggers.killRate, 5 / 300, 'T5: trigger basis has killRate');
  assertEq(state.levelTime, 300, 'T5: levelTime is monotonic');
}

// 6. Timed upgrade path: levelTime + killRate + health, kills spread by hits.
{
  const events: DifficultyEvent[] = [];
  for (let i = 0; i < 10; i++) {
    events.push(kill(i * 2 + 1));
    events.push(hit(i * 2 + 2)); // reset consecutiveKills so only timed path can fire
  }
  events.push(advance(120, 120)); // killRate 10/120 >= 0.08, levelTime >= 120
  const { timeline } = DifficultyEngine.replay(events);
  assertEq(timeline.length, 1, 'T6: single timed upgrade');
  assertEq(timeline[0].time, 120, 'T6: upgrade at t=120');
  assertEq(timeline[0].triggers.killRate, 10 / 120, 'T6: trigger basis has killRate');
  assertEq(timeline[0].triggers.consecutiveKills, undefined, 'T6: not a kills trigger');
}

// 7. Arrival-order independence: shuffled events (same timestamps) -> same timeline.
{
  const events: DifficultyEvent[] = [
    ...kills(1, 3),
    health(2, 80),
    ...kills(3, 3),
    ...kills(4, 2),                 // consecutiveKills 3+... reset at t=2 -> 5 at t=4? see below
    hit(5), ...kills(5, 2),
    health(6, 0), health(6, 100),
    health(7, 0), health(7, 100),
    health(8, 0),
    advance(9, 9),
    ...kills(10, 5),
    advance(11, 11)
  ];
  const base = DifficultyEngine.replay(events).timeline;
  assert(base.length > 0, 'T7: scenario produces level changes');
  for (const seed of [1, 7, 42, 1337]) {
    const shuffledTimeline = DifficultyEngine.replay(shuffled(events, seed)).timeline;
    assertEq(shuffledTimeline, base, `T7: shuffled arrival (seed ${seed}) gives identical timeline`);
  }
}

// 8. DifficultyManager: events buffered within one frame merge into one change.
{
  const manager = new DifficultyManager();
  const seen: number[] = [];
  manager.setOnDifficultyChange(level => seen.push(level));

  manager.updateMetrics({ playerHealth: 100, levelTime: 1 });
  for (let i = 0; i < 5; i++) manager.recordKill(); // 5 kills in one frame
  const changes = manager.flush();
  assertEq(changes.length, 1, 'T8: one frame with 5 kills -> single evaluation');
  assertEq(seen, [2], 'T8: one difficulty-change notification');
  assertEq(manager.getCurrentLevel(), 2, 'T8: level 2 after flush');

  const empty = manager.flush();
  assertEq(empty.length, 0, 'T8: flush without events does nothing');

  // kills spread across two frames still accumulate
  manager.updateMetrics({ playerHealth: 100, levelTime: 2 });
  for (let i = 0; i < 3; i++) manager.recordKill();
  manager.flush();
  manager.updateMetrics({ playerHealth: 100, levelTime: 3 });
  for (let i = 0; i < 2; i++) manager.recordKill();
  const second = manager.flush();
  assertEq(second.length, 1, 'T8: accumulated kills upgrade on later frame');
  assertEq(manager.getCurrentLevel(), 3, 'T8: level 3 after second upgrade');

  // timeline is queryable for replay
  const timeline = manager.getTimeline();
  assertEq(timeline.map(r => [r.time, r.toLevel]), [[1, 2], [3, 3]], 'T8: timeline records frame times');
}

// 9. Quota planner: deterministic next type, level change = full recompute.
{
  const planner = new SpawnQuotaPlanner(1);
  assertEq(planner.nextType(), 'melee', 'T9: first spawn is the highest-weight type');

  const seq: string[] = [];
  for (let i = 0; i < 100; i++) {
    const t = planner.nextType();
    seq.push(t);
    planner.recordSpawn(t);
  }
  const counts = { melee: 0, ranged: 0, suicide: 0 } as Record<string, number>;
  for (const t of seq) counts[t]++;
  assert(Math.abs(counts.melee - 55) <= 2, `T9: melee count ~55 (got ${counts.melee})`);
  assert(Math.abs(counts.ranged - 29) <= 2, `T9: ranged count ~29 (got ${counts.ranged})`);
  assert(Math.abs(counts.suicide - 16) <= 2, `T9: suicide count ~16 (got ${counts.suicide})`);

  // actual ratios derive from active enemies
  const snap = planner.snapshot({ melee: 2, ranged: 1, suicide: 1 });
  assertEq(snap.actualRatios, { melee: 0.5, ranged: 0.25, suicide: 0.25 }, 'T9: actual ratios from active enemies');
  assertEq(snap.targetRatios, { melee: 0.55, ranged: 0.29, suicide: 0.16 }, 'T9: target ratios at level 1');

  // level change resets the quota baseline: equals a fresh planner at the new level
  planner.setLevel(3);
  const fresh = new SpawnQuotaPlanner(3);
  const active = { melee: 3, ranged: 3, suicide: 0 };
  assertEq(planner.snapshot(active), fresh.snapshot(active), 'T9: post-change quota equals full recompute at new level');
  assertEq(planner.snapshot(active).spawnedCounts, { melee: 0, ranged: 0, suicide: 0 }, 'T9: old-level quota not carried over');
  assertEq(computeEnemyWeights(3), { melee: 45, ranged: 27, suicide: 28 }, 'T9: level 3 weights');

  // replaying the same spawn sequence at the new level stays deterministic
  const a = new SpawnQuotaPlanner(3);
  const b = new SpawnQuotaPlanner(3);
  const seqA: string[] = [];
  const seqB: string[] = [];
  for (let i = 0; i < 30; i++) {
    const ta = a.nextType(); seqA.push(ta); a.recordSpawn(ta);
    const tb = b.nextType(); seqB.push(tb); b.recordSpawn(tb);
  }
  assertEq(seqA, seqB, 'T9: quota-driven spawn sequence is reproducible');
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll difficulty replay tests passed.');
