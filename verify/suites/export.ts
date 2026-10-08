import { jsonApi } from '../harness';
import { registerUser, createTea, addNote } from '../fixtures';
import type { SuiteContext } from '../types';

export const runExportSuite = async ({ baseUrl, check }: SuiteContext): Promise<void> => {
  const aliceId = await registerUser(baseUrl, 'export_alice', 'alice-pass');
  const bobId = await registerUser(baseUrl, 'export_bob', 'bob-pass');

  const aliceTeaA = await createTea(baseUrl, aliceId, { name: '白牡丹', category: '白茶', origin: '福建福鼎', year: 2020 });
  await addNote(baseUrl, aliceId, aliceTeaA, 8, '2024-01-10');
  await addNote(baseUrl, aliceId, aliceTeaA, 6, '2024-02-10');

  const aliceTeaB = await createTea(baseUrl, aliceId, { name: '肉桂', category: '乌龙茶', origin: '福建武夷山', year: 2021 });
  await addNote(baseUrl, aliceId, aliceTeaB, 9, '2024-03-10');

  const aliceTeaC = await createTea(baseUrl, aliceId, { name: '未品饮茯砖', category: '黑茶', origin: '湖南益阳', year: 2019 });

  const bobTeaA = await createTea(baseUrl, bobId, { name: '正山小种', category: '红茶', origin: '福建武夷山', year: 2018 });
  await addNote(baseUrl, bobId, bobTeaA, 7, '2024-01-05');
  const bobTeaB = await createTea(baseUrl, bobId, { name: '寿眉', category: '白茶', origin: '福建政和', year: 2022 });
  await addNote(baseUrl, bobId, bobTeaB, 5, '2024-04-05');

  const noAuth = await jsonApi(baseUrl, 'GET', '/api/export', { userId: null });
  check(
    '导出接口缺失用户标识返回401',
    noAuth.status === 401 && noAuth.body.success === false && noAuth.body.error === '未授权',
    `状态码=${noAuth.status} 响应=${JSON.stringify(noAuth.body)}`
  );

  const aliceExport = await jsonApi(baseUrl, 'GET', '/api/export', { userId: aliceId });
  const aliceTeas: Array<any> = aliceExport.body.teas ?? [];
  const aliceIds = aliceTeas.map((t) => t.id);
  const aliceNames = aliceTeas.map((t) => t.name);

  check(
    '用户A导出包含其全部3条茶品',
    aliceExport.status === 200 && aliceTeas.length === 3 &&
      [aliceTeaA, aliceTeaB, aliceTeaC].every((id) => aliceIds.includes(id)),
    `用户=export_alice 导出茶品数=${aliceTeas.length} 导出标识=${JSON.stringify(aliceIds)}`
  );

  const noNoteTea = aliceTeas.find((t) => t.id === aliceTeaC);
  check(
    '无笔记茶品不会因缺少笔记而在导出中丢失，笔记字段为空数组',
    noNoteTea !== undefined && Array.isArray(noNoteTea.tasting_notes) && noNoteTea.tasting_notes.length === 0,
    `用户=export_alice 茶品=未品饮茯砖(${aliceTeaC}) 导出内容=${JSON.stringify(noNoteTea)}`
  );

  const teaANotes = aliceTeas.find((t) => t.id === aliceTeaA)?.tasting_notes ?? [];
  const teaBNotes = aliceTeas.find((t) => t.id === aliceTeaB)?.tasting_notes ?? [];
  check(
    '用户A导出中笔记完整且挂接到正确茶品',
    teaANotes.length === 2 && teaBNotes.length === 1 &&
      teaANotes.every((n: any) => n.tea_id === aliceTeaA) &&
      teaBNotes.every((n: any) => n.tea_id === aliceTeaB),
    `用户=export_alice 白牡丹笔记数=${teaANotes.length} 肉桂笔记数=${teaBNotes.length}`
  );

  const leakedBobTea = aliceIds.some((id) => id === bobTeaA || id === bobTeaB) ||
    aliceNames.includes('寿眉') || aliceNames.includes('正山小种');
  const allNoteTeaIds = aliceTeas.flatMap((t) => (t.tasting_notes ?? []).map((n: any) => n.tea_id));
  const leakedBobNote = allNoteTeaIds.some((id) => id === bobTeaA || id === bobTeaB);
  check(
    '用户A导出不混入用户B的茶品或笔记',
    !leakedBobTea && !leakedBobNote,
    `用户=export_alice 混入B茶品=${leakedBobTea} 混入B笔记=${leakedBobNote} 全部笔记归属=${JSON.stringify(allNoteTeaIds)}`
  );

  const bobExport = await jsonApi(baseUrl, 'GET', '/api/export', { userId: bobId });
  const bobTeas: Array<any> = bobExport.body.teas ?? [];
  const bobExportIds = bobTeas.map((t) => t.id);
  const bobNoteCount = bobTeas.reduce((sum, t) => sum + (t.tasting_notes?.length ?? 0), 0);
  check(
    '用户B导出仅包含其本人2条茶品及笔记',
    bobExport.status === 200 &&
      bobTeas.length === 2 &&
      bobExportIds.every((id) => id === bobTeaA || id === bobTeaB) &&
      !bobExportIds.some((id) => id === aliceTeaA || id === aliceTeaB || id === aliceTeaC) &&
      bobNoteCount === 2,
    `用户=export_bob 茶品数=${bobTeas.length} 笔记数=${bobNoteCount} 标识=${JSON.stringify(bobExportIds)}`
  );

  check(
    '导出结构含 export_date 字段',
    typeof aliceExport.body.export_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(aliceExport.body.export_date),
    `export_date=${aliceExport.body.export_date}`
  );
};
