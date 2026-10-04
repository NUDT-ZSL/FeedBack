import {
  startServer,
  TestClient,
  assertEqual,
} from '../helpers';
import type { WSMessage } from '../../src/types';

export const name = 'presence: 用户进出时广播的在线人数与真实连接集合吻合';

function lastUsersMessage(client: TestClient): Extract<WSMessage, { type: 'users' }> {
  const usersMessages = client.ofType('users');
  if (usersMessages.length === 0) {
    throw new Error('expected at least one users broadcast');
  }
  return usersMessages[usersMessages.length - 1];
}

export async function run(): Promise<void> {
  const app = await startServer();
  const clients: TestClient[] = [];
  try {
    const clientA = await TestClient.connect(app.wsUrl);
    clients.push(clientA);
    await clientA.waitForMessage(
      (m) => m.type === 'users' && m.count === 1,
      'users broadcast with count 1 after first connect',
    );

    const clientB = await TestClient.connect(app.wsUrl);
    clients.push(clientB);
    await clientA.waitForMessage(
      (m) => m.type === 'users' && m.count === 2,
      'users broadcast with count 2 on clientA',
    );
    await clientB.waitForMessage(
      (m) => m.type === 'users' && m.count === 2,
      'users broadcast with count 2 on clientB',
    );

    const clientC = await TestClient.connect(app.wsUrl);
    clients.push(clientC);
    for (const [label, client] of [['A', clientA], ['B', clientB], ['C', clientC]] as const) {
      await client.waitForMessage(
        (m) => m.type === 'users' && m.count === 3,
        `users broadcast with count 3 on client${label}`,
      );
    }

    const idsAtThree = new Set(lastUsersMessage(clientA).userIds);
    assertEqual(idsAtThree.size, 3, 'userIds unique at 3 connections');
    for (const client of [clientB, clientC]) {
      const usersMsg = lastUsersMessage(client);
      assertEqual(usersMsg.count, usersMsg.userIds.length, 'count matches userIds length');
      assertEqual(
        new Set(usersMsg.userIds).size === 3
          && usersMsg.userIds.every((id) => idsAtThree.has(id)),
        true,
        'all clients see the same userId set',
      );
    }
    assertEqual(app.server.getState().userCount, 3, 'server-side connection count is 3');

    await clientB.close();
    await clientA.waitForMessage(
      (m) => m.type === 'users' && m.count === 2,
      'users broadcast with count 2 after clientB leaves',
    );
    await clientC.waitForMessage(
      (m) => m.type === 'users' && m.count === 2,
      'users broadcast with count 2 after clientB leaves (clientC)',
    );

    const leaveSeen = await clientA.waitForMessage(
      (m) => m.type === 'leave',
      'leave broadcast on clientA',
    );
    if (leaveSeen.type !== 'leave') throw new Error('unreachable');

    const idsAtTwo = new Set(lastUsersMessage(clientA).userIds);
    assertEqual(idsAtTwo.size, 2, 'userIds unique at 2 connections');
    assertEqual(
      [...idsAtTwo].every((id) => idsAtThree.has(id)),
      true,
      'remaining userIds are a subset of the previous set',
    );
    assertEqual(
      idsAtTwo.has(leaveSeen.userId),
      false,
      'departed userId no longer broadcast as online',
    );
    assertEqual(
      new Set(lastUsersMessage(clientC).userIds).size === 2
        && lastUsersMessage(clientC).userIds.every((id) => idsAtTwo.has(id)),
      true,
      'clientC sees the same remaining userId set as clientA',
    );
    assertEqual(app.server.getState().userCount, 2, 'server-side connection count is 2');

    await clientA.close();
    await clientC.waitForMessage(
      (m) => m.type === 'users' && m.count === 1,
      'users broadcast with count 1 after clientA leaves',
    );
    assertEqual(lastUsersMessage(clientC).userIds.length, 1, 'one userId remains');
    assertEqual(app.server.getState().userCount, 1, 'server-side connection count is 1');

    await clientC.close();
    const { waitFor } = await import('../helpers');
    await waitFor(
      () => app.server.getState().userCount === 0,
      'server-side connection count drops to 0',
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await app.close();
  }
}
