import { jsonApi } from '../harness';
import { registerUser, seedFixtureTeas, expectedFilterNames, avgScore, FILTER_FIXTURE } from '../fixtures';
import type { SuiteContext } from '../types';
import type { FilterQuery } from '../fixtures';

type FilterQueryType = FilterQuery;

const fetchPages = async (
  baseUrl: string,
  userId: string,
  query: FilterQueryType,
  limit: number
): Promise<{ allNames: string[]; pageResponses: Array<{ names: string[]; total: number; status: number }> }> => {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const pageResponses: Array<{ names: string[]; total: number; status: number }> = [];
  const allNames: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const suffix = qs ? `&${qs}` : '';
    const res = await jsonApi(baseUrl, 'GET', `/api/teas?page=${page}&limit=${limit}${suffix}`, { userId });
    if (res.status !== 200) {
      pageResponses.push({ names: [], total: -1, status: res.status });
      break;
    }
    const names = (res.body.teas ?? []).map((t: any) => t.name as string);
    pageResponses.push({ names, total: res.body.total as number, status: res.status });
    allNames.push(...names);
    if (allNames.length >= res.body.total || names.length === 0) break;
  }
  return { allNames, pageResponses };
};

const assertScenario = async (
  baseUrl: string,
  userId: string,
  check: SuiteContext['check'],
  label: string,
  query: FilterQueryType,
  limit: number
): Promise<void> => {
  const expected = expectedFilterNames(query).sort();
  const { allNames, pageResponses } = await fetchPages(baseUrl, userId, query, limit);

  const allStatusOk = pageResponses.every((p) => p.status === 200);
  check(`${label}：接口全部返回200`, allStatusOk, `条件=${JSON.stringify(query)} 分页状态=${JSON.stringify(pageResponses.map((p) => p.status))}`);

  const totalConsistent = pageResponses.length > 0 && pageResponses.every((p) => p.total === expected.length);
  check(
    `${label}：total 与逐条核对的命中数一致`,
    totalConsistent,
    `条件=${JSON.stringify(query)} 接口total集合=${JSON.stringify(pageResponses.map((p) => p.total))} 逐条核对命中数=${expected.length}`
  );

  const noMissing = expected.every((name) => allNames.includes(name));
  check(
    `${label}：翻页并集包含全部命中茶品（无漏算）`,
    noMissing,
    `条件=${JSON.stringify(query)} 缺少=${JSON.stringify(expected.filter((n) => !allNames.includes(n)))}`
  );

  const noExtra = allNames.every((name) => expected.includes(name));
  check(
    `${label}：翻页并集不包含未命中茶品（无多算）`,
    noExtra,
    `条件=${JSON.stringify(query)} 多出=${JSON.stringify(allNames.filter((n) => !expected.includes(n)))}`
  );

  const noDuplicates = new Set(allNames).size === allNames.length;
  check(
    `${label}：翻页并集无重复茶品`,
    noDuplicates,
    `条件=${JSON.stringify(query)} 并集=${JSON.stringify(allNames)}`
  );

  const fullPages = pageResponses.slice(0, -1);
  const pageSizeStable = fullPages.every((p) => p.names.length === limit);
  check(
    `${label}：除最后一页外每页恰好 ${limit} 条`,
    pageSizeStable,
    `条件=${JSON.stringify(query)} 各页条数=${JSON.stringify(pageResponses.map((p) => p.names.length))}`
  );
};

export const runFiltersSuite = async ({ baseUrl, check }: SuiteContext): Promise<void> => {
  const userId = await registerUser(baseUrl, 'filter_user', 'pass-123');
  const nameToId = await seedFixtureTeas(baseUrl, userId);

  await assertScenario(baseUrl, userId, check, '无筛选全量分页', {}, 5);
  await assertScenario(baseUrl, userId, check, '按茶类筛选(绿茶)', { category: '绿茶' }, 2);
  await assertScenario(baseUrl, userId, check, '按年份区间筛选(2020-2022)', { minYear: 2020, maxYear: 2022 }, 3);
  await assertScenario(baseUrl, userId, check, '年份边界(仅2021)', { minYear: 2021, maxYear: 2021 }, 5);
  await assertScenario(baseUrl, userId, check, '按产地关键词筛选(福建)', { origin: '福建' }, 2);
  await assertScenario(baseUrl, userId, check, '评分区间筛选(7-9)', { minScore: 7, maxScore: 9 }, 2);
  await assertScenario(baseUrl, userId, check, '仅下限评分筛选(>=8)', { minScore: 8 }, 2);
  await assertScenario(baseUrl, userId, check, '仅上限评分筛选(<=6)', { maxScore: 6 }, 2);
  await assertScenario(baseUrl, userId, check, '茶类+评分组合筛选(乌龙茶且>=8)', { category: '乌龙茶', minScore: 8 }, 5);
  await assertScenario(baseUrl, userId, check, '年份+产地组合筛选', { minYear: 2020, maxYear: 2023, origin: '福建' }, 2);
  await assertScenario(baseUrl, userId, check, '筛选无命中(黄茶且>=5)', { category: '黄茶', minScore: 5 }, 5);

  const noNoteTeas = FILTER_FIXTURE.filter((t) => t.scores.length === 0).map((t) => t.name);
  const { allNames } = await fetchPages(baseUrl, userId, { minScore: 1 }, 50);
  const leaked = noNoteTeas.filter((n) => allNames.includes(n));
  check(
    '评分筛选时无笔记茶品不进入命中集合',
    leaked.length === 0,
    `无笔记茶品=${JSON.stringify(noNoteTeas)} 被错误命中=${JSON.stringify(leaked)}`
  );

  const { allNames: noBoundNames } = await fetchPages(baseUrl, userId, {}, 50);
  const missing = noNoteTeas.filter((n) => !noBoundNames.includes(n));
  check(
    '不带评分筛选时无笔记茶品仍出现在列表中',
    missing.length === 0,
    `无笔记茶品=${JSON.stringify(noNoteTeas)} 缺失=${JSON.stringify(missing)}`
  );

  const detailAvgChecks = FILTER_FIXTURE.map((tea) => {
    const teaId = nameToId.get(tea.name)!;
    return jsonApi(baseUrl, 'GET', `/api/teas/${teaId}`, { userId }).then((res) => {
      const notes = (res.body.tea?.tasting_notes ?? []) as Array<{ score: number }>;
      const actualScores = notes.map((n) => n.score).sort((a, b) => a - b);
      const expectedScores = [...tea.scores].sort((a, b) => a - b);
      const scoresMatch = JSON.stringify(actualScores) === JSON.stringify(expectedScores);
      const res2 = jsonApi(baseUrl, 'GET', '/api/teas?page=1&limit=50', { userId });
      return res2.then((list) => {
        const row = (list.body.teas ?? []).find((t: any) => t.id === teaId);
        const listAvg = row?.avg_score === null || row?.avg_score === undefined ? null : Number(row.avg_score);
        const expected = avgScore(tea.scores);
        const avgMatch =
          expected === null ? listAvg === null : listAvg !== null && Math.abs(listAvg - expected) < 1e-6;
        check(
          `固定样例[${tea.name}]详情笔记评分与列表平均分正确`,
          scoresMatch && avgMatch,
          `茶品=${tea.name}(${teaId}) 预期评分=${JSON.stringify(expectedScores)} 实际=${JSON.stringify(actualScores)} 预期均分=${expected} 列表均分=${listAvg}`
        );
      });
    });
  });
  await Promise.all(detailAvgChecks);
};
