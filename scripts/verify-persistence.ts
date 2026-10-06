/**
 * Offline verification for the doucha persistence engine.
 * Runs every scenario against an in-memory storage (no network, no browser):
 *   npm run verify
 */
import {
  STORAGE_KEY,
  computeMatchStats,
  createMemoryStorage,
  cumulativeStats,
  emptyPersistedState,
  loadPersistedState,
  nextRoundFromRecords,
  resolveGalleryConflict,
  resolveRecordConflict,
  savePersistedState,
  upsertGalleryItem,
  upsertMatchRecord,
} from '../src/lib/persistence';
import { SAMPLE_PATTERNS, createSampleState, makeScore, svgThumb } from '../src/lib/sampleData';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${name} ${detail}`);
  }
}

function scenario(title: string): void {
  console.log(`\n■ ${title}`);
}

const [pine, butterflies, landscape] = SAMPLE_PATTERNS;
const thumbA = svgThumb('甲', '#c49a3c', '#5c3a1e');
const thumbB = svgThumb('乙', '#d4a76a', '#3a2010');

// 1. 保存与恢复（模拟服务重启 / 重新打开页面）
scenario('图鉴与对局记录的保存与恢复');
{
  const storage = createMemoryStorage();
  let state = emptyPersistedState();
  state = upsertGalleryItem(state, {
    round: 1,
    patternKey: pine.type,
    item: { pattern: pine, thumbnail: thumbA, roundScore: makeScore(80, 70, 90) },
    updatedAt: 1000,
  });
  state = upsertMatchRecord(state, {
    round: 1,
    userScore: makeScore(80, 70, 90),
    aiScore: makeScore(60, 65, 70),
    recordedAt: 1000,
  });
  savePersistedState(storage, state);

  const restored = loadPersistedState(storage); // 模拟重启后重新加载
  check('图鉴恢复 1 条', restored.gallery.length === 1);
  check('图鉴内容一致', restored.gallery[0].pattern.name === '松鹤延年' && restored.gallery[0].roundScore.total === 80);
  check('对局记录恢复 1 条', restored.records.length === 1);
  check('胜负推导正确', restored.records[0].winner === 'user');
  check('下一回合为第 2 回合', nextRoundFromRecords(restored.records) === 2);
}

// 2. 同回合同图案重复提交：只保留一条，以最新为准
scenario('同回合同图案去重（最新覆盖）');
{
  let state = emptyPersistedState();
  const base = { round: 2, patternKey: pine.type };
  state = upsertGalleryItem(state, { ...base, item: { pattern: pine, thumbnail: thumbA, roundScore: makeScore(60, 60, 60) }, updatedAt: 1000 });
  state = upsertGalleryItem(state, { ...base, item: { pattern: pine, thumbnail: thumbB, roundScore: makeScore(90, 90, 90) }, updatedAt: 2000 });
  state = upsertGalleryItem(state, { ...base, item: { pattern: pine, thumbnail: thumbB, roundScore: makeScore(90, 90, 90) }, updatedAt: 3000 });
  check('重复提交后仅 1 条', state.gallery.length === 1, `实际 ${state.gallery.length}`);
  check('保留最新缩略图', state.gallery[0].thumbnail === thumbB);
  check('保留最新分数', state.gallery[0].roundScore.total === 90);
  check('无冲突标记', state.gallery[0].conflictKey === null);
}

// 3. 完全相同的内容重复提交：幂等
scenario('相同内容重复提交幂等');
{
  let state = emptyPersistedState();
  const input = {
    round: 1,
    patternKey: butterflies.type,
    item: { pattern: butterflies, thumbnail: thumbA, roundScore: makeScore(70, 70, 70) },
    updatedAt: 1000,
  };
  state = upsertGalleryItem(state, input);
  const afterFirst = state;
  state = upsertGalleryItem(state, { ...input, updatedAt: 2000 });
  check('条目数不变', state.gallery.length === 1);
  check('id 不变（未追加新条目）', state.gallery[0].id === afterFirst.gallery[0].id);

  let s2 = emptyPersistedState();
  const rec = { round: 1, userScore: makeScore(70, 70, 70), aiScore: makeScore(60, 60, 60), recordedAt: 1000 };
  s2 = upsertMatchRecord(s2, rec);
  const firstId = s2.records[0].id;
  s2 = upsertMatchRecord(s2, { ...rec, recordedAt: 5000 });
  check('对局记录幂等：仍 1 条', s2.records.length === 1);
  check('对局记录幂等：id 不变', s2.records[0].id === firstId);
}

// 4. 乱序到达：旧提交被忽略，不同回合乱序均正确归位
scenario('乱序到达容忍');
{
  let state = emptyPersistedState();
  state = upsertGalleryItem(state, { round: 3, patternKey: pine.type, item: { pattern: pine, thumbnail: thumbB, roundScore: makeScore(90, 90, 90) }, updatedAt: 5000 });
  state = upsertGalleryItem(state, { round: 3, patternKey: pine.type, item: { pattern: pine, thumbnail: thumbA, roundScore: makeScore(10, 10, 10) }, updatedAt: 1000 });
  check('旧提交被忽略，仍是最新内容', state.gallery.length === 1 && state.gallery[0].roundScore.total === 90);

  let s2 = emptyPersistedState();
  s2 = upsertMatchRecord(s2, { round: 3, userScore: makeScore(90, 90, 90), aiScore: makeScore(50, 50, 50), recordedAt: 3000 });
  s2 = upsertMatchRecord(s2, { round: 1, userScore: makeScore(60, 60, 60), aiScore: makeScore(70, 70, 70), recordedAt: 1000 });
  s2 = upsertMatchRecord(s2, { round: 2, userScore: makeScore(80, 80, 80), aiScore: makeScore(80, 80, 80), recordedAt: 2000 });
  check('乱序写入 3 个回合全部保留', s2.records.length === 3);
  check('按回合排序', s2.records.map((r) => r.round).join(',') === '1,2,3');
  check('乱序后下一回合正确', nextRoundFromRecords(s2.records) === 4);

  s2 = upsertMatchRecord(s2, { round: 2, userScore: makeScore(1, 1, 1), aiScore: makeScore(2, 2, 2), recordedAt: 1500 });
  check('同回合旧时间戳提交被忽略', s2.records.find((r) => r.round === 2)?.userScore.total === 80);
}

// 5. 冲突恢复：本地样例缓存含第 3 回合冲突，恢复后双方保留并标记
scenario('冲突记录的恢复与标记（本地样例缓存）');
{
  const storage = createMemoryStorage();
  savePersistedState(storage, createSampleState());
  const restored = loadPersistedState(storage);

  const conflictGallery = restored.gallery.filter((g) => g.conflictKey !== null);
  check('图鉴冲突双方均保留', conflictGallery.length === 2, `实际 ${conflictGallery.length}`);
  check('图鉴冲突标记同一 conflictKey', new Set(conflictGallery.map((g) => g.conflictKey)).size === 1);

  const conflictRecords = restored.records.filter((r) => r.conflictKey !== null);
  check('对局冲突双方均保留', conflictRecords.length === 2, `实际 ${conflictRecords.length}`);
  check('冲突记录同属第 3 回合', conflictRecords.every((r) => r.round === 3));
  check('无冲突记录不受影响', restored.records.filter((r) => r.conflictKey === null).length === 3);

  const stats = computeMatchStats(restored.records);
  check('累计战绩不计入未裁决冲突', stats.total === 3 && stats.wins === 2 && stats.losses === 1);
}

// 6. 裁决：只更新受影响的那条，其余历史不变
scenario('冲突裁决（仅影响目标记录）');
{
  const storage = createMemoryStorage();
  savePersistedState(storage, createSampleState());
  const restored = loadPersistedState(storage);

  const galleryKey = restored.gallery.find((g) => g.conflictKey)?.conflictKey as string;
  const galleryGroup = restored.gallery.filter((g) => g.conflictKey === galleryKey);
  const keepGallery = galleryGroup[1];
  const afterGallery = resolveGalleryConflict(restored, galleryKey, keepGallery.id);
  check('图鉴裁决后该 key 仅剩 1 条', afterGallery.gallery.filter((g) => g.conflictKey !== null).length === 0);
  check('图鉴裁决保留指定版本', afterGallery.gallery.some((g) => g.id === keepGallery.id));
  check('图鉴其余条目不变', afterGallery.gallery.length === restored.gallery.length - 1);

  const recordKey = restored.records.find((r) => r.conflictKey)?.conflictKey as string;
  const recordGroup = restored.records.filter((r) => r.conflictKey === recordKey);
  const keepRecord = recordGroup[1];
  const untouchedBefore = restored.records.filter((r) => r.conflictKey === null).map((r) => r.id);
  const afterRecord = resolveRecordConflict(restored, recordKey, keepRecord.id);
  check('对局裁决后冲突消除', afterRecord.records.every((r) => r.conflictKey === null));
  check('对局裁决保留指定方案', afterRecord.records.find((r) => r.round === 3)?.id === keepRecord.id);
  check(
    '其余历史记录保持不变',
    untouchedBefore.every((id) => afterRecord.records.some((r) => r.id === id)) &&
      afterRecord.records.length === restored.records.length - 1,
  );
  const stats = computeMatchStats(afterRecord.records);
  check('裁决后累计战绩更新', stats.total === 4 && stats.wins === 3 && stats.losses === 1);

  const winner = keepRecord.userScore.total > keepRecord.aiScore.total ? 'user' : 'ai';
  check('裁决结果胜负归属正确', keepRecord.winner === winner);

  savePersistedState(storage, afterRecord);
  const reloaded = loadPersistedState(storage);
  check('裁决结果可持久化恢复', reloaded.records.every((r) => r.conflictKey === null) && reloaded.records.length === afterRecord.records.length);
}

// 7. 逐回合胜负走势与累计战绩
scenario('逐回合胜负与累计战绩');
{
  let state = emptyPersistedState();
  state = upsertMatchRecord(state, { round: 1, userScore: makeScore(90, 90, 90), aiScore: makeScore(60, 60, 60), recordedAt: 1000 });
  state = upsertMatchRecord(state, { round: 2, userScore: makeScore(50, 50, 50), aiScore: makeScore(60, 60, 60), recordedAt: 2000 });
  state = upsertMatchRecord(state, { round: 3, userScore: makeScore(70, 70, 70), aiScore: makeScore(70, 70, 70), recordedAt: 3000 });
  const cum = cumulativeStats(state.records);
  check('逐回合累计正确', cum.map((c) => `${c.wins}-${c.losses}-${c.draws}`).join('|') === '1-0-0|1-1-0|1-1-1');
  check('总分推导正确', state.records[2].winner === 'draw');
}

// 8. 图鉴上限与损坏缓存容错
scenario('边界与容错');
{
  let state = emptyPersistedState();
  for (let i = 1; i <= 25; i += 1) {
    state = upsertGalleryItem(state, {
      round: i,
      patternKey: landscape.type,
      item: { pattern: landscape, thumbnail: thumbA, roundScore: makeScore(50, 50, 50) },
      updatedAt: i * 1000,
    });
  }
  check('图鉴最多保留 20 幅', state.gallery.length === 20, `实际 ${state.gallery.length}`);
  check('保留最新的 20 幅', state.gallery.every((g) => g.round >= 6));

  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, '{broken json!!!');
  const recovered = loadPersistedState(storage);
  check('损坏缓存恢复为空状态', recovered.gallery.length === 0 && recovered.records.length === 0);

  const empty = loadPersistedState(createMemoryStorage());
  check('空缓存正常初始化', empty.gallery.length === 0 && nextRoundFromRecords(empty.records) === 1);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
console.log('全部离线场景验证通过 ✔');
