import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, syncClients } from '../src/whiteboard/merge.ts';
import { createElement, emptyState } from '../src/whiteboard/types.ts';
import { stateHash, visibleOrder } from '../src/whiteboard/serialize.ts';
import { checkInvariants } from '../src/whiteboard/invariants.ts';
import { isDescendant, orderOf } from '../src/whiteboard/apply.ts';
import { OpRejection } from '../src/whiteboard/errors.ts';
import { mulberry32 } from './helpers.ts';
import { Board } from '../src/whiteboard/history.ts';
import type { BoardState } from '../src/whiteboard/types.ts';
import type { Op } from '../src/whiteboard/ops.ts';

function makeBase(): BoardState {
  const board = new Board(emptyState());
  for (const id of ['e1', 'e2', 'e3', 'e4']) {
    board.dispatch({ type: 'add', element: createElement({ id }) });
  }
  board.dispatch({ type: 'group', ids: ['e3', 'e4'], groupId: 'g1' });
  return board.state;
}

function makePair(): { alice: Client; bob: Client } {
  const base = makeBase();
  return { alice: new Client('alice', base), bob: new Client('bob', base) };
}

test('non-conflicting concurrent edits from both clients are all preserved', () => {
  const { alice, bob } = makePair();

  alice.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#ff0000' } });
  bob.dispatchLocal({ type: 'update', id: 'e2', patch: { x: 321 } });
  bob.dispatchLocal({ type: 'add', element: createElement({ id: 'e9' }) });

  syncClients(alice, bob);

  assert.equal(stateHash(alice.state), stateHash(bob.state));
  assert.equal(alice.state.elements.e1.fill, '#ff0000');
  assert.equal(alice.state.elements.e2.x, 321);
  assert.ok(alice.state.elements.e9, 'bob add must survive the merge');
  assert.deepEqual(alice.conflicts, []);
  assert.deepEqual(checkInvariants(alice.state), []);
});

test('concurrent updates to the same field resolve deterministically and are explained', () => {
  const run = (): { fill: string; conflictReason: string } => {
    const { alice, bob } = makePair();
    alice.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#ff0000' } });
    bob.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#0000ff' } });
    syncClients(alice, bob);
    assert.equal(stateHash(alice.state), stateHash(bob.state));
    assert.equal(alice.conflicts.length, 1);
    return {
      fill: alice.state.elements.e1.fill,
      conflictReason: alice.conflicts[0].reason,
    };
  };

  const first = run();
  const second = run();
  assert.equal(first.fill, second.fill, 'merge outcome must be deterministic');
  assert.equal(first.fill, '#0000ff', 'later writer in merged order (bob) wins');
  assert.match(first.conflictReason, /e1\.fill/);
});

test('concurrent updates to different fields of the same element both survive', () => {
  const { alice, bob } = makePair();
  alice.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#ff0000' } });
  bob.dispatchLocal({ type: 'update', id: 'e1', patch: { x: 777 } });
  syncClients(alice, bob);

  assert.equal(alice.state.elements.e1.fill, '#ff0000');
  assert.equal(alice.state.elements.e1.x, 777);
  assert.deepEqual(alice.conflicts, []);
});

test('remove wins over concurrent update, and the loss is explained', () => {
  const { alice, bob } = makePair();
  alice.dispatchLocal({ type: 'remove', id: 'e1' });
  bob.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#00ff00' } });
  syncClients(alice, bob);

  assert.equal(stateHash(alice.state), stateHash(bob.state));
  assert.equal(alice.state.elements.e1, undefined);
  assert.equal(alice.conflicts.length, 1);
  assert.equal(alice.conflicts[0].resolution, 'skipped');
  assert.match(alice.conflicts[0].reason, /concurrently removed/);
});

