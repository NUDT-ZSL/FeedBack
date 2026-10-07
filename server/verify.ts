import fs from 'fs';
import os from 'os';
import path from 'path';
import { fillingsData, moldsData } from './catalog';
import { OrderStore, StoredOrder } from './orderStore';
import { createOrder, getOrder } from './orderService';

const VALID_DRAWING = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function makeStore(): OrderStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yulu-orders-'));
  return new OrderStore(dir);
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fillings: [{ id: '1' }, { id: '2' }],
    mold: { id: '1' },
    drawingData: VALID_DRAWING,
    recipientName: '张三',
    blessing: '福寿安康',
    clientRequestId: 'req-' + Math.random().toString(36).slice(2),
    ...overrides,
  };
}

console.log('== 1. 提交校验失败场景 ==');
{
  const store = makeStore();

  const mismatch = createOrder(
    store,
    validPayload({ fillings: [{ id: '1' }, { id: '2' }], mold: { id: '6' } })
  );
  check(
    '馅料数量超过模具容量被拒绝',
    mismatch.status === 400 &&
      mismatch.errors.some(e => e.code === 'FILLING_MOLD_MISMATCH' && e.message.includes('动物形')),
    JSON.stringify(mismatch)
  );

  const emptyDrawing = createOrder(store, validPayload({ drawingData: '' }));
  check(
    '空绘制数据被拒绝',
    emptyDrawing.status === 400 && emptyDrawing.errors.some(e => e.code === 'DRAWING_EMPTY'),
    JSON.stringify(emptyDrawing)
  );

  const badDrawing = createOrder(store, validPayload({ drawingData: 'not-a-data-url' }));
  check(
    '非法绘制数据格式被拒绝',
    badDrawing.status === 400 && badDrawing.errors.some(e => e.code === 'DRAWING_INVALID'),
    JSON.stringify(badDrawing)
  );

  const badFilling = createOrder(store, validPayload({ fillings: [{ id: '999' }] }));
  check(
    '不存在的馅料被拒绝',
    badFilling.status === 400 && badFilling.errors.some(e => e.code === 'FILLING_NOT_FOUND'),
    JSON.stringify(badFilling)
  );

  const badMold = createOrder(store, validPayload({ mold: { id: '999' } }));
  check(
    '不存在的模具被拒绝',
    badMold.status === 400 && badMold.errors.some(e => e.code === 'MOLD_NOT_FOUND'),
    JSON.stringify(badMold)
  );

  const noBlessing = createOrder(store, validPayload({ blessing: '  ' }));
  check(
    '空祝福语被拒绝',
    noBlessing.status === 400 && noBlessing.errors.some(e => e.code === 'BLESSING_REQUIRED'),
    JSON.stringify(noBlessing)
  );

  const noRequestId = createOrder(store, validPayload({ clientRequestId: '' }));
  check(
    '缺少请求标识被拒绝',
    noRequestId.status === 400 &&
      noRequestId.errors.some(e => e.code === 'CLIENT_REQUEST_ID_REQUIRED'),
    JSON.stringify(noRequestId)
  );

  check('校验失败均未落库', store.readAll().length === 0, `orders=${store.readAll().length}`);
}

console.log('== 2. 重复提交（幂等）场景 ==');
{
  const store = makeStore();
  const payload = validPayload({ clientRequestId: 'req-duplicate-test' });

  const first = createOrder(store, payload);
  const second = createOrder(store, payload);
  const third = createOrder(store, payload);

  check('首次提交成功', first.status === 200 && first.duplicated === false, JSON.stringify(first));
  check(
    '重复提交返回同一订单号',
    second.status === 200 && third.status === 200 &&
      first.status === 200 &&
      second.orderId === first.orderId && third.orderId === first.orderId,
    JSON.stringify({ first, second, third })
  );
  check(
    '重复提交被标记为重复',
    second.status === 200 && second.duplicated === true && third.status === 200 && third.duplicated === true
  );
  check('只产生一条订单记录', store.readAll().length === 1, `orders=${store.readAll().length}`);
}

