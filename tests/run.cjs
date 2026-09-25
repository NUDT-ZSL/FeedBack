// Deterministic verification for the memory-match state machine.
// Run: node tests/run.cjs   (after compiling engine/session into .test-build)
const assert = require('node:assert');
const {
  MemoryEngine,
  DIFFICULTY_CONFIGS,
} = require('../.test-build/engine.js');
const { GameSession } = require('../.test-build/session.js');

// --- manual scheduler: fully deterministic time --------------------------
function createManualScheduler(start = 0) {
  let now = start;
  let nextId = 1;
  const timeouts = [];
  const intervals = [];
  const sched = {
    now: () => now,
    setTimeout: (cb, ms) => {
      const id = nextId++;
      timeouts.push({ id, at: now + ms, cb });
      return id;
    },
    clearTimeout: (id) => {
      const i = timeouts.findIndex((t) => t.id === id);
      if (i >= 0) timeouts.splice(i, 1);
    },
    setInterval: (cb, ms) => {
      const id = nextId++;
      intervals.push({ id, every: ms, next: now + ms, cb });
      return id;
    },
    clearInterval: (id) => {
      const i = intervals.findIndex((t) => t.id === id);
      if (i >= 0) intervals.splice(i, 1);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let at = target;
        let entry = null;
        let kind = null;
        for (const t of timeouts) {
          if (t.at <= at) { at = t.at; entry = t; kind = 'timeout'; }
        }
        for (const iv of intervals) {
          if (iv.next <= at) { at = iv.next; entry = iv; kind = 'interval'; }
        }
        if (!entry) break;
        now = at;
        if (kind === 'timeout') timeouts.splice(timeouts.indexOf(entry), 1);
        else entry.next += entry.every;
        entry.cb();
      }
      now = target;
    },
    activeTimeouts: () => timeouts.length,
    activeIntervals: () => intervals.length,
  };
  return sched;
}

function createRecorder() {
  const events = [];
  const sink = {
    onBoard: (snap, config) => events.push({ type: 'board', snap, config }),
    onFlip: (id) => events.push({ type: 'flip', id }),
    onUnflip: (ids) => events.push({ type: 'unflip', ids }),
    onMatched: (ids) => events.push({ type: 'matched', ids }),
    onMismatch: (ids) => events.push({ type: 'mismatch', ids }),
    onStats: (snap) => events.push({ type: 'stats', snap }),
    onTick: (ms) => events.push({ type: 'tick', ms }),
    onSettled: (ms, moves) => events.push({ type: 'settled', ms, moves }),
    onHistoryChange: (canUndo, canRedo) =>
      events.push({ type: 'history', canUndo, canRedo }),
  };
  return { events, sink };
}

// --- helpers --------------------------------------------------------------
const openCount = (snap) =>
  snap.cards.filter((c) => c.isFlipped && !c.isMatched).length;

const cardById = (snap, id) => snap.cards.find((c) => c.id === id);

function assertInvariant(snap, label) {
  assert.ok(
    openCount(snap) <= 2,
    `${label}: at most 2 unmatched cards may be face up, got ${openCount(snap)}`
  );
}

function available(snap) {
  return snap.cards.filter((c) => !c.isFlipped && !c.isMatched);
}

function findMismatchPair(snap) {
  const pool = available(snap);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (pool[i].symbol !== pool[j].symbol) return [pool[i].id, pool[j].id];
    }
  }
  throw new Error('no mismatch pair available');
}

function findMatchPair(snap) {
  const pool = available(snap);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (pool[i].symbol === pool[j].symbol) return [pool[i].id, pool[j].id];
    }
  }
  return null;
}

const actionLog = (session) =>
  session.history
    .filter((e) => e.action)
    .map((e) => `${e.action.type}:${e.action.cardIds.join(',')}`);

const settledEvents = (rec) => rec.events.filter((e) => e.type === 'settled');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