test('concurrent moves of the same element resolve deterministically', () => {
  const { alice, bob } = makePair();
  alice.dispatchLocal({ type: 'move', id: 'e1', newParentId: 'g1' });
  bob.dispatchLocal({ type: 'move', id: 'e1', newParentId: null, toIndex: 0 });
  syncClients(alice, bob);

  assert.equal(stateHash(alice.state), stateHash(bob.state));
  assert.equal(alice.state.elements.e1.parentId, null, 'bob move wins (later in merged order)');
  assert.deepEqual(alice.state.rootOrder[0], 'e1');
  assert.equal(alice.conflicts.length, 1);
  assert.equal(alice.conflicts[0].resolution, 'superseded');
  assert.deepEqual(checkInvariants(alice.state), []);
});

test('concurrent edits to the same group: ungroup vs move-into are explained', () => {
  const { alice, bob } = makePair();
  alice.dispatchLocal({ type: 'ungroup', groupId: 'g1' });
  bob.dispatchLocal({ type: 'move', id: 'e1', newParentId: 'g1' });
  syncClients(alice, bob);

  assert.equal(stateHash(alice.state), stateHash(bob.state));
  assert.equal(alice.state.elements.g1, undefined, 'ungroup wins (earlier in merged order)');
  assert.equal(alice.conflicts.length, 1);
  assert.equal(alice.conflicts[0].resolution, 'skipped');
  assert.match(alice.conflicts[0].reason, /no longer exists/);
  assert.deepEqual(visibleOrder(alice.state), ['e1', 'e2', 'e3', 'e4']);
});

test('update on a child of a concurrently removed group is reported, not lost silently', () => {
  const { alice, bob } = makePair();
  alice.dispatchLocal({ type: 'remove', id: 'g1' });
  bob.dispatchLocal({ type: 'update', id: 'e3', patch: { text: 'hello' } });
  syncClients(alice, bob);

  assert.equal(alice.state.elements.e3, undefined);
  assert.equal(alice.state.elements.g1, undefined);
  assert.equal(alice.conflicts.length, 1);
  assert.match(alice.conflicts[0].reason, /concurrently removed/);
});

test('merge is commutative and idempotent', () => {
  const { alice, bob } = makePair();
  alice.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#ff0000' } });
  alice.dispatchLocal({ type: 'move', id: 'e2', newParentId: 'g1' });
  bob.dispatchLocal({ type: 'remove', id: 'e4' });
  bob.dispatchLocal({ type: 'add', element: createElement({ id: 'e9' }) });

  syncClients(alice, bob);
  const hashAB = stateHash(alice.state);

  const { alice: a2, bob: b2 } = makePair();
  a2.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#ff0000' } });
  a2.dispatchLocal({ type: 'move', id: 'e2', newParentId: 'g1' });
  b2.dispatchLocal({ type: 'remove', id: 'e4' });
  b2.dispatchLocal({ type: 'add', element: createElement({ id: 'e9' }) });
  syncClients(b2, a2);
  assert.equal(stateHash(a2.state), hashAB, 'sync order must not matter');

  syncClients(alice, bob);
  assert.equal(stateHash(alice.state), hashAB, 're-sync must be idempotent');
});

test('clients keep converging across multiple rounds of edits and syncs', () => {
  const { alice, bob } = makePair();

  alice.dispatchLocal({ type: 'update', id: 'e1', patch: { fill: '#111111' } });
  bob.dispatchLocal({ type: 'update', id: 'e2', patch: { fill: '#222222' } });
  syncClients(alice, bob);
  const roundOne = stateHash(alice.state);
  assert.equal(roundOne, stateHash(bob.state));

  alice.dispatchLocal({ type: 'add', element: createElement({ id: 'e5' }) });
  bob.dispatchLocal({ type: 'remove', id: 'e1' });
  syncClients(alice, bob);

  assert.equal(stateHash(alice.state), stateHash(bob.state));
  assert.equal(alice.state.elements.e1, undefined);
  assert.equal(alice.state.elements.e5.parentId, null);

  bob.dispatchLocal({ type: 'move', id: 'e5', newParentId: 'g1' });
  alice.dispatchLocal({ type: 'update', id: 'e3', patch: { text: 'round-3' } });
  syncClients(alice, bob);

  assert.equal(stateHash(alice.state), stateHash(bob.state));
  assert.equal(alice.state.elements.e5.parentId, 'g1');
  assert.equal(alice.state.elements.e3.text, 'round-3');
  assert.deepEqual(checkInvariants(alice.state), []);
});

