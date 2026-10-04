declare const process: { exit(code: number): void };
import { NetworkManager, Operation, replayOperations } from '../src/network/NetworkManager';
import { BlockData } from '../src/network/NetworkManager';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function testMockModeConsistency(): Promise<void> {
  console.log('--- mock 模式：实时状态 vs 日志重放 ---');
  const nm = new NetworkManager();

  const rtBlocks = new Map<string, BlockData>();
  const rtPlayers = new Map<string, { id: string; x: number; y: number }>();

  nm.connect({
    onWorldState: (blocks, players) => {
      rtBlocks.clear();
      rtPlayers.clear();
      blocks.forEach(b => rtBlocks.set(`${b.x},${b.y}`, { ...b }));
      players.forEach(p => rtPlayers.set(p.id, { id: p.id, x: p.x, y: p.y }));
    },
    onPlayerJoin: p => rtPlayers.set(p.id, { id: p.id, x: p.x, y: p.y }),
    onPlayerLeave: id => rtPlayers.delete(id),
    onPlayerMove: (id, x, y) => {
      const p = rtPlayers.get(id);
      if (p) { p.x = x; p.y = y; }
    },
    onBlockPlace: (x, y, color) => rtBlocks.set(`${x},${y}`, { x, y, color, isIndestructible: false }),
    onBlockBreak: (x, y) => rtBlocks.delete(`${x},${y}`)
  });

  await new Promise(r => setTimeout(r, 1800));

  const meId = nm.getPlayerId();
  nm.sendBlockPlace(10, 40, '#FF0000');
  rtBlocks.set('10,40', { x: 10, y: 40, color: '#FF0000', isIndestructible: false });
  nm.sendBlockPlace(10, 40, '#00FF00');
  rtBlocks.set('10,40', { x: 10, y: 40, color: '#00FF00', isIndestructible: false });
  nm.sendBlockBreak(10, 40);
  rtBlocks.delete('10,40');
  nm.sendBlockPlace(11, 40, '#0000FF');
  rtBlocks.set('11,40', { x: 11, y: 40, color: '#0000FF', isIndestructible: false });
  nm.sendPlayerMove(26, 26);
  const me1 = rtPlayers.get(meId);
  if (me1) { me1.x = 26; me1.y = 26; }
  nm.sendPlayerMove(27, 26);
  const me2 = rtPlayers.get(meId);
  if (me2) { me2.x = 27; me2.y = 26; }

  await new Promise(r => setTimeout(r, 1000));

  const log = nm.getOperationLog();
  assert(log.length > 0, `日志非空（${log.length} 条）`);
  assert(log.every((op, i) => op.seq === i + 1), '序号从 1 开始连续递增');
  assert(log.some(op => op.type === 'world_state'), '初始地面已进入日志');
  assert(log.filter(op => op.type === 'player_join').length === 2, '两名玩家加入已进入日志');
  assert(log.some(op => op.type === 'player_move' && op.source === 'bot_1'), '机器人随机移动已进入日志');

  const live = nm.getSnapshot();
  const replayed = nm.replayOperations(log);
  assert(deepEqual(replayed.snapshot, live), '重放快照与实时快照逐项一致（含来源归属）');
  assert(replayed.missingRanges.length === 0, '完整日志无缺失区间');
  assert(replayed.skippedDuplicates.length === 0, '完整日志无重复序号');

  const replayedAgain = nm.replayOperations(nm.getOperationLog());
  assert(deepEqual(replayedAgain.snapshot, replayed.snapshot), '同一日志重复重放结果相同');

  const liveByKey = new Map(live.blocks.map(b => [`${b.x},${b.y}`, b]));
  let blocksMatch = live.blocks.length === rtBlocks.size;
  rtBlocks.forEach((b, k) => {
    const lb = liveByKey.get(k);
    if (!lb || lb.color !== b.color) blocksMatch = false;
  });
  assert(blocksMatch, '实时方块表与快照方块集合一致');

  const livePlayerById = new Map(live.players.map(p => [p.id, p]));
  let playersMatch = live.players.length === rtPlayers.size;
  rtPlayers.forEach((p, id) => {
    const lp = livePlayerById.get(id);
    if (!lp || lp.x !== p.x || lp.y !== p.y) playersMatch = false;
  });
  assert(playersMatch, '实时玩家表与快照玩家位置一致');

  const cut = Math.floor(log.length / 2);
  const baseResult = nm.replayOperations(nm.getOperationsSince(0).filter(op => op.seq <= cut));
  const incremental = nm.replayOperations(nm.getOperationsSince(cut), {
    base: baseResult.snapshot,
    baseSeq: cut
  });
  assert(deepEqual(incremental.snapshot, live), '从某个序号之后的操作可在基础快照上增量重放');
  assert(incremental.missingRanges.length === 0, '增量重放无缺失区间');

  nm.disconnect();
}