// 1. Rapid clicks during mismatch feedback are queued, never dropped,
//    and never produce more than two face-up unmatched cards.
test('rapid clicks during mismatch are queued and processed in order', () => {
  const sched = createManualScheduler(1000);
  const rec = createRecorder();
  const session = new GameSession(DIFFICULTY_CONFIGS.easy, rec.sink, sched, () => 42);
  session.start();

  let snap = session.snapshot;
  assert.strictEqual(snap.timerRunning, false, 'timer idle before first click');
  assert.strictEqual(snap.elapsedMs, 0);

  const [a, b] = findMismatchPair(snap);
  const c = available(snap).find((card) => card.id !== a && card.id !== b).id;

  session.clickCard(a);
  assert.strictEqual(session.snapshot.timerRunning, true, 'timer starts on first click');
  sched.advance(120);
  session.clickCard(b); // mismatch -> 1s feedback window begins
  assertInvariant(session.snapshot, 'after mismatch');
  sched.advance(100); // still inside the feedback window
  session.clickCard(c); // must be queued, not dropped, not applied yet

  snap = session.snapshot;
  assert.strictEqual(openCount(snap), 2, 'third click must not flip during feedback');
  assert.deepStrictEqual([...session.queuedClicks], [c], 'click queued in order');
  assert.strictEqual(snap.moves, 2, 'queued click has not consumed a move yet');

  sched.advance(1000); // feedback ends -> unflip, then queued click processed
  snap = session.snapshot;
  assertInvariant(snap, 'after queue drain');
  assert.strictEqual(openCount(snap), 1, 'queued card flips after resolution');
  assert.strictEqual(cardById(snap, c).isFlipped, true);
  assert.strictEqual(snap.moves, 3, 'queued click counted exactly once');
  assert.deepStrictEqual(
    actionLog(session),
    [`flip:${a}`, `flip:${b}`, `unflip:${a},${b}`, `flip:${c}`],
    'ordered action log: flip, flip, unflip, then queued flip'
  );
});

