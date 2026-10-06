/**
 * 离线统一验证入口：无需网络与浏览器，直接跑通图鉴与对局记录的
 * 保存、恢复、幂等去重、乱序到达、冲突检测与用户裁决全部场景。
 *
 * 运行：npm run verify
 */
import {
  MemoryStorage,
  GALLERY_STORAGE_KEY,
  ROUNDS_STORAGE_KEY,
  GALLERY_LIMIT,
  loadGallery,
  saveGallery,
  upsertGalleryItem,
  loadRoundRecords,
  saveRoundRecords,
  appendRoundRecord,
  buildMatchHistory,
  resolveRoundConflict,
} from '../src/lib/persistence';
import type { GalleryItem, RoundRecord, Score, TeaPattern } from '../src/types';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

let uid = 0;
const nextId = () => `id-${++uid}`;

function score(color: number, duration: number, adhesion: number): Score {
  const total = Math.round((color + duration + adhesion) / 3);
  return { color, duration, adhesion, total };
}

const pineCrane: TeaPattern = {
  id: 'pine_crane',
  type: 'pine_crane',
  name: '松鹤延年',
  poem: 'p',
  paths: [],
};

const butterflies: TeaPattern = {
  id: 'butterflies',
  type: 'butterflies',
  name: '双蝶戏花',
  poem: 'p',
  paths: [],
};

function galleryItem(
  round: number,
  pattern: TeaPattern,
  thumbnail: string,
  roundScore: Score,
): GalleryItem {
  return { id: nextId(), round, pattern, thumbnail, roundScore, createdAt: Date.now() };
}

function roundRecord(round: number, userScore: Score, aiScore: Score): RoundRecord {
  return { id: nextId(), round, userScore, aiScore, updatedAt: Date.now() };
}

/* ---------------- 场景一：图鉴持久化保存与重启恢复 ---------------- */
console.log('\n[1] 图鉴保存与重启恢复（离线 localStorage 等价缓存）');
{
  const storage = new MemoryStorage();
  const gallery = [
    galleryItem(1, pineCrane, 'data:image/png;base64,A', score(80, 70, 90)),
    galleryItem(1, butterflies, 'data:image/png;base64,B', score(60, 60, 60)),
  ];
  saveGallery(gallery, storage);
  check('数据已写入本地缓存', storage.getItem(GALLERY_STORAGE_KEY) !== null);

  // 模拟服务重启 / 新会话：只通过缓存恢复，内存状态全部丢弃
  const restored = loadGallery(storage);
  check('重启后图鉴数量恢复', restored.length === 2, `got ${restored.length}`);
  check('缩略图内容完整恢复', restored.some(i => i.thumbnail.includes('A')));
  check('回合信息完整恢复', restored.every(i => typeof i.round === 'number'));
}

/* ---------------- 场景二：同回合重复点击幂等，最新结果为准 ---------------- */
console.log('\n[2] 同一回合重复提交同一图案：只保留一条且以最新为准');
{
  const storage = new MemoryStorage();
  let gallery = loadGallery(storage);

  gallery = upsertGalleryItem(
    gallery,
    galleryItem(3, pineCrane, 'thumb-v1', score(50, 50, 50)),
  );
  gallery = upsertGalleryItem(
    gallery,
    galleryItem(3, pineCrane, 'thumb-v2', score(90, 90, 90)),
  );
  gallery = upsertGalleryItem(
    gallery,
    galleryItem(3, pineCrane, 'thumb-v3', score(70, 70, 70)),
  );
  saveGallery(gallery, storage);

  const restored = loadGallery(storage);
  check('重复提交后仍只有一条收藏', restored.length === 1, `got ${restored.length}`);
  check('保留的是最新一次提交结果', restored[0].thumbnail === 'thumb-v3');
  check('最新分数覆盖旧分数', restored[0].roundScore.total === score(70, 70, 70).total);

  // 同回合收藏不同图案应分别保留
  let withOther = upsertGalleryItem(restored, galleryItem(3, butterflies, 'thumb-bfly', score(10, 10, 10)));
  check('同一回合不同图案各自保留', withOther.length === 2);
  // 不同回合同图案也分别保留
  withOther = upsertGalleryItem(withOther, galleryItem(4, pineCrane, 'thumb-r4', score(20, 20, 20)));
  check('不同回合同一图案各自保留', withOther.length === 3);
  check('不超过收藏上限', GALLERY_LIMIT >= 3);
}

