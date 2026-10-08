import { jsonApi } from '../harness';
import { registerUser, createTea } from '../fixtures';
import type { SuiteContext } from '../types';

const addNote = (baseUrl: string, userId: string, teaId: string, score: number, date: string) =>
  jsonApi(baseUrl, 'POST', `/api/teas/${teaId}/notes`, {
    userId,
    body: { date, water_temp: 88, tea_amount: 5, brew_time: 45, aroma: '栗香', score, description: `评分${score}` },
  });

const updateNote = (baseUrl: string, userId: string, noteId: string, score: number, date: string) =>
  jsonApi(baseUrl, 'PUT', `/api/notes/${noteId}`, {
    userId,
    body: { date, water_temp: 92, tea_amount: 6, brew_time: 50, aroma: '蜜香', score, description: `改后评分${score}` },
  });

const getDetail = (baseUrl: string, userId: string, teaId: string) =>
  jsonApi(baseUrl, 'GET', `/api/teas/${teaId}`, { userId });

const getListAvg = async (baseUrl: string, userId: string, teaId: string): Promise<number | null> => {
  const res = await jsonApi(baseUrl, 'GET', '/api/teas?page=1&limit=50', { userId });
  const row = (res.body.teas ?? []).find((t: any) => t.id === teaId);
  if (!row) throw new Error(`列表中找不到茶品 ${teaId}`);
  return row.avg_score === null || row.avg_score === undefined ? null : Number(row.avg_score);
};

const expectedAvg = (scores: number[]): number | null =>
  scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;

const avgMatches = (actual: number | null, expected: number | null): boolean => {
  if (expected === null) return actual === null;
  return actual !== null && Math.abs(actual - expected) < 1e-6;
};

export const runLinkageSuite = async ({ baseUrl, check }: SuiteContext): Promise<void> => {
  const userId = await registerUser(baseUrl, 'link_user', 'pass-123');
  const otherTeaId = await createTea(baseUrl, userId, {
    name: '对照茶-普洱',
    category: '黑茶',
    origin: '云南',
    year: 2018,
  });
  const teaId = await createTea(baseUrl, userId, {
    name: '联动验证-龙井',
    category: '绿茶',
    origin: '杭州',
    year: 2022,
  });

  let detail = await getDetail(baseUrl, userId, teaId);
  let listAvg = await getListAvg(baseUrl, userId, teaId);
  check(
    '初始：无笔记时详情笔记列表为空、列表平均分为null',
    detail.status === 200 &&
      Array.isArray(detail.body.tea.tasting_notes) &&
      detail.body.tea.tasting_notes.length === 0 &&
      listAvg === null,
    `用户=link_user 茶品=${teaId} 详情笔记数=${detail.body.tea?.tasting_notes?.length} 列表平均分=${listAvg}`
  );

  let scores: number[] = [];
  const noteIds: string[] = [];

  const assertSync = async (stage: string, opIndex: number): Promise<boolean> => {
    detail = await getDetail(baseUrl, userId, teaId);
    listAvg = await getListAvg(baseUrl, userId, teaId);
    const detailScores = (detail.body.tea.tasting_notes ?? []).map((n: any) => n.score);
    const notesConsistent =
      detailScores.length === scores.length &&
      scores.every((s) => detailScores.includes(s));
    const expected = expectedAvg(scores);
    const detailAvg = expectedAvg(detailScores);
    const avgConsistent =
      avgMatches(detailAvg, expected) && avgMatches(listAvg, expected);
    check(
      `${stage}：详情笔记列表与本地预期一致（操作#${opIndex}）`,
      notesConsistent,
      `用户=link_user 茶品=${teaId} 预期评分集合=${JSON.stringify(scores)} 详情评分集合=${JSON.stringify(detailScores)}`
    );
    check(
      `${stage}：列表平均分/详情平均分与预期一致（操作#${opIndex}）`,
      avgConsistent,
      `用户=link_user 茶品=${teaId} 预期平均分=${expected} 列表平均分=${listAvg} 详情均分=${detailAvg}`
    );
    return notesConsistent && avgConsistent;
  };

  let op = 0;

  let res = await addNote(baseUrl, userId, teaId, 8, '2024-03-01');
  noteIds.push(res.body.note.id);
  scores.push(8);
  await assertSync('新增第1条笔记(8分)', ++op);

  res = await addNote(baseUrl, userId, teaId, 4, '2024-04-01');
  noteIds.push(res.body.note.id);
  scores.push(4);
  await assertSync('新增第2条笔记(4分)', ++op);

  const otherBefore = await getListAvg(baseUrl, userId, otherTeaId);
  res = await updateNote(baseUrl, userId, noteIds[0], 10, '2024-03-01');
  scores[0] = 10;
  await assertSync('修改第1条笔记 8分→10分', ++op);
  const otherAfter = await getListAvg(baseUrl, userId, otherTeaId);
  check(
    '笔记操作不影响其他无笔记茶品（平均分保持null）',
    res.body.success === true && otherBefore === null && otherAfter === null,
    `对照茶品=${otherTeaId} 操作前=${otherBefore} 操作后=${otherAfter}`
  );

  res = await jsonApi(baseUrl, 'DELETE', `/api/notes/${noteIds[1]}`, { userId });
  noteIds.splice(1, 1);
  scores.splice(1, 1);
  await assertSync('删除第2条笔记(4分)', ++op);

  res = await jsonApi(baseUrl, 'DELETE', `/api/notes/${noteIds[0]}`, { userId });
  noteIds.splice(0, 1);
  scores.splice(0, 1);
  await assertSync('删除最后一条笔记(10分)', ++op);

  // 连续快速操作：多轮新增/修改/删除，每步都校验，专门捕捉旧值残留
  for (let round = 1; round <= 4; round++) {
    const a = await addNote(baseUrl, userId, teaId, 2, `2024-05-${String(round).padStart(2, '0')}`);
    noteIds.push(a.body.note.id);
    scores.push(2);
    await assertSync(`快速轮次${round} 新增2分`, ++op);

    const b = await addNote(baseUrl, userId, teaId, 6, `2024-06-${String(round).padStart(2, '0')}`);
    noteIds.push(b.body.note.id);
    scores.push(6);
    await assertSync(`快速轮次${round} 新增6分`, ++op);

    await updateNote(baseUrl, userId, noteIds[noteIds.length - 1], 7, `2024-06-${String(round).padStart(2, '0')}`);
    scores[scores.length - 1] = 7;
    await assertSync(`快速轮次${round} 修改6分→7分`, ++op);

    await jsonApi(baseUrl, 'DELETE', `/api/notes/${noteIds[0]}`, { userId });
    noteIds.splice(0, 1);
    scores.splice(0, 1);
    await assertSync(`快速轮次${round} 删除最早一条笔记`, ++op);
  }

  const staleDetail = await getDetail(baseUrl, userId, teaId);
  const staleScores = (staleDetail.body.tea.tasting_notes ?? []).map((n: any) => n.score).sort();
  const expectedSorted = [...scores].sort((a, b) => a - b);
  check(
    '连续操作结束后无旧笔记残留',
    JSON.stringify(staleScores) === JSON.stringify(expectedSorted),
    `用户=link_user 茶品=${teaId} 预期评分=${JSON.stringify(expectedSorted)} 实际评分=${JSON.stringify(staleScores)}`
  );
};