// 2. A matching pair is marked matched and counted.
test('matching pair is matched and counted', () => {
  const sched = createManualScheduler(0);
  const rec = createRecorder();
  const session = new GameSession(DIFFICULTY_CONFIGS.easy, rec.sink, sched, () => 7);
  session.start();

  const [m1, m2] = findMatchPair(session.snapshot);
  session.clickCard(m1);
  sched.advance(200);
  session.clickCard(m2);

  const snap = session.snapshot;
  assert.strictEqual(snap.matchedPairs, 1);
  assert.strictEqual(snap.moves, 2);
  assert.strictEqual(cardById(snap, m1).isMatched, true);
  assert.strictEqual(cardById(snap, m2).isMatched, true);
  assertInvariant(snap, 'after match');
  assert.deepStrictEqual(actionLog(session), [`flip:${m1}`, `flip:${m2}`, `match:${m1},${m2}`]);
});
// 3. Undo walks back exact snapshots; redo replays them; acting after a
//    rewind appends a new branch without overwriting the original record.
test('undo/redo restores exact snapshots and branches without overwriting', () => {
  const sched = createManualScheduler(5000);
  const rec = createRecorder();
  const session = new GameSession(DIFFICULTY_CONFIGS.easy, rec.sink, sched, () => 7);
  session.start();

  const [a, b] = findMismatchPair(session.snapshot);
  session.clickCard(a);
  sched.advance(250);
  session.clickCard(b);
  sched.advance(1000); // resolve mismatch
  const [m1, m2] = findMatchPair(session.snapshot);
  session.clickCard(m1);
  sched.advance(250);
  session.clickCard(m2);

  // history: root + flip,flip,unflip,flip,flip,match = 7 entries
  assert.strictEqual(session.history.length, 7);

  // undo to root: every step must equal the stored snapshot exactly
  for (let i = 6; i >= 0; i--) {
    assert.deepStrictEqual(
      session.snapshot,
      session.history[i].snapshot,
      `state at cursor ${i} equals recorded snapshot`
    );
    if (i > 0) session.undo();
  }
  assert.strictEqual(session.snapshot.moves, 0);
  assert.strictEqual(session.snapshot.elapsedMs, 0);
  assert.strictEqual(session.snapshot.timerRunning, false);

  // redo back to the tip
  for (let i = 1; i <= 6; i++) {
    session.redo();
    assert.deepStrictEqual(
      session.snapshot,
      session.history[i].snapshot,
      `redo to entry ${i} restores its snapshot`
    );
  }

  // rewind 2 actions (to just after the first match-pair flip), then act:
  // the new action must append a branch, keeping the original record.
  session.undo();
  session.undo();
  const rewindId = 4;
  const d = available(session.snapshot)[0].id;
  sched.advance(100);
  session.clickCard(d);

  assert.strictEqual(session.history.length, 8, 'original entries are kept');
  const branch = session.history[7];
  assert.strictEqual(branch.parentId, rewindId, 'new action attaches after the rewind point');
  assert.deepStrictEqual(
    session.history[rewindId].children,
    [5, 7],
    'both the original and the new branch remain in the record'
  );
  assert.deepStrictEqual(
    actionLog(session).slice(0, 6),
    [`flip:${a}`, `flip:${b}`, `unflip:${a},${b}`, `flip:${m1}`, `flip:${m2}`, `match:${m1},${m2}`],
    'original action sequence untouched'
  );

  // redo from the rewind point follows the newest branch
  session.undo();
  session.redo();
  assert.deepStrictEqual(session.snapshot, session.history[7].snapshot);

  // timer consistency after time travel: elapsed continues from the
  // restored snapshot, not from the wall-clock of the original timeline.
  const restored = session.snapshot.elapsedMs;
  sched.advance(500);
  const ticks = rec.events.filter((e) => e.type === 'tick').map((e) => e.ms);
  assert.ok(ticks.length > 0, 'timer is running after redo');
  assert.ok(
    Math.abs(ticks[ticks.length - 1] - (restored + 500)) < 1e-9,
    'timer resumes from the restored elapsed time'
  );
});
// 4. Difficulty switch / restart restore one identical initial snapshot:
//    timer, matches, moves, open cards all reset; timer starts on the
//    first click of the new game only.
test('difficulty cycle and restart restore the same initial snapshot', () => {
  const sched = createManualScheduler(0);
  const rec = createRecorder();
  const session = new GameSession(DIFFICULTY_CONFIGS.medium, rec.sink, sched, () => 1);
  session.start();

  // play a bit on medium
  const [a, b] = findMismatchPair(session.snapshot);
  session.clickCard(a);
  sched.advance(300);
  session.clickCard(b);
  sched.advance(1000);
  assert.ok(session.snapshot.elapsedMs > 0);

  // hard -> easy -> hard, the reported timer-stuck scenario
  session.setDifficulty(DIFFICULTY_CONFIGS.hard, 11);
  session.setDifficulty(DIFFICULTY_CONFIGS.easy, 12);
  session.setDifficulty(DIFFICULTY_CONFIGS.hard, 13);

  const fresh = new GameSession(DIFFICULTY_CONFIGS.hard, createRecorder().sink, sched, () => 13);
  fresh.start();
  assert.deepStrictEqual(
    session.snapshot,
    fresh.snapshot,
    'after cycling, state equals a fresh game with the same seed'
  );
  assert.strictEqual(session.snapshot.elapsedMs, 0, 'timer reading reset to zero');
  assert.strictEqual(session.snapshot.timerRunning, false);
  assert.strictEqual(sched.activeIntervals(), 0, 'no stray timer interval survives a switch');
  assert.strictEqual(sched.activeTimeouts(), 0, 'no stray mismatch timeout survives a switch');

  const lastTick = rec.events.filter((e) => e.type === 'tick').pop();
  assert.strictEqual(lastTick.ms, 0, 'timer display shows 0.0s after switching');

  // timer starts only on the first click of the new game
  sched.advance(2000);
  assert.strictEqual(session.snapshot.elapsedMs, 0, 'no click, no timing');
  const [x] = findMismatchPair(session.snapshot);
  session.clickCard(x);
  sched.advance(400);
  assert.ok(session.snapshot.elapsedMs > 0, 'first click starts the timer');

  // restart behaves the same way
  session.reset(13);
  assert.deepStrictEqual(session.snapshot, fresh.snapshot, 'restart restores the same snapshot');
});

