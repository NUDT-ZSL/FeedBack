import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { createApp } from './app';
import { getCatalog, saveCatalog } from './lib/catalog';
import { StoredOrder } from './lib/types';

const VALID_DRAWING =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yulu-verify-'));
  const app = createApp({ dataDir });
  const server = await new Promise<import('http').Server>(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const postOrder = (body: unknown, idempotencyKey?: string) =>
    fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

  const validBody = () => ({
    fillings: [{ id: '1' }, { id: '2' }],
    mold: { id: '1' },
    drawingData: VALID_DRAWING,
    recipientName: '李奶奶',
    blessing: '福寿安康',
  });

  try {
    console.log('\n[1] 提交校验失败场景');
    const mismatch = await postOrder({ ...validBody(), fillings: [{ id: '1' }, { id: '2' }, { id: '3' }], mold: { id: '4' } });
    const mismatchJson = await mismatch.json() as any;
    check('馅料数量超出模具容量返回 400', mismatch.status === 400, `got ${mismatch.status}`);
    check(
      '返回馅料与模具不匹配的具体原因',
      mismatchJson.code === 'FILLINGS_EXCEED_MOLD_CAPACITY' && /扇形.*3/.test(mismatchJson.error),
      JSON.stringify(mismatchJson)
    );

    const emptyDrawing = await postOrder({ ...validBody(), drawingData: '' });
    const emptyDrawingJson = await emptyDrawing.json() as any;
    check('绘制数据为空返回 400', emptyDrawing.status === 400 && emptyDrawingJson.code === 'EMPTY_DRAWING');

    const badDrawing = await postOrder({ ...validBody(), drawingData: 'not-an-image' });
    const badDrawingJson = await badDrawing.json() as any;
    check('绘制数据格式非法返回 400', badDrawing.status === 400 && badDrawingJson.code === 'INVALID_DRAWING');

    const unknownFilling = await postOrder({ ...validBody(), fillings: [{ id: '999' }] });
    const unknownFillingJson = await unknownFilling.json() as any;
    check('未知馅料返回 400', unknownFilling.status === 400 && unknownFillingJson.code === 'UNKNOWN_FILLING');

    const noRecipient = await postOrder({ ...validBody(), recipientName: '' });
    check('缺少收件人返回 400', noRecipient.status === 400 && (await noRecipient.json() as any).code === 'MISSING_RECIPIENT');

    console.log('\n[2] 校验通过生成快照并可读取');
    const created = await postOrder(validBody(), 'verify-key-main');
    const createdJson = await created.json() as any;
    check('提交成功返回 201 与订单号', created.status === 201 && typeof createdJson.orderId === 'string');
    check('返回分享链接', typeof createdJson.shareLink === 'string' && createdJson.shareLink.includes(`/card/${createdJson.orderId}`));

    const fetched = await fetch(`${base}/api/orders/${createdJson.orderId}`);
    const fetchedJson = await fetched.json() as any;
    check('贺卡接口返回 200', fetched.status === 200);
    check(
      '快照内容与提交一致',
      fetchedJson.snapshot.fillings.map((f: { name: string }) => f.name).join('、') === '红豆沙、莲蓉' &&
        fetchedJson.snapshot.mold.name === '圆形' &&
        fetchedJson.snapshot.drawingData === VALID_DRAWING &&
        fetchedJson.snapshot.recipientName === '李奶奶',
      JSON.stringify(fetchedJson).slice(0, 200)
    );

    console.log('\n[3] 并发重复提交只产生一个订单');
    const dupKey = 'verify-key-concurrent';
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postOrder(validBody(), dupKey).then(r => r.json() as any))
    );
    const orderIds = new Set(results.map(r => r.orderId));
    check('并发请求返回同一订单号', orderIds.size === 1, [...orderIds].join(','));
    check('恰好一个请求为非重复', results.filter(r => r.duplicate === false).length === 1);
    const sequential = await (await postOrder(validBody(), dupKey)).json() as any;
    check('后续重复提交仍返回同一订单号', sequential.orderId === results[0].orderId && sequential.duplicate === true);
    const ordersFile: StoredOrder[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'orders.json'), 'utf-8'));
    check('存储中该幂等键只有一条订单', ordersFile.filter(o => o.idempotencyKey === dupKey).length === 1);

    console.log('\n[4] 馅料/模具数据变更后快照不变');
    const catalog = getCatalog(dataDir);
    catalog.fillings[0].name = '被改名的馅料';
    catalog.molds[0].name = '被改名的模具';
    catalog.molds[0].capacity = 99;
    saveCatalog(dataDir, catalog);
    const afterChange = await (await fetch(`${base}/api/orders/${createdJson.orderId}`)).json() as any;
    check(
      '快照中的馅料与模具保持下单时的内容',
      afterChange.snapshot.fillings[0].name === '红豆沙' && afterChange.snapshot.mold.name === '圆形',
      JSON.stringify(afterChange.snapshot.fillings[0])
    );

    console.log('\n[5] 快照损坏返回明确错误');
    const corrupted = ordersFile.map(o =>
      o.orderId === createdJson.orderId
        ? { ...o, snapshot: { ...o.snapshot, recipientName: '被篡改' } }
        : o
    );
    fs.writeFileSync(path.join(dataDir, 'orders.json'), JSON.stringify(corrupted, null, 2), 'utf-8');
    const corruptedRes = await fetch(`${base}/api/orders/${createdJson.orderId}`);
    const corruptedJson = await corruptedRes.json() as any;
    check('损坏快照返回 422', corruptedRes.status === 422, `got ${corruptedRes.status}`);
    check('返回快照损坏的明确原因', corruptedJson.code === 'SNAPSHOT_CORRUPTED' && /快照/.test(corruptedJson.error));

    console.log('\n[6] 订单不存在返回明确错误');
    const missing = await fetch(`${base}/api/orders/DS190001010000`);
    const missingJson = await missing.json() as any;
    check('不存在的订单返回 404', missing.status === 404);
    check('返回订单不存在的明确原因', missingJson.code === 'ORDER_NOT_FOUND' && /不存在/.test(missingJson.error));
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('验证脚本执行出错:', err);
  process.exit(1);
});
