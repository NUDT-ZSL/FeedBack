import { Brick, BrickManager } from '../brick';
import { createSeededRandom } from '../random';
import { assert, equal, test } from './harness';

test('布局：800×600 蜂窝砖块数量、错位行列和存活数可复现', () => {
  const first = new BrickManager(800, 600, createSeededRandom(20260926));
  const second = new BrickManager(800, 600, createSeededRandom(20260926));

  first.generateHoneycombLayout();
  second.generateHoneycombLayout();

  equal(first.getBricks().length, 80, '蜂窝布局应生成 80 颗砖');
  equal(first.getBricks().filter((brick) => brick.alive).length, 80, '新布局存活砖数应为 80');
  equal(JSON.stringify(first.getBricks()), JSON.stringify(second.getBricks()), '相同种子必须生成相同蜂窝布局');

  const rows = [...new Set(first.getBricks().map((brick) => brick.y))];
  equal(rows.length, 3, '给定画布尺寸下应形成三行半区蜂窝砖');

  const rowsByY = rows.map((y) => first.getBricks().filter((brick) => brick.y === y));
  equal(rowsByY[0].length, 34, '偶数行数量必须可复现');
  equal(rowsByY[1].length, 33, '奇数行数量必须可复现');
  equal(rowsByY[2].length, 13, '达到 80 颗上限后的末行数量必须可复现');
  equal(rowsByY[0][0].x, 22, '偶数行起始 x 必须固定');
  equal(rowsByY[1][0].x, 33, '奇数行必须相对上一行横向错位半步');
  assert(rowsByY.every((rowBricks) => rowBricks.every((brick) => brick.alive)), '布局中的每颗砖初始都应存活');
});

test('布局：空管理器进度为 0，且不会生成砖块', () => {
  const manager = new BrickManager(800, 600, createSeededRandom(1));

  equal(manager.getBricks().length, 0, '未生成布局时砖块数应为 0');
  equal(manager.getProgress(), 0, '空布局进度必须为 0');
});

test('布局：同一行相邻、错行斜向相邻和跨行非相邻判定确定', () => {
  const manager = new BrickManager(800, 600);
  const source: Brick = { x: 100, y: 100, radius: 10, color: '#fff', alive: true };
  const sameRowNeighbor: Brick = { x: 122, y: 100, radius: 10, color: '#fff', alive: true };
  const offsetRowNeighbor: Brick = { x: 111, y: 122, radius: 10, color: '#fff', alive: true };
  const verticalNonNeighbor: Brick = { x: 100, y: 122, radius: 10, color: '#fff', alive: true };

  assert(manager.isAdjacent(source, sameRowNeighbor), '同一行相距 22px 必须判定为相邻');
  assert(manager.isAdjacent(source, offsetRowNeighbor), '错行半步且下一行必须判定为斜向相邻');
  assert(!manager.isAdjacent(source, verticalNonNeighbor), '跨行垂直对齐不应判定为相邻');
});

test('计数：连锁返回值等于实际被消除的砖块数量，全部清除后进度为 1', () => {
  const manager = new BrickManager(800, 600, () => 0);
  const center: Brick = { x: 100, y: 100, radius: 10, color: '#ff4757', alive: true };
  const right: Brick = { x: 122, y: 100, radius: 10, color: '#1e90ff', alive: true };
  const lowerRight: Brick = { x: 111, y: 122, radius: 10, color: '#2ed573', alive: true };
  (manager as unknown as { bricks: Brick[] }).bricks = [center, right, lowerRight];
  (manager as unknown as { totalBricks: number }).totalBricks = 3;

  const result = manager.checkCollision(100, 100, 10);
  const removedCount = [center, right, lowerRight].filter((brick) => !brick.alive).length;

  assert(result.hit, '真实重叠必须触发砖块碰撞');
  equal(result.comboChain, removedCount, '连锁计数必须与实际消除砖块数量一致');
  equal(result.comboChain, 3, '主砖和两个相邻砖都应被连锁消除');
  equal(manager.getProgress(), 1, '全部砖块消除后进度必须为 1');
});

test('计数：固定随机源完整清除 80 颗砖时累计连锁数与砖块数一致', () => {
  const manager = new BrickManager(800, 600, () => 1);
  manager.generateHoneycombLayout();
  const positions = manager.getBricks().map((brick) => ({ x: brick.x, y: brick.y }));
  let chainTotal = 0;

  for (const position of positions) {
    const result = manager.checkCollision(position.x, position.y, 0);
    if (result.hit) chainTotal += result.comboChain;
  }

  equal(manager.getBricks().filter((brick) => brick.alive).length, 0, '固定布局中的所有砖都应被清除');
  equal(chainTotal, 80, '逐砖消除的连锁总数必须等于实际砖块总数');
  equal(manager.getProgress(), 1, '80 颗砖全部消除后进度必须为 1');
});