// 5. Settlement fires exactly once; afterwards nothing changes the final
//    time/moves; a pending settlement is cancelled by an immediate restart.
test('settlement fires once and locks the final result', () => {
  const sched = createManualScheduler(0);
  const rec = createRecorder();
  const session = new GameSession(DIFFICULTY_CONFIGS.easy, rec.sink, sched, () => 99);
  session.start();

  const winCurrentGame = () => {
    for (;;) {
      const pair = findMatchPair(session.snapshot);
      if (!pair) break;
      session.clickCard(pair[0]);
      sched.advance(150);
      session.clickCard(pair[1]);
      sched.advance(150);
    }
  };
  winCurrentGame();

  const won = session.snapshot;
  assert.strictEqual(won.settled, true);
  assert.strictEqual(won.moves, 8, 'easy game takes exactly 8 moves');
  assert.strictEqual(won.finalMoves, 8);
  assert.ok(won.finalElapsedMs > 0);
  assert.strictEqual(sched.activeIntervals(), 0, 'timer stopped at settlement');

  sched.advance(600); // modal delay
  assert.strictEqual(settledEvents(rec).length, 1, 'settlement fired exactly once');
  assert.strictEqual(settledEvents(rec)[0].moves, 8);
  assert.strictEqual(settledEvents(rec)[0].ms, won.finalElapsedMs);

  sched.advance(5000);
  assert.strictEqual(settledEvents(rec).length, 1, 'no duplicate settlement over time');

  // post-settlement operations are inert
  const before = session.snapshot;
  session.clickCard(0);
  session.undo();
  session.redo();
  sched.advance(1000);
  assert.deepStrictEqual(session.snapshot, before, 'final time/moves are frozen');
  assert.strictEqual(settledEvents(rec).length, 1);

  // a new game can settle again, exactly once
  session.reset(100);
  assert.strictEqual(session.snapshot.settled, false);
  winCurrentGame();
  sched.advance(600);
  assert.strictEqual(settledEvents(rec).length, 2, 'new game settles once more');
});

test('restart during the settlement delay cancels the pending modal', () => {
  const sched = createManualScheduler(0);
  const rec = createRecorder();
  const session = new GameSession(DIFFICULTY_CONFIGS.easy, rec.sink, sched, () => 5);
  session.start();
  for (;;) {
    const pair = findMatchPair(session.snapshot);
    if (!pair) break;
    session.clickCard(pair[0]);
    session.clickCard(pair[1]);
  }
  // restart immediately, before the 600ms modal delay elapses
  session.reset(6);
  sched.advance(10000);
  assert.strictEqual(settledEvents(rec).length, 0, 'stale settlement never fires');
  assert.strictEqual(session.snapshot.settled, false);
});
// 6. Same seed + same action sequence replays to identical states, and
//    every recorded history snapshot matches a walk back to that point.
test('seeded replay reproduces identical states and history snapshots', () => {
  const seed = 2024;
  const config = DIFFICULTY_CONFIGS.medium;
  const e1 = new MemoryEngine(config, seed);

  const ops = [];
  const doFlip = (id, now) => {
    const r = e1.flip(id, now);
    ops.push({ op: 'flip', id, now, result: r });
    return r;
  };
  const doResolve = (now) => {
    const r = e1.resolveMismatch(now);
    ops.push({ op: 'resolve', now, result: r });
    return r;
  };

  let t = 1000;
  const snap0 = e1.snapshot();
  const bySymbol = new Map();
  for (const c of snap0.cards) {
    if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, []);
    bySymbol.get(c.symbol).push(c.id);
  }
  const pairs = [...bySymbol.values()];
  const [p1, p2, p3] = pairs;

  doFlip(p1[0], (t += 100));
  doFlip(p1[1], (t += 100)); // match
  doFlip(p2[0], (t += 100));
  doFlip(p3[0], (t += 100)); // mismatch
  doResolve((t += 1000));
  doFlip(p2[0], (t += 100));
  doFlip(p2[1], (t += 100)); // match

  // replay on a fresh engine with the same seed
  const e2 = new MemoryEngine(config, seed);
  for (const op of ops) {
    const r2 = op.op === 'flip' ? e2.flip(op.id, op.now) : e2.resolveMismatch(op.now);
    assert.deepStrictEqual(r2, op.result, `replay of ${op.op} returns the same result`);
  }
  assert.deepStrictEqual(e2.snapshot(), e1.snapshot(), 'replay converges to the same state');
  assert.strictEqual(e2.history.length, e1.history.length, 'same history length');

  // every history snapshot is consistent with walking back to it
  while (e1.cursorId !== 0) {
    assert.deepStrictEqual(
      e1.snapshot(),
      e1.history[e1.cursorId].snapshot,
      `snapshot at entry ${e1.cursorId} is reproducible`
    );
    e1.undo(t);
  }
  assert.deepStrictEqual(e1.snapshot(), e1.history[0].snapshot);
});

console.log(`\n${passed} tests passed`);
