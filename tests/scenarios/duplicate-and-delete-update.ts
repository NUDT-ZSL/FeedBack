import {
  startServer,
  TestClient,
  getBoard,
  makeElement,
  drawMessage,
  updateMessage,
  deleteMessage,
  assertEqual,
} from '../helpers';

export const name = 'duplicate-and-delete-update: 重复提交同一元素、删除后再更新，画布与版本一致';

export async function run(): Promise<void> {
  const app = await startServer();
  const clients: TestClient[] = [];
  try {
    const clientA = await TestClient.connect(app.wsUrl);
    const clientB = await TestClient.connect(app.wsUrl);
    clients.push(clientA, clientB);
    await clientA.waitForMessage((m) => m.type === 'sync', 'clientA sync');
    await clientB.waitForMessage((m) => m.type === 'sync', 'clientB sync');

    const element = makeElement('dup-element');
    clientA.send(drawMessage('client-a', element));
    clientA.send(drawMessage('client-a', element));
    clientB.send(drawMessage('client-b', element));

    await clientA.waitForMessage(
      (m) => m.type === 'draw' && m.element.id === element.id,
      'clientA sees clientB draw broadcast',
    );
    await clientB.waitForMessage(
      (m) => m.type === 'draw' && m.element.id === element.id
        && clientB.ofType('draw').filter((d) => d.element.id === element.id).length >= 2,
      'clientB sees both of clientA draw broadcasts',
    );

    let board = await getBoard(app.httpUrl);
    assertEqual(
      board.elements.filter((e) => e.id === element.id).length,
      1,
      'element stored exactly once after duplicate draw submissions',
    );
    assertEqual(board.version, 1, 'version advances only once for duplicate draws');

    clientA.send(deleteMessage('client-a', element.id));
    clientA.send(updateMessage('client-a', element.id, { x: 999 }));
    await clientB.waitForMessage(
      (m) => m.type === 'update' && m.elementId === element.id,
      'clientB sees update broadcast after delete',
    );

    board = await getBoard(app.httpUrl);
    assertEqual(board.elements.length, 0, 'canvas empty after delete');
    assertEqual(
      board.version,
      2,
      'version advances for delete but not for update of a deleted element',
    );

    clientA.send(updateMessage('client-a', 'ghost-element', { x: 1 }));
    clientA.send(deleteMessage('client-a', 'ghost-element'));
    await clientB.waitForMessage(
      (m) => m.type === 'delete' && m.elementId === 'ghost-element',
      'clientB sees delete broadcast for ghost element',
    );

    board = await getBoard(app.httpUrl);
    assertEqual(board.elements.length, 0, 'canvas still empty after no-op update/delete');
    assertEqual(board.version, 2, 'version unchanged by no-op update/delete');

    const second = makeElement('second-element');
    clientA.send(drawMessage('client-a', second));
    clientA.send(updateMessage('client-a', second.id, { x: 777, color: '#ff0000' }));
    await clientB.waitForMessage(
      (m) => m.type === 'update' && m.elementId === second.id,
      'clientB sees update of second element',
    );

    board = await getBoard(app.httpUrl);
    assertEqual(board.elements.length, 1, 'one element after re-draw');
    assertEqual(board.version, 4, 'version advances once per effective mutation');
    assertEqual(board.elements[0].x, 777, 'update applied to re-drawn element');
    assertEqual(board.elements[0].color, '#ff0000', 'update color applied');

    clientA.send(deleteMessage('client-a', second.id));
    clientA.send(updateMessage('client-a', second.id, { x: 555 }));
    await clientB.waitForMessage(
      (m) => m.type === 'update' && m.elementId === second.id,
      'clientB sees update broadcast after second delete',
    );

    board = await getBoard(app.httpUrl);
    assertEqual(board.elements.length, 0, 'canvas empty after final delete');
    assertEqual(board.version, 5, 'final version matches effective mutation count');
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
  }
}