function testCraftedLog(): void {
  console.log('--- 手工日志：重复序号 / 空洞 / 混合操作 ---');
  const ops: Operation[] = [
    { seq: 1, source: 'server', type: 'world_state', blocks: [{ x: 0, y: 49, color: '#654321', isIndestructible: true }], players: [{ id: 'p1', name: 'A', x: 1, y: 1, hatColor: '#FF0000' }] },
    { seq: 2, source: 'p1', type: 'block_place', x: 5, y: 5, color: '#FF0000' },
    { seq: 3, source: 'p1', type: 'block_break', x: 5, y: 5 },
    { seq: 4, source: 'p2', type: 'block_place', x: 5, y: 5, color: '#00FF00' },
    { seq: 3, source: 'p1', type: 'block_break', x: 5, y: 5 },
    { seq: 5, source: 'p1', type: 'player_move', playerId: 'p1', x: 2, y: 3 },
    { seq: 8, source: 'server', type: 'player_join', player: { id: 'p2', name: 'B', x: 9, y: 9, hatColor: '#00FF00' } },
    { seq: 9, source: 'p2', type: 'player_move', playerId: 'p2', x: 10, y: 9 }
  ];

  const result = replayOperations(ops);
  const block55 = result.snapshot.blocks.find(b => b.x === 5 && b.y === 5);
  assert(!!block55 && block55.color === '#00FF00' && block55.source === 'p2',
    '同一坐标 放置→破坏→再放置 按完整顺序应用，保留最终值与来源');
  assert(deepEqual(result.skippedDuplicates, [3]), '重复序号 3 被识别并跳过');
  assert(deepEqual(result.missingRanges, [{ from: 6, to: 7 }]), '序号空洞 6-7 被明确报告');

  const p1 = result.snapshot.players.find(p => p.id === 'p1');
  const p2 = result.snapshot.players.find(p => p.id === 'p2');
  assert(!!p1 && p1.x === 2 && p1.y === 3 && p1.source === 'p1', '玩家移动与方块改动混合时 p1 位置正确');
  assert(!!p2 && p2.x === 10 && p2.y === 9 && p2.source === 'p2', '玩家移动与方块改动混合时 p2 位置正确');
  assert(result.snapshot.blocks.some(b => b.x === 0 && b.y === 49 && b.source === 'server'), '初始地面来源归属为 server');

  const again = replayOperations(ops);
  assert(deepEqual(again, result), '同一日志重复重放结果完全一致');

  const shuffled = [...ops].reverse();
  const reshuffled = replayOperations(shuffled);
  assert(deepEqual(reshuffled.snapshot, result.snapshot), '乱序输入按序号排序后重放结果一致');

  const dupWorld = replayOperations([ops[0], ops[0], ops[1]]);
  assert(deepEqual(dupWorld.skippedDuplicates, [1]), '重复的 world_state 操作同样被跳过');
  assert(dupWorld.snapshot.blocks.length === 2, 'world_state 未被应用两次');
}

async function main(): Promise<void> {
  testCraftedLog();
  await testMockModeConsistency();
  if (failures > 0) {
    console.error(`\n${failures} 项断言失败`);
    process.exit(1);
  }
  console.log('\n全部断言通过');
  process.exit(0);
}

main();