test('invalid local op is rejected and never enters the sync log', () => {
  const { alice, bob } = makePair();
  assert.throws(() =>
    alice.dispatchLocal({ type: 'remove', id: 'ghost' }),
  );
  assert.equal(alice.log.length, 0);
  syncClients(alice, bob);
  assert.deepEqual(alice.conflicts, []);
  assert.equal(stateHash(alice.state), stateHash(makeBase()));
});

function runMergeFuzz(seed: number): {
  hashA: string;
  hashB: string;
  conflicts: string;
} {
  const rng = mulberry32(seed);
  const { alice, bob } = makePair();
  let counter = 100;
  const randomInt = (max: number): number => Math.floor(rng() * max);
  const pick = <T>(items: T[]): T => items[randomInt(items.length)];

  for (let i = 0; i < 400; i += 1) {
    const client = rng() < 0.5 ? alice : bob;
    const state = client.state;
    const ids = Object.keys(state.elements);
    const groups = ids.filter((id) => state.elements[id].kind === 'group');
    const roll = rng();
    let op: Op;

    if (ids.length === 0 || roll < 0.2) {
      const id = `f${counter++}`;
      op = {
        type: 'add',
        element: createElement({ id, x: randomInt(400), y: randomInt(400) }),
      };
    } else if (roll < 0.4) {
      op = { type: 'update', id: pick(ids), patch: { fill: `#${randomInt(0xffffff).toString(16).padStart(6, '0')}` } };
    } else if (roll < 0.55) {
      op = { type: 'remove', id: pick(ids) };
    } else if (roll < 0.7) {
      const id = pick(ids);
      const targets = groups.filter(
        (gid) => gid !== id && !isDescendant(state, id, gid),
      );
      const newParentId = rng() < 0.5 || targets.length === 0 ? null : pick(targets);
      op = { type: 'move', id, newParentId };
    } else if (roll < 0.82) {
      const parentIds: (string | null)[] = [null, ...groups];
      const candidates = parentIds.filter((pid) => orderOf(state, pid).length >= 2);
      if (candidates.length === 0) {
        op = { type: 'update', id: pick(ids), patch: { x: randomInt(400) } };
      } else {
        const siblings = [...orderOf(state, pick(candidates))];
        const memberIds = [siblings[0], siblings[1]];
        op = { type: 'group', ids: memberIds, groupId: `gf${counter++}` };
      }
    } else if (roll < 0.9) {
      op = groups.length === 0
        ? { type: 'reorder', id: pick(ids), toIndex: 0 }
        : { type: 'ungroup', groupId: pick(groups) };
    } else {
      op = { type: 'update', id: 'ghost', patch: { x: 1 } };
    }

    try {
      client.dispatchLocal(op);
    } catch (err) {
      assert.ok(err instanceof OpRejection, 'unexpected non-rejection error in fuzz');
    }

    if (i % 30 === 29) syncClients(alice, bob);
  }

  syncClients(alice, bob);
  assert.equal(stateHash(alice.state), stateHash(bob.state), 'fuzz: clients failed to converge');
  assert.deepEqual(checkInvariants(alice.state), [], 'fuzz: invariants violated on alice');
  assert.deepEqual(checkInvariants(bob.state), [], 'fuzz: invariants violated on bob');
  return {
    hashA: stateHash(alice.state),
    hashB: stateHash(bob.state),
    conflicts: JSON.stringify(alice.conflicts),
  };
}

test('fuzz: concurrent clients converge deterministically under 400 random ops', () => {
  const first = runMergeFuzz(20240);
  const second = runMergeFuzz(20240);
  assert.deepEqual(first, second, 'fuzz outcome must be reproducible');
  assert.equal(first.hashA, first.hashB);
});
