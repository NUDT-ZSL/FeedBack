import { strict as assert } from 'node:assert';
import {
  replayOperations,
  createEmptySnapshot,
  applyOperationToSnapshot,
  blockKey,
  type Operation,
  type WorldSnapshot
} from '../src/network/OperationLog.ts';
import { NetworkManager } from '../src/network/NetworkManager.ts';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${(e as Error).message}`);
  }
}

// ---------- Part A: crafted log (place / break / move / dup / gap) ----------

const SERVER = 'server';
const crafted: Operation[] = [
  { seq: 1, source: SERVER, type: 'world_state',
    blocks: [{ x: 0, y: 49, color: '#654321', isIndestructible: true }],
    players: [{ id: 'p1', name: 'p1', x: 1, y: 1, hatColor: '#FF0000' }] },
  { seq: 2, source: SERVER, type: 'block_place', x: 5, y: 5, color: '#FF0000' },
  { seq: 3, source: 'alice', type: 'player_move', playerId: 'p1', x: 2, y: 1 },
  { seq: 4, source: SERVER, type: 'block_place', x: 5, y: 5, color: '#00FF00' },
  { seq: 5, source: SERVER, type: 'block_break', x: 5, y: 5 },
  { seq: 5, source: SERVER, type: 'block_place', x: 9, y: 9, color: '#0000FF' },
  { seq: 7, source: SERVER, type: 'block_place', x: 7, y: 7, color: '#FFFFFF' }
];

const replay = replayOperations(crafted);

check('duplicate seq 5 applied exactly once (block at 9,9 absent)', () => {
  assert.deepEqual(replay.duplicateSeqs, [5]);
  assert.equal(replay.appliedSeqs.filter(s => s === 5).length, 1);
  assert.equal(replay.snapshot.blocks[blockKey(9, 9)], undefined);
});

check('gap seq 6 reported as missing range [6,6]', () => {
  assert.deepEqual(replay.missingRanges, [{ from: 6, to: 6 }]);
});

check('place+break ordering preserved: 5,5 absent, 7,7 present', () => {
  assert.equal(replay.snapshot.blocks[blockKey(5, 5)], undefined);
  assert.equal(replay.snapshot.blocks[blockKey(7, 7)]?.color, '#FFFFFF');
});

check('player move mixed into log lands at (2,1) with source attribution', () => {
  assert.equal(replay.snapshot.players.p1.x, 2);
  assert.equal(replay.snapshot.players.p1.y, 1);
  assert.equal(replay.snapshot.players.p1.source, 'alice');
});

check('indestructible ground survives replay', () => {
  const ground = replay.snapshot.blocks[blockKey(0, 49)];
  assert.ok(ground && ground.isIndestructible);
});

// identical log replayed twice deterministically
const replay2 = replayOperations(crafted);
check('replaying same log twice yields identical snapshot', () => {
  assert.deepEqual(replay2.snapshot, replay.snapshot);
  assert.deepEqual(replay2.duplicateSeqs, replay.duplicateSeqs);
  assert.deepEqual(replay2.missingRanges, replay.missingRanges);
});

// indestructible block break op is a no-op and keeps source
check('breaking indestructible block is a no-op', () => {
  const snap = createEmptySnapshot();
  applyOperationToSnapshot(snap, {
    seq: 1, source: SERVER, type: 'block_place', x: 3, y: 3, color: '#654321'
  });
  const madeIndestructible = snap.blocks[blockKey(3, 3)];
  madeIndestructible.isIndestructible = true;
  applyOperationToSnapshot(snap, { seq: 2, source: SERVER, type: 'block_break', x: 3, y: 3 });
  assert.ok(snap.blocks[blockKey(3, 3)]);
});

// larger gap produces a single contiguous range
check('multi-number gap reported as one range', () => {
  const ops: Operation[] = [
    { seq: 1, source: SERVER, type: 'block_place', x: 1, y: 1, color: '#FFF' },
    { seq: 4, source: SERVER, type: 'block_place', x: 2, y: 1, color: '#FFF' },
    { seq: 8, source: SERVER, type: 'block_place', x: 3, y: 1, color: '#FFF' }
  ];
  assert.deepEqual(replayOperations(ops).missingRanges, [
    { from: 2, to: 3 }, { from: 5, to: 7 }
  ]);
});

// player_move before join is ignored (no crash), not fabricated
check('move for unknown player does not fabricate a player', () => {
  const r = replayOperations([
    { seq: 1, source: 'ghost', type: 'player_move', playerId: 'ghost', x: 9, y: 9 }
  ]);
  assert.equal(r.snapshot.players.ghost, undefined);
});

// ---------- Part B: live mock NetworkManager vs offline replay ----------

function snapshotToReplayShape(snapshot: WorldSnapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

async function runLiveScenario(): Promise<NetworkManager> {
  const net = new NetworkManager();
  await new Promise<void>(resolve => net.connect({ onConnect: () => resolve() }));
  await new Promise(r => setTimeout(r, 3600)); // joins + several bot moves

  // local player moves + place/break/place ordering at same coordinate
  net.sendPlayerMove(20, 22);
  net.sendBlockPlace(10, 10, '#FF0000');
  net.sendBlockBreak(10, 10);
  net.sendBlockPlace(10, 10, '#00FF00');
  net.sendBlockBreak(0, 49); // ground must survive
  await new Promise(r => setTimeout(r, 300));
  return net;
}

async function main(): Promise<void> {
  const net = await runLiveScenario();
  const lastSeq = net.getLastSeq();
  assert.ok(lastSeq > 10, `expected a populated log, got seq=${lastSeq}`);

  const live = net.getSnapshot();
  const fullReplay = net.replayLog(0);
  const replayCopy = snapshotToReplayShape(fullReplay.snapshot);

  check('live world == full offline replay: blocks', () => {
    assert.deepEqual(Object.keys(replayCopy.blocks).sort(),
      Object.keys(snapshotToReplayShape(live).blocks).sort());
    assert.deepEqual(replayCopy.blocks, snapshotToReplayShape(live).blocks);
  });

  check('live world == full offline replay: players + positions + source', () => {
    assert.deepEqual(replayCopy.players, snapshotToReplayShape(live).players);
  });

  check('full replay has no duplicates or gaps for a live session', () => {
    assert.deepEqual(fullReplay.duplicateSeqs, []);
    assert.deepEqual(fullReplay.missingRanges, []);
    assert.deepEqual(fullReplay.appliedSeqs,
      Array.from({ length: lastSeq }, (_, i) => i + 1));
  });

  // incremental API: getOperationsSince / replayLog(since)
  const mid = Math.floor(lastSeq / 2);
  const sinceOps = net.getOperationsSince(mid);
  check('getOperationsSince returns only seq > since, in order', () => {
    assert.ok(sinceOps.length > 0);
    assert.ok(sinceOps.every(op => op.seq > mid));
    const seqs = sinceOps.map(op => op.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  });

  // rebuild base snapshot from prefix, then replay suffix -> identical world
  const prefix = net.getOperationLog().filter(op => op.seq <= mid);
  const suffix = net.getOperationsSince(mid);
  const stitched = replayOperations(prefix);
  assert.deepEqual(stitched.missingRanges, []);
  const tail = replayOperations(suffix, stitched.snapshot);
  check('prefix snapshot + suffix replay equals live world', () => {
    assert.deepEqual(snapshotToReplayShape(tail.snapshot), snapshotToReplayShape(live));
  });

  // duplicate + gap on a copy of the real log
  const logWithFaults = net.getOperationLog();
  const removed = logWithFaults.splice(Math.floor(logWithFaults.length / 2), 2);
  logWithFaults.push({ ...logWithFaults[0] }); // duplicate seq (different payload)
  const faultReplay = replayOperations(logWithFaults);
  check('duplicated real op skipped (not applied twice)', () => {
    assert.ok(faultReplay.duplicateSeqs.includes(logWithFaults[0].seq));
    const count = faultReplay.appliedSeqs.filter(s => s === logWithFaults[0].seq).length;
    assert.equal(count, 1);
  });
  check('missing real seqs reported as explicit ranges', () => {
    const gapFrom = removed[0].seq;
    const gapTo = removed[removed.length - 1].seq;
    const hits = faultReplay.missingRanges.filter(r => r.from <= gapFrom && r.to >= gapTo);
    assert.equal(hits.length, 1);
  });

  // wait long enough for bot leave/rejoin cycle to be logged
  await new Promise(r => setTimeout(r, 5500));
  const net2 = net;
  const afterLeave = net2.replayLog(0);
  const logAfter = net2.getOperationLog();
  const hasLeaveOrJoin = logAfter.some(o => o.type === 'player_leave' || o.type === 'player_join');
  check('mock join/leave cycle entered the log', () => {
    assert.ok(hasLeaveOrJoin);
  });
  check('replay still matches live world after join/leave cycle', () => {
    assert.deepEqual(snapshotToReplayShape(afterLeave.snapshot),
      snapshotToReplayShape(net2.getSnapshot()));
    assert.deepEqual(afterLeave.missingRanges, []);
  });

  net.disconnect();
  const seqAfterDisconnect = net.getLastSeq();
  await new Promise(r => setTimeout(r, 1800));
  check('disconnect stops the mock event sources', () => {
    assert.equal(net.getLastSeq(), seqAfterDisconnect);
  });

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