/* ---------------- 场景三：对局记录保存、恢复与逐回合/累计战绩 ---------------- */
console.log('\n[3] 对局记录逐回合与累计战绩，刷新后可恢复');
{
  const storage = new MemoryStorage();
  let records: RoundRecord[] = [];
  records = appendRoundRecord(records, roundRecord(1, score(90, 90, 90), score(60, 60, 60)));
  records = appendRoundRecord(records, roundRecord(2, score(50, 50, 50), score(80, 80, 80)));
  records = appendRoundRecord(records, roundRecord(3, score(70, 70, 70), score(70, 70, 70)));
  saveRoundRecords(records, storage);
  check('对局记录已写入本地缓存', storage.getItem(ROUNDS_STORAGE_KEY) !== null);

  const history = buildMatchHistory(loadRoundRecords(storage));
  check('三条回合记录全部恢复', history.rounds.length === 3, `got ${history.rounds.length}`);
  check('逐回合胜负正确（胜/负/平）', history.rounds.map(r => r.winner).join(',') === 'user,ai,draw');
  check('累计战绩 1胜1负1平', history.totals.wins === 1 && history.totals.losses === 1 && history.totals.draws === 1);
  check('三项得分与总分可回看', history.rounds[0].userScore.color === 90 && history.rounds[0].aiScore.total === 60);
}

/* ---------------- 场景四：重复提交完全相同的回合记录（幂等） ---------------- */
console.log('\n[4] 重复提交同一回合相同结果：幂等忽略');
{
  const storage = new MemoryStorage();
  let records: RoundRecord[] = [];
  const r1 = roundRecord(2, score(75, 75, 75), score(65, 65, 65));
  const r1Copy: RoundRecord = { ...r1, id: nextId(), updatedAt: r1.updatedAt + 100 };
  records = appendRoundRecord(records, r1);
  records = appendRoundRecord(records, r1Copy);
  saveRoundRecords(records, storage);

  const restored = loadRoundRecords(storage);
  check('相同分数重复写入不产生重复记录', restored.length === 1, `got ${restored.length}`);
  const history = buildMatchHistory(restored);
  check('恢复后不标记冲突', history.conflicts.length === 0);
}

/* ---------------- 场景五：乱序到达 ---------------- */
console.log('\n[5] 回合记录乱序到达：读取时按回合号排序');
{
  const storage = new MemoryStorage();
  let records: RoundRecord[] = [];
  records = appendRoundRecord(records, roundRecord(3, score(90, 90, 90), score(50, 50, 50)));
  records = appendRoundRecord(records, roundRecord(1, score(80, 80, 80), score(60, 60, 60)));
  records = appendRoundRecord(records, roundRecord(2, score(70, 70, 70), score(60, 60, 60)));
  saveRoundRecords(records, storage);

  const rounds = buildMatchHistory(loadRoundRecords(storage)).rounds.map(r => r.round);
  check('乱序写入后按回合升序展示', rounds.join(',') === '1,2,3', `got ${rounds.join(',')}`);
}

/* ---------------- 场景六：冲突检测与用户裁决 ---------------- */
console.log('\n[6] 同一回合冲突记录：双方保留并标记，裁决只影响该回合');
{
  const storage = new MemoryStorage();
  let records: RoundRecord[] = [];
  records = appendRoundRecord(records, roundRecord(1, score(90, 90, 90), score(60, 60, 60)));
  // 第 2 回合两条互相冲突的记录（例如离线期间重复提交且分数不同）
  records = appendRoundRecord(records, roundRecord(2, score(50, 50, 50), score(80, 80, 80)));
  records = appendRoundRecord(records, roundRecord(2, score(85, 85, 85), score(40, 40, 40)));
  records = appendRoundRecord(records, roundRecord(3, score(70, 70, 70), score(60, 60, 60)));
  saveRoundRecords(records, storage);

  // 模拟刷新恢复
  let restored = loadRoundRecords(storage);
  const before = buildMatchHistory(restored);
  check('冲突回合双方记录都被保留', before.conflicts.length === 1 && before.conflicts[0].candidates.length === 2);
  check('冲突已被标记出来', before.conflicts[0].round === 2);
  check('未裁决前该回合不计入战绩', before.rounds.map(r => r.round).join(',') === '1,3');

  // 用户裁决：保留“用户胜”的那条
  const keep = before.conflicts[0].candidates.find(c => c.userScore.total > c.aiScore.total)!;
  check('候选记录均可裁决', Boolean(keep));
  restored = resolveRoundConflict(restored, 2, keep.id);
  saveRoundRecords(restored, storage);

  // 再次刷新恢复，确认裁决结果已持久化
  const after = buildMatchHistory(loadRoundRecords(storage));
  check('裁决后冲突消失', after.conflicts.length === 0);
  check('第2回合采用用户选择的记录', after.rounds.find(r => r.round === 2)?.userScore.total === 85);
  check('第2回合胜负按裁决结果计算', after.rounds.find(r => r.round === 2)?.winner === 'user');
  check('其他回合记录保持不变', after.rounds.length === 3);
  check('裁决后累计战绩更新为 3胜0负0平', after.totals.wins === 3 && after.totals.losses === 0 && after.totals.draws === 0);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
