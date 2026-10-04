import {
  startServer,
  TestClient,
  getBoard,
  makeElement,
  drawMessage,
  assertEqual,
  assertDeepEqual,
} from '../helpers';

export const name = 'malformed-messages: 非法/无法解析的消息不污染服务端状态';

const RAW_GARBAGE = [
  'not json at all',
  '{"type":"draw","element":',
  '',
  '   ',
];

const VALID_JSON_INVALID_MESSAGES: unknown[] = [
  null,
  42,
  'a plain string',
  [1, 2, 3],
  {},
  { type: 123 },
  { type: 'unknown-type' },
  { type: 'draw' },
  { type: 'draw', element: null },
  { type: 'draw', element: {} },
  { type: 'draw', element: { id: 123, type: 'rectangle' } },
  { type: 'draw', element: { id: '', type: 'rectangle' } },
  { type: 'update' },
  { type: 'update', elementId: 'seed-element' },
  { type: 'update', elementId: 'seed-element', updates: 'not-an-object' },
  { type: 'update', elementId: 42, updates: { x: 1 } },
  { type: 'delete' },
  { type: 'delete', elementId: 42 },
  { type: 'delete', elementId: null },
];

export async function run(): Promise<void> {
  const app = await startServer();
  const clients: TestClient[] = [];
  try {
    const clientA = await TestClient.connect(app.wsUrl);
    clients.push(clientA);
    await clientA.waitForMessage((m) => m.type === 'sync', 'clientA sync');

    const seed = makeElement('seed-element');
    clientA.send(drawMessage('client-a', seed));
    const { waitFor } = await import('../helpers');
    await waitFor(async () => (await getBoard(app.httpUrl)).version === 1, 'seed draw applied');

    const baseline = await getBoard(app.httpUrl);
    assertEqual(baseline.version, 1, 'baseline version');
    assertEqual(baseline.elements.length, 1, 'baseline element count');

    for (const raw of RAW_GARBAGE) {
      clientA.sendRaw(raw);
    }
    for (const message of VALID_JSON_INVALID_MESSAGES) {
      clientA.sendRaw(JSON.stringify(message));
    }

    const probe = makeElement('probe-element');
    clientA.send(drawMessage('client-a', probe));
    await waitFor(
      async () => (await getBoard(app.httpUrl)).version === 2,
      'server still processes valid messages after garbage',
    );

    const after = await getBoard(app.httpUrl);
    assertEqual(after.version, 2, 'version only advanced by the valid probe draw');
    assertEqual(after.elements.length, 2, 'element count only changed by the valid probe draw');
    assertDeepEqual(
      after.elements[0],
      baseline.elements[0],
      'seed element untouched by malformed messages',
    );
    assertDeepEqual(after.elements[1], probe, 'probe element stored correctly');

    const badPost = await fetch(`${app.httpUrl}/api/board`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements: 'not-an-array' }),
    });
    assertEqual(badPost.status, 400, 'POST /api/board with invalid body rejected');

    const afterBadPost = await getBoard(app.httpUrl);
    assertEqual(afterBadPost.version, 2, 'version unchanged after rejected POST');
    assertEqual(afterBadPost.elements.length, 2, 'elements unchanged after rejected POST');

    const clientB = await TestClient.connect(app.wsUrl);
    clients.push(clientB);
    const syncForB = await clientB.waitForMessage((m) => m.type === 'sync', 'sync for clientB');
    if (syncForB.type !== 'sync') throw new Error('unreachable');
    assertDeepEqual(
      syncForB.elements,
      afterBadPost.elements,
      'new client sync reflects unpolluted state',
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
  }
}