console.log('== 3. 快照读取场景 ==');
{
  const store = makeStore();
  const created = createOrder(store, validPayload({ clientRequestId: 'req-read-test' }));
  if (created.status !== 200) {
    check('创建订单用于读取', false, JSON.stringify(created));
  } else {
    const read = getOrder(store, created.orderId);
    check(
      '读取订单返回快照内容',
      read.status === 200 &&
        read.snapshot.fillings.map(f => f.id).join(',') === '1,2' &&
        read.snapshot.mold.id === '1' &&
        read.snapshot.drawingData === VALID_DRAWING &&
        read.snapshot.recipientName === '张三' &&
        read.snapshot.blessing === '福寿安康',
      JSON.stringify(read)
    );
  }

  const missing = getOrder(store, 'DS199901010000');
  check(
    '订单不存在返回明确错误',
    missing.status === 404 && missing.code === 'ORDER_NOT_FOUND',
    JSON.stringify(missing)
  );

  const corrupted = createOrder(store, validPayload({ clientRequestId: 'req-corrupt-test' }));
  if (corrupted.status !== 200) {
    check('创建订单用于损坏测试', false, JSON.stringify(corrupted));
  } else {
    const orders = store.readAll();
    const target = orders.find(o => o.orderId === (corrupted.status === 200 ? corrupted.orderId : ''));
    if (target) {
      target.snapshot = '{broken-json';
      fs.writeFileSync(store.filePath, JSON.stringify(orders, null, 2), 'utf-8');
    }
    const broken = getOrder(store, corrupted.orderId);
    check(
      '快照 JSON 损坏返回明确错误',
      broken.status === 500 && broken.code === 'SNAPSHOT_CORRUPTED',
      JSON.stringify(broken)
    );

    const orders2 = store.readAll();
    const target2 = orders2.find(
      (o: StoredOrder) => o.orderId === (corrupted.status === 200 ? corrupted.orderId : '')
    );
    if (target2) {
      corruptedOrderFix(target2);
      target2.snapshot = JSON.stringify({ ...JSON.parse(target2.snapshot), blessing: '被篡改' });
      fs.writeFileSync(store.filePath, JSON.stringify(orders2, null, 2), 'utf-8');
    }
    const tampered = getOrder(store, corrupted.orderId);
    check(
      '快照内容被篡改（哈希不符）返回明确错误',
      tampered.status === 500 && tampered.code === 'SNAPSHOT_CORRUPTED',
      JSON.stringify(tampered)
    );
  }
}

function corruptedOrderFix(order: StoredOrder): void {
  order.snapshot = JSON.stringify({
    fillings: [],
    mold: { id: '1', name: '圆形', shape: 'circle', maxFillings: 3 },
    drawingData: VALID_DRAWING,
    recipientName: '张三',
    blessing: '福寿安康',
  });
}

console.log('== 4. 目录数据变更后快照不变 ==');
{
  const store = makeStore();
  const created = createOrder(store, validPayload({ clientRequestId: 'req-immutable-test' }));
  if (created.status !== 200) {
    check('创建订单用于不可变测试', false, JSON.stringify(created));
  } else {
    const before = getOrder(store, created.orderId);

    const originalFillingName = fillingsData[0].name;
    const originalMoldName = moldsData[0].name;
    fillingsData[0].name = '被篡改的馅料名';
    moldsData[0].name = '被篡改的模具名';
    moldsData[0].maxFillings = 99;

    const after = getOrder(store, created.orderId);

    check(
      '馅料目录变更后快照馅料名不变',
      before.status === 200 && after.status === 200 &&
        after.snapshot.fillings[0].name === originalFillingName,
      JSON.stringify(after)
    );
    check(
      '模具目录变更后快照模具信息不变',
      after.status === 200 &&
        after.snapshot.mold.name === originalMoldName &&
        after.snapshot.mold.maxFillings === 3,
      JSON.stringify(after)
    );

    fillingsData[0].name = originalFillingName;
    moldsData[0].name = originalMoldName;
    moldsData[0].maxFillings = 3;
  }
}

console.log('');
console.log(`结果：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
