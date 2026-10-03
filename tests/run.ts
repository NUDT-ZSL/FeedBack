import { createBoardServer, type BoardServer } from '../server';
import {
  TestClient,
  assert,
  assertDeepEqual,
  fetchBoard,
  makeElement,
  waitUntil,
} from './helpers';

interface Scenario {
  name: string;
  run: (server: BoardServer, port: number) => Promise<void>;
}

const scenarios: Scenario[] = [
  {
    name: '并发写入同一元素: 最终状态与版本推进自洽',
    async run(server, port) {
      const clientA = await TestClient.connect(port);
      const clientB = await TestClient.connect(port);
      const clientC = await TestClient.connect(port);

      const shared = makeElement('shared-el');
      clientA.send({ type: 'draw', userId: 'A', element: shared, timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 1, 'draw 生效');

      clientA.send({ type: 'update', userId: 'A', elementId: 'shared-el', updates: { color: '#ff0000' }, timestamp: Date.now() });
      clientB.send({ type: 'update', userId: 'B', elementId: 'shared-el', updates: { color: '#00ff00' }, timestamp: Date.now() });
      clientC.send({ type: 'update', userId: 'C', elementId: 'shared-el', updates: { color: '#0000ff' }, timestamp: Date.now() });

      await waitUntil(() => server.getSnapshot().version === 4, '三个并发 update 全部生效');

      const snapshot = server.getSnapshot();
      const matches = snapshot.elements.filter((e) => e.id === 'shared-el');
      assert(matches.length === 1, '同一元素并发写入后画布中应只有一份', 1, matches.length);
      assert(
        ['#ff0000', '#00ff00', '#0000ff'].includes(matches[0].color),
        '最终颜色应是三个并发写入之一(最后写入者胜出)',
        ['#ff0000', '#00ff00', '#0000ff'],
        matches[0].color,
      );
      assert(snapshot.version === 4, '每次有效写入推进一次版本: 1 draw + 3 update', 4, snapshot.version);

      const viaHttp = await fetchBoard(port);
      assertDeepEqual(viaHttp, { elements: snapshot.elements, version: snapshot.version },
        'HTTP GET /api/board 应与服务端内部状态一致');

      await clientA.close();
      await clientB.close();
      await clientC.close();
    },
  },
  {
    name: '重复提交与删除后再更新: 画布内容与版本号一致',
    async run(server, port) {
      const client = await TestClient.connect(port);
      const el = makeElement('dup-el');

      client.send({ type: 'draw', userId: 'A', element: el, timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 1, '首次 draw 生效');

      client.send({ type: 'draw', userId: 'A', element: el, timestamp: Date.now() });
      client.send({ type: 'draw', userId: 'A', element: makeElement('probe-1'), timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 2, '探针 draw 生效(同一连接按序处理, 重复提交此时已处理完)');
      let snapshot = server.getSnapshot();
      assert(snapshot.elements.length === 2, '重复提交同一 id 的元素不应重复入画布', 2, snapshot.elements.length);
      assert(snapshot.version === 2, '重复提交被去重, 版本号不应额外推进', 2, snapshot.version);

      client.send({ type: 'delete', userId: 'A', elementId: 'dup-el', timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 3, 'delete 生效');

      client.send({ type: 'update', userId: 'A', elementId: 'dup-el', updates: { color: '#123456' }, timestamp: Date.now() });
      client.send({ type: 'delete', userId: 'A', elementId: 'probe-1', timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 4, '探针 delete 生效(此时对 dup-el 的 update 已处理完)');
      snapshot = server.getSnapshot();
      assert(!snapshot.elements.some((e) => e.id === 'dup-el'), '元素删除后再更新不应复活元素', 'dup-el 不存在', snapshot.elements.map((e) => e.id));
      assert(snapshot.elements.length === 0, '画布最终应为空', 0, snapshot.elements.length);
      assert(snapshot.version === 4, '对已删除元素的 update 是空操作, 版本号不应推进', 4, snapshot.version);

      const viaHttp = await fetchBoard(port);
      assertDeepEqual(viaHttp, { elements: [], version: 4 }, 'HTTP 视图应与服务端状态一致');

      await client.close();
    },
  },
  {
    name: '断线重连: sync 消息与服务端当前状态一致',
    async run(server, port) {
      const clientA = await TestClient.connect(port);
      clientA.send({ type: 'draw', userId: 'A', element: makeElement('el-1'), timestamp: Date.now() });
      clientA.send({ type: 'draw', userId: 'A', element: makeElement('el-2', { x: 50 }), timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 2, '两次 draw 生效');
      clientA.send({ type: 'update', userId: 'A', elementId: 'el-1', updates: { color: '#abcdef' }, timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 3, 'update 生效');
      await clientA.close();

      const clientB = await TestClient.connect(port);
      const sync = await clientB.waitForType('sync');
      const viaHttp = await fetchBoard(port);

      assert(sync.elements.length === 2, '重连后 sync 应携带全部 2 个元素', 2, sync.elements.length);
      assertDeepEqual(sync.elements, viaHttp.elements, 'sync 元素集合应与 GET /api/board 一致');
      assert(viaHttp.version === 3, '版本号应等于有效变更次数', 3, viaHttp.version);
      const el1 = sync.elements.find((e) => e.id === 'el-1');
      assert(el1?.color === '#abcdef', '断线前的更新应体现在重连后的 sync 中', '#abcdef', el1?.color);

      await clientB.close();
    },
  },
  {
    name: '非法消息: 服务端状态不被污染',
    async run(server, port) {
      const client = await TestClient.connect(port);
      client.send({ type: 'draw', userId: 'A', element: makeElement('valid-el'), timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 1, '合法 draw 生效');
      const before = server.getSnapshot();

      client.send('这不是 JSON {{{');
      client.send(JSON.stringify({ type: 'unknown-type', foo: 1 }));
      client.send(JSON.stringify({ type: 'draw' }));
      client.send(JSON.stringify({ type: 'update' }));
      client.send(JSON.stringify({ type: 'delete' }));
      client.send(JSON.stringify({ type: 'delete', elementId: 'not-exist' }));
      client.send(JSON.stringify(null));
      client.send(JSON.stringify([1, 2, 3]));

      client.send({ type: 'draw', userId: 'A', element: makeElement('after-garbage'), timestamp: Date.now() });
      await waitUntil(() => server.getSnapshot().version === 2, '非法消息之后服务端仍能正常处理合法消息(同一连接按序处理, 非法消息此时均已处理完)');
      const after = server.getSnapshot();
      assertDeepEqual(
        { elements: after.elements, version: after.version },
        { elements: [...before.elements, makeElement('after-garbage')], version: 2 },
        '非法/无法解析/空操作消息不应改变画布与版本号, 只应有探针 draw 带来的变化',
      );

      await client.close();
    },
  },
  {
    name: '用户进出: 广播人数与真实连接集合吻合',
    async run(server, port) {
      const clientA = await TestClient.connect(port);
      const users1 = await clientA.waitForType('users');
      assert(users1.count === 1, '第一个用户加入后广播人数应为 1', 1, users1.count);
      assertDeepEqual(users1.userIds, server.getSnapshot().userIds, '广播 userIds 应与服务端连接集合一致');

      const clientB = await TestClient.connect(port);
      const users2a = await clientA.waitForType('users');
      const users2b = await clientB.waitForType('users');
      assert(users2a.count === 2 && users2b.count === 2, '第二个用户加入后双方都应收到人数 2', 2, [users2a.count, users2b.count]);
      assertDeepEqual(
        [...users2a.userIds].sort(),
        [...server.getSnapshot().userIds].sort(),
        '广播 userIds 应覆盖全部真实连接',
      );

      await clientB.close();
      const users3 = await clientA.waitForType('users');
      assert(users3.count === 1, '用户离开后广播人数应回落为 1', 1, users3.count);
      assertDeepEqual(users3.userIds, server.getSnapshot().userIds, '离开后广播 userIds 应与剩余连接一致');

      const leave = clientA.log.find((m) => m.type === 'leave');
      assert(leave !== undefined, '在线用户应收到 leave 广播');

      await clientA.close();
    },
  },
];

async function main() {
  console.log('协作白板服务端验证套件 (离线, 真实消息路径)\n');
  let passed = 0;
  const failures: string[] = [];

  for (const scenario of scenarios) {
    const server = createBoardServer();
    const port = await server.listen(0);
    try {
      await scenario.run(server, port);
      passed++;
      console.log(`  ✔ ${scenario.name}`);
    } catch (error) {
      failures.push(scenario.name);
      console.log(`  ✘ ${scenario.name}`);
      console.log(`    ${(error as Error).message}`);
    } finally {
      await server.close();
    }
  }

  console.log(`\n结果: ${passed}/${scenarios.length} 通过`);
  if (failures.length > 0) {
    console.log(`失败场景: ${failures.join(' | ')}`);
    process.exit(1);
  }
}

main();
