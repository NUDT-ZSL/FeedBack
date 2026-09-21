/* Node smoke tests for dungeon.js: determinism, constraints, validation, reachability. */
'use strict';
const assert = require('assert');
const D = require('./dungeon.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS  ' + name);
}

function gridKey(r) { return Buffer.from(r.grid).toString('hex'); }

test('相同种子与参数生成完全一致的地图', () => {
  const a = D.generate({ seed: 'abc-42' });
  const b = D.generate({ seed: 'abc-42' });
  assert.strictEqual(gridKey(a), gridKey(b));
  assert.deepStrictEqual(a.targets, b.targets);
  assert.deepStrictEqual(a.stats, b.stats);
});

test('不同种子生成不同地图', () => {
  const a = D.generate({ seed: 'seed-a' });
  const b = D.generate({ seed: 'seed-b' });
  assert.notStrictEqual(gridKey(a), gridKey(b));
});

test('数字种子与字符串种子均可复现', () => {
  const a = D.generate({ seed: 12345 });
  const b = D.generate({ seed: '12345' });
  assert.strictEqual(gridKey(a), gridKey(b));
});

test('房间数量与走廊数量满足约束', () => {
  const r = D.generate({ seed: 'rooms', roomCount: 14, extraCorridors: 4 });
  assert.strictEqual(r.stats.roomCount, 14);
  assert.strictEqual(r.corridors.filter(c => c.kind === 'mst').length, 13);
  assert.ok(r.stats.corridorCount >= 13);
});

test('基础结构连通：忽略水域岩浆时所有房间中心可达', () => {
  const r = D.generate({ seed: 'conn', waterRatio: 0.4, lavaRatio: 0.3 });
  const start = r.spawn.y * r.width + r.spawn.x;
  const seen = new Uint8Array(r.grid.length);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const cur = q.pop();
    const cx = cur % r.width, cy = (cur / r.width) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height) continue;
      const ni = ny * r.width + nx;
      if (seen[ni] || r.grid[ni] === D.TILE.WALL) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  for (const room of r.rooms) assert.ok(seen[room.cy * r.width + room.cx], 'room center reachable');
});
test('可达性标记与可达网格一致', () => {
  const r = D.generate({ seed: 'reach', waterRatio: 0.3, lavaRatio: 0.2 });
  for (const t of r.targets) {
    const idx = t.y * r.width + t.x;
    assert.strictEqual(t.reachable, !!r.reachableGrid[idx]);
    if (!t.reachable) assert.ok(['water', 'lava', 'corridor', 'terrain'].includes(t.blockedBy));
  }
  assert.strictEqual(r.stats.reachableTargets, r.targets.filter(t => t.reachable).length);
});

test('不可达目标能被诊断出破坏的约束', () => {
  let found = null;
  for (let i = 0; i < 60 && !found; i++) {
    const r = D.generate({ seed: 'flood-' + i, waterRatio: 0.45, lavaRatio: 0.3, extraCorridors: 0 });
    const bad = r.targets.find(t => !t.reachable);
    if (bad) found = { r, bad };
  }
  assert.ok(found, '应能构造出含不可达目标的地图');
  assert.ok(found.bad.blockedBy, '不可达目标必须有 blockedBy 诊断');
  console.log('      示例：目标 #' + found.bad.id + ' 不可达，原因=' + found.bad.blockedBy);
});

test('非法参数抛出明确错误且不产出地图', () => {
  const cases = [
    [{ seed: '' }, '空种子'],
    [{ width: 10 }, '宽度过小'],
    [{ roomCount: 1 }, '房间数过少'],
    [{ minRoomSize: 8, maxRoomSize: 4 }, '尺寸倒挂'],
    [{ waterRatio: 0.9 }, '水域比例越界'],
    [{ waterRatio: 0.5, lavaRatio: 0.5 }, '地形比例之和越界'],
    [{ targetCount: 0 }, '目标数为零']
  ];
  for (const [params, label] of cases) {
    assert.throws(() => D.generate(params), err => {
      assert.ok(err.validationErrors && err.validationErrors.length > 0, label + ' 应带 validationErrors');
      return true;
    }, label);
  }
});

test('地图空间不足时明确报错而非产出残缺地图', () => {
  assert.throws(
    () => D.generate({ seed: 'x', width: 24, height: 24, roomCount: 60, minRoomSize: 6, maxRoomSize: 10 }),
    /空间不足/
  );
});

test('地形分布统计与参数一致', () => {
  const r = D.generate({ seed: 'terrain', waterRatio: 0.1, lavaRatio: 0.05 });
  let water = 0, lava = 0;
  for (const t of r.grid) {
    if (t === D.TILE.WATER) water++;
    else if (t === D.TILE.LAVA) lava++;
  }
  assert.strictEqual(water, r.stats.waterTiles);
  assert.strictEqual(lava, r.stats.lavaTiles);
});

console.log('\n全部 ' + passed + ' 项测试通过');
