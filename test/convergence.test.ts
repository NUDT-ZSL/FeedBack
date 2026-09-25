/**
 * Convergence acceptance tests for the versioned incremental sync
 * protocol. Spins up a real server and multiple WebSocket clients,
 * then exercises concurrent edits, delete/update conflicts, op
 * reordering, duplicate/rolled-back versions, disconnect/reconnect
 * with offline edits, long-offline resync, and empty/single-element
 * initial sync.
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createSyncServer, type SyncServer } from '../src/sync/server-core';
import { SyncClient, type WebSocketLike } from '../src/sync/client';
import { BoardState } from '../src/sync/merge';
import type { Op, ServerMessage } from '../src/sync/protocol';
import type { CanvasElement } from '../src/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${label}`);
    await sleep(20);
  }
}

let elCounter = 0;
function makeElement(userId: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  elCounter++;
  return {
    id: `el-${elCounter}`,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: '#000000',
    strokeWidth: 2,
    rotation: 0,
    layer: 0,
    userId,
    createdAt: 1700000000000 + elCounter,
    opacity: 1,
    ...overrides,
  };
}

async function startServer(options: { logLimit?: number } = {}) {
  const srv = createSyncServer(options);
  const port = await srv.listen();
  return { srv, port };
}

function makeClient(userId: string, port: number, inbox?: ServerMessage[]): SyncClient {
  return new SyncClient({
    url: `ws://127.0.0.1:${port}/ws`,
    userId,
    createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
    reconnectDelayMs: 100,
    onMessage: (m) => inbox?.push(m),
  });
}

async function connectAndSync(client: SyncClient): Promise<void> {
  client.connect();
  await waitFor(() => client.synced, `${client.userId} initial sync`);
}

async function waitSettled(srv: SyncServer, ...clients: SyncClient[]): Promise<void> {
  await waitFor(
    () => clients.every((c) => c.synced && c.pendingCount === 0 && c.version === srv.getVersion()),
    `settle at version ${srv.getVersion()}`,
  );
  await sleep(50);
}

function assertConverged(srv: SyncServer, ...clients: SyncClient[]): void {
  const expected = JSON.stringify(srv.state.getElements());
  for (const c of clients) {
    assert.equal(
      JSON.stringify(c.getElements()),
      expected,
      `client ${c.userId} diverged from server`,
    );
  }
}

const tests: Array<[string, () => Promise<void>]> = [];
function test(name: string, fn: () => Promise<void>): void {
  tests.push([name, fn]);
}
test('empty canvas: two clients sync to version 0 with no elements', async () => {
  const { srv, port } = await startServer();
  try {
    const a = makeClient('A', port);
    const b = makeClient('B', port);
    await connectAndSync(a);
    await connectAndSync(b);
    assert.equal(a.version, 0);
    assert.equal(b.version, 0);
    assert.deepEqual(a.getElements(), []);
    assert.deepEqual(b.getElements(), []);
    assertConverged(srv, a, b);
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});

test('single element canvas: late joiners receive the element', async () => {
  const { srv, port } = await startServer();
  try {
    const a = makeClient('A', port);
    await connectAndSync(a);
    a.addElement(makeElement('A', { id: 'only-one', color: '#111111' }));
    await waitFor(() => srv.getVersion() === 1, 'server applies first op');

    const b = makeClient('B', port);
    const c = makeClient('C', port);
    await connectAndSync(b);
    await connectAndSync(c);
    assert.equal(b.getElements().length, 1);
    assert.equal(c.getElements().length, 1);
    assert.equal(b.getElements()[0].id, 'only-one');
    await waitSettled(srv, a, b, c);
    assertConverged(srv, a, b, c);
    a.close();
    b.close();
    c.close();
  } finally {
    await srv.close();
  }
});

test('concurrent same-attribute updates converge to the deterministic winner', async () => {
  const { srv, port } = await startServer();
  try {
    const a = makeClient('A', port);
    const b = makeClient('B', port);
    await connectAndSync(a);
    await connectAndSync(b);

    a.addElement(makeElement('A', { id: 'shared' }));
    b.addElement(makeElement('B', { id: 'filler' }));
    await waitSettled(srv, a, b);

    // Both clients now have lamport=1, so the concurrent updates get
    // equal lamports and the userId tie-break decides: 'B' > 'A'.
    a.updateElement('shared', { color: 'red' });
    b.updateElement('shared', { color: 'blue' });
    await waitSettled(srv, a, b);

    assertConverged(srv, a, b);
    const shared = srv.state.getElements().find((e) => e.id === 'shared');
    assert.equal(shared?.color, 'blue', 'tie should be won by higher userId (B)');
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});

test('concurrent delete vs update resolves deterministically on all replicas', async () => {
  const { srv, port } = await startServer();
  try {
    const a = makeClient('A', port);
    const b = makeClient('B', port);
    await connectAndSync(a);
    await connectAndSync(b);
    a.addElement(makeElement('A', { id: 'victim' }));
    b.addElement(makeElement('B', { id: 'filler' }));
    await waitSettled(srv, a, b);

    // Round 1: A deletes (2,A) while B updates (2,B): update wins the tie.
    a.deleteElement('victim');
    b.updateElement('victim', { color: 'green' });
    await waitSettled(srv, a, b);
    assertConverged(srv, a, b);
    let victim = srv.state.getElements().find((e) => e.id === 'victim');
    assert.equal(victim?.color, 'green', 'update with higher clock should revive the element');

    // Round 2: B deletes (3,B) while A updates (3,A): delete wins the tie.
    b.deleteElement('victim');
    a.updateElement('victim', { color: 'yellow' });
    await waitSettled(srv, a, b);
    assertConverged(srv, a, b);
    victim = srv.state.getElements().find((e) => e.id === 'victim');
    assert.equal(victim, undefined, 'delete with higher clock should remove the element');
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});
test('merge engine: out-of-order and duplicate delivery converges', async () => {
  const el = makeElement('A', { id: 'shared' });
  const ops: Op[] = [
    { kind: 'add', opId: 'o1', userId: 'A', lamport: 1, baseVersion: 0, element: el },
    { kind: 'update', opId: 'o2', userId: 'A', lamport: 2, baseVersion: 1, elementId: 'shared', updates: { color: 'red' } },
    { kind: 'update', opId: 'o3', userId: 'B', lamport: 2, baseVersion: 1, elementId: 'shared', updates: { color: 'blue' } },
    { kind: 'delete', opId: 'o4', userId: 'B', lamport: 3, baseVersion: 2, elementId: 'shared' },
    { kind: 'update', opId: 'o5', userId: 'C', lamport: 4, baseVersion: 3, elementId: 'shared', updates: { color: 'green' } },
  ];
  const orders: Op[][] = [
    ops,
    [...ops].reverse(),
    [ops[2], ops[4], ops[0], ops[3], ops[1]],
    // Duplicates interleaved (retransmissions).
    [ops[0], ops[1], ops[1], ops[2], ops[0], ops[3], ops[4], ops[4]],
  ];
  const snapshots = orders.map((order) => {
    const s = new BoardState();
    for (const op of order) s.applyOp(op);
    return JSON.stringify(s.getElements());
  });
  for (const snap of snapshots) assert.equal(snap, snapshots[0], 'all orders must converge');
  const final = JSON.parse(snapshots[0]) as CanvasElement[];
  assert.equal(final.length, 1, 'reviving update (C,4) beats the delete (B,3)');
  assert.equal(final[0].color, 'green');

  // Rolled-back (stale) write must not overwrite a newer one.
  const s = new BoardState();
  s.applyOp(ops[0]);
  s.applyOp({ kind: 'update', opId: 'n1', userId: 'D', lamport: 5, baseVersion: 1, elementId: 'shared', updates: { color: 'new' } });
  s.applyOp({ kind: 'update', opId: 'n2', userId: 'E', lamport: 3, baseVersion: 1, elementId: 'shared', updates: { color: 'stale' } });
  assert.equal(s.getElements()[0].color, 'new');
});

test('server dedups repeated ops and rejects baseVersion from the future', async () => {
  const { srv, port } = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox: ServerMessage[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
  try {
    await new Promise<void>((resolve) => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'hello', userId: 'raw', lastVersion: null }));
    await waitFor(() => inbox.some((m) => m.type === 'sync'), 'initial sync');

    const op: Op = {
      kind: 'add', opId: 'raw-1', userId: 'raw', lamport: 1, baseVersion: 0,
      element: makeElement('raw', { id: 'raw-el' }),
    };
    const send = (o: Op) => ws.send(JSON.stringify({ type: 'op', op: o }));
    send(op);
    send(op); // duplicate delivery (retry after lost ack)
    send(op);
    await waitFor(() => inbox.filter((m) => m.type === 'ack').length >= 1, 'ack');
    await sleep(100);
    assert.equal(srv.getVersion(), 1, 'duplicate opIds must be applied only once');
    assert.equal(srv.state.getElements().length, 1);

    // baseVersion ahead of the server: rejected, version untouched.
    send({ kind: 'update', opId: 'raw-2', userId: 'raw', lamport: 2, baseVersion: 999, elementId: 'raw-el', updates: { color: 'x' } });
    await waitFor(() => inbox.some((m) => m.type === 'reject'), 'reject');
    assert.equal(srv.getVersion(), 1);

    // Rolled-back baseVersion is stale but harmless: merge still converges.
    send({ kind: 'update', opId: 'raw-3', userId: 'raw', lamport: 3, baseVersion: 0, elementId: 'raw-el', updates: { color: 'ok' } });
    await waitFor(() => srv.getVersion() === 2, 'stale-base op applied');
    assert.equal(srv.state.getElements()[0].color, 'ok');
  } finally {
    ws.close();
    await srv.close();
  }
});
test('disconnect/reconnect: catch-up fills the gap and offline edits survive', async () => {
  const { srv, port } = await startServer();
  try {
    const inboxA: ServerMessage[] = [];
    const a = makeClient('A', port, inboxA);
    const b = makeClient('B', port);
    await connectAndSync(a);
    await connectAndSync(b);
    a.addElement(makeElement('A', { id: 'shared', color: '#123456' }));
    await waitSettled(srv, a, b);

    // A goes offline. B keeps editing; A keeps editing locally.
    a.disconnect();
    b.updateElement('shared', { color: 'red' });
    b.addElement(makeElement('B', { id: 'b-online' }));
    await waitFor(() => srv.getVersion() === 3, 'B ops applied while A offline');

    a.updateElement('shared', { text: 'offline-note' }); // different attribute
    a.addElement(makeElement('A', { id: 'a-offline' }));
    assert.equal(a.pendingCount, 2, 'offline edits are queued locally');

    a.connect();
    await waitSettled(srv, a, b);

    assert.ok(
      inboxA.some((m) => m.type === 'catchup'),
      'reconnect should use incremental catch-up, not a full snapshot',
    );
    assertConverged(srv, a, b);
    const shared = srv.state.getElements().find((e) => e.id === 'shared');
    assert.equal(shared?.color, 'red', 'B online edit preserved');
    assert.equal(shared?.text, 'offline-note', 'A offline edit preserved after reconnect');
    assert.ok(srv.state.getElements().some((e) => e.id === 'a-offline'), 'A offline add preserved');
    assert.ok(srv.state.getElements().some((e) => e.id === 'b-online'), 'B online add preserved');
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});

test('long offline: full snapshot resync still preserves pending local edits', async () => {
  const { srv, port } = await startServer({ logLimit: 3 });
  try {
    const inboxA: ServerMessage[] = [];
    const a = makeClient('A', port, inboxA);
    const b = makeClient('B', port);
    await connectAndSync(a);
    await connectAndSync(b);
    a.disconnect();

    // Overflow the retained op log while A is away.
    for (let i = 0; i < 6; i++) b.addElement(makeElement('B', { id: `bulk-${i}` }));
    await waitFor(() => srv.getVersion() === 6, 'log overflow');

    a.addElement(makeElement('A', { id: 'a-offline-long' }));
    a.connect();
    await waitSettled(srv, a, b);

    const resyncs = inboxA.filter((m) => m.type === 'sync').length;
    assert.ok(resyncs >= 2, 'second sync must be a full snapshot (log was trimmed)');
    assertConverged(srv, a, b);
    assert.ok(
      srv.state.getElements().some((e) => e.id === 'a-offline-long'),
      'offline edit survives full-snapshot resync',
    );
    assert.equal(srv.state.getElements().length, 7);
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   - ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL - ${name}`);
      console.error(error);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${tests.length} tests passed`);
})();
