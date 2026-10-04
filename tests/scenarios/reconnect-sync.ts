import {
  startServer,
  TestClient,
  getBoard,
  makeElement,
  drawMessage,
  updateMessage,
  deleteMessage,
  assertEqual,
  assertDeepEqual,
} from '../helpers';

export const name = 'reconnect-sync: 断线重连后 sync 消息与服务端当前状态一致';

export async function run(): Promise<void> {
  const app = await startServer();
  const clients: TestClient[] = [];
  try {
    let clientA = await TestClient.connect(app.wsUrl);
    clients.push(clientA);
    await clientA.waitForMessage((m) => m.type === 'sync', 'initial sync for clientA');

    const element1 = makeElement('reconnect-el-1');
    const element2 = makeElement('reconnect-el-2');
    clientA.send(drawMessage('client-a', element1));
    clientA.send(drawMessage('client-a', element2));
    clientA.send(updateMessage('client-a', element1.id, { x: 321 }));
    await waitForVersion(app.httpUrl, 3);

    const snapshotBefore = await getBoard(app.httpUrl);
    await clientA.close();

    const clientB = await TestClient.connect(app.wsUrl);
    clients.push(clientB);
    const syncForB = await clientB.waitForMessage((m) => m.type === 'sync', 'sync for clientB');
    if (syncForB.type !== 'sync') throw new Error('unreachable');
    assertDeepEqual(
      syncForB.elements,
      snapshotBefore.elements,
      'sync elements received by freshly connected clientB',
    );

    clientB.send(drawMessage('client-b', makeElement('reconnect-el-3')));
    clientB.send(deleteMessage('client-b', element2.id));
    await waitForVersion(app.httpUrl, snapshotBefore.version + 2);

    const snapshotWhileAGone = await getBoard(app.httpUrl);

    clientA = await TestClient.connect(app.wsUrl);
    clients.push(clientA);
    const firstMessage = await clientA.waitForMessage(() => true, 'first message after reconnect');
    assertEqual(firstMessage.type, 'sync', 'first message after reconnect is sync');
    if (firstMessage.type !== 'sync') throw new Error('unreachable');
    assertDeepEqual(
      firstMessage.elements,
      snapshotWhileAGone.elements,
      'sync elements after reconnect (includes changes made while disconnected)',
    );
    assertEqual(
      firstMessage.elements.some((e) => e.id === element2.id),
      false,
      'deleted element absent from reconnect sync',
    );
    assertEqual(
      firstMessage.elements.some((e) => e.id === 'reconnect-el-3'),
      true,
      'element added during disconnect present in reconnect sync',
    );

    const finalBoard = await getBoard(app.httpUrl);
    assertDeepEqual(
      firstMessage.elements,
      finalBoard.elements,
      'reconnect sync matches GET /api/board state',
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
  }
}

async function waitForVersion(httpUrl: string, version: number): Promise<void> {
  const { waitFor } = await import('../helpers');
  await waitFor(
    async () => (await getBoard(httpUrl)).version === version,
    `board version reaches ${version}`,
  );
}
