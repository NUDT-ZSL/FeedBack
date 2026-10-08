import { jsonApi } from './harness';
import type { TeaRow } from './types';

export const FILTER_FIXTURE: TeaRow[] = [
  { name: '龙井', category: '绿茶', origin: '杭州西湖', year: 2021, scores: [9, 8] },
  { name: '碧螺春', category: '绿茶', origin: '苏州洞庭', year: 2020, scores: [7] },
  { name: '正山小种', category: '红茶', origin: '福建武夷山', year: 2019, scores: [6, 8] },
  { name: '祁门红茶', category: '红茶', origin: '安徽祁门', year: 2022, scores: [] },
  { name: '铁观音', category: '乌龙茶', origin: '福建安溪', year: 2018, scores: [5] },
  { name: '白毫银针', category: '白茶', origin: '福建福鼎', year: 2023, scores: [10, 9] },
  { name: '普洱熟茶', category: '黑茶', origin: '云南普洱', year: 2015, scores: [4, 6, 5] },
  { name: '君山银针', category: '黄茶', origin: '湖南岳阳', year: 2020, scores: [] },
  { name: '大红袍', category: '乌龙茶', origin: '福建武夷山', year: 2021, scores: [8] },
  { name: '安吉白茶', category: '绿茶', origin: '浙江安吉', year: 2023, scores: [3] },
  { name: '六堡茶', category: '黑茶', origin: '广西梧州', year: 2016, scores: [] },
  { name: '凤凰单丛', category: '乌龙茶', origin: '广东潮州', year: 2022, scores: [9, 9, 10] },
];

export interface FilterQuery {
  category?: string;
  minYear?: number;
  maxYear?: number;
  origin?: string;
  minScore?: number;
  maxScore?: number;
}

export const avgScore = (scores: number[]): number | null =>
  scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;

export const expectedFilterNames = (query: FilterQuery): string[] =>
  FILTER_FIXTURE.filter((tea) => {
    if (query.category !== undefined && tea.category !== query.category) return false;
    if (query.minYear !== undefined && tea.year < query.minYear) return false;
    if (query.maxYear !== undefined && tea.year > query.maxYear) return false;
    if (query.origin !== undefined && !tea.origin.includes(query.origin)) return false;
    if (query.minScore !== undefined || query.maxScore !== undefined) {
      const avg = avgScore(tea.scores);
      if (avg === null) return false;
      if (query.minScore !== undefined && avg < query.minScore) return false;
      if (query.maxScore !== undefined && avg > query.maxScore) return false;
    }
    return true;
  }).map((tea) => tea.name);

export const registerUser = async (
  baseUrl: string,
  username: string,
  password: string
): Promise<string> => {
  const res = await jsonApi(baseUrl, 'POST', '/api/auth/register', {
    userId: null,
    body: { username, password },
  });
  if (res.status !== 200 || !res.body.success) {
    throw new Error(`种子用户 ${username} 注册失败: ${JSON.stringify(res.body)}`);
  }
  return res.body.user.id as string;
};

export const createTea = async (
  baseUrl: string,
  userId: string,
  tea: { name: string; category: string; origin: string; year: number }
): Promise<string> => {
  const form = new FormData();
  form.append('name', tea.name);
  form.append('category', tea.category);
  form.append('origin', tea.origin);
  form.append('year', String(tea.year));
  const response = await fetch(`${baseUrl}/api/teas`, {
    method: 'POST',
    headers: { 'x-user-id': userId },
    body: form,
  });
  const body = await response.json();
  if (!body.success) {
    throw new Error(`创建茶品 ${tea.name} 失败: ${JSON.stringify(body)}`);
  }
  return body.tea.id as string;
};

export const addNote = async (
  baseUrl: string,
  userId: string,
  teaId: string,
  score: number,
  date = '2024-01-01'
): Promise<string> => {
  const res = await jsonApi(baseUrl, 'POST', `/api/teas/${teaId}/notes`, {
    userId,
    body: { date, water_temp: 90, tea_amount: 5, brew_time: 60, aroma: '清香', score, description: `评分${score}` },
  });
  if (!res.body.success) {
    throw new Error(`为茶品 ${teaId} 添加笔记失败: ${JSON.stringify(res.body)}`);
  }
  return res.body.note.id as string;
};

export const seedFixtureTeas = async (
  baseUrl: string,
  userId: string,
  rows: TeaRow[] = FILTER_FIXTURE
): Promise<Map<string, string>> => {
  const nameToId = new Map<string, string>();
  for (const row of rows) {
    const teaId = await createTea(baseUrl, userId, row);
    nameToId.set(row.name, teaId);
    for (const score of row.scores) {
      await addNote(baseUrl, userId, teaId, score);
    }
  }
  return nameToId;
};
