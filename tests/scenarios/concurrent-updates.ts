import {
  startServer,
  TestClient,
  getBoard,
  makeElement,
  drawMessage,
  updateMessage,
  assertEqual,
  assertDeepEqual,
} from '../helpers';
import type { CanvasElement } from '../../src/types';

const WRITERS = 3;
const UPDATES_PER_WRITER = 10;

export const name = 'concurrent-updates: 多客户端并发写同一元素，最终状态与版本推进自洽';

export async function run(): Promise<void> {
  const app = await startServer();
  const clients: TestClient[] = [];
  try {
    const observer = await TestClient.connect(app.wsUrl);
    clients.push(observer);
    await observer.waitForMessage((m) => m.type === 'sync', 'observer sync');

    const writerA = await TestClient.connect(app.wsUrl);
    const writerB = await TestClient.connect(app.wsUrl);
    const writerC = await TestClient.connect(app.wsUrl);
    clients.push(writerA, writerB, writerC);
    const writers = [writerA, writerB, writerC];

    const seed = makeElement('shared-element');
    writerA.send(drawMessage('writer-a', seed));
    await observer.waitForMessage(
      (m) => m.type === 'draw' && m.element.id === seed.id,
      'observer sees seed draw',
    );
    const seeded = await getBoard(app.httpUrl);
    assertEqual(seeded.version, 1, 'version after seed draw');

    const writerIds = ['writer-a', 'writer-b', 'writer-c'];
    for (let i = 0; i < UPDATES_PER_WRITER; i++) {
      for (let w = 0; w < WRITERS; w++) {
        writers[w].send(updateMessage(writerIds[w], seed.id, {
          x: 1000 * (w + 1) + i,
          y: 500 * (w + 1) + i,
          color: `#w${w}i${i}`,
        }));
      }
    }

    const totalUpdates = WRITERS * UPDATES_PER_WRITER;
    await observer.waitForMessage(
      (m) => m.type === 'update'
        && m.elementId === seed.id
        && observer.ofType('update').filter((u) => u.elementId === seed.id).length >= totalUpdates,
      `observer receives all ${totalUpdates} update broadcasts`,
    );

    const observedUpdates = observer
      .ofType('update')
      .filter((u) => u.elementId === seed.id);
    assertEqual(observedUpdates.length, totalUpdates, 'observer update broadcast count');

    let expected: CanvasElement = { ...seed };
    for (const update of observedUpdates) {
      expected = { ...expected, ...update.updates };
    }

    const board = await getBoard(app.httpUrl);
    assertEqual(
      board.elements.filter((e) => e.id === seed.id).length,
      1,
      'element count for shared id after concurrent writes',
    );
    assertEqual(board.elements.length, 1, 'total element count');
    assertEqual(
      board.version,
      1 + totalUpdates,
      'version progression (seed + one increment per applied update)',
    );
    assertDeepEqual(
      board.elements[0],
      expected,
      'final element state (fold of broadcasts in server application order)',
    );

    for (let w = 0; w < WRITERS; w++) {
      const received = writers[w]
        .ofType('update')
        .filter((u) => u.elementId === seed.id).length;
      assertEqual(
        received,
        totalUpdates - UPDATES_PER_WRITER,
        `broadcast fan-out to ${writerIds[w]} (all updates except its own)`,
      );
    }
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
  }
}
