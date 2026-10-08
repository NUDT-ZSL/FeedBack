import { jsonApi } from '../harness';
import { registerUser, createTea, addNote } from '../fixtures';
import type { SuiteContext } from '../types';

const UNAUTHENTICATED_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'GET', path: '/api/teas' },
  { method: 'GET', path: '/api/teas/some-tea-id' },
  { method: 'PUT', path: '/api/teas/some-tea-id' },
  { method: 'DELETE', path: '/api/teas/some-tea-id' },
  { method: 'POST', path: '/api/teas/some-tea-id/notes', body: { date: '2024-01-01', water_temp: 90, tea_amount: 5, brew_time: 60, score: 8 } },
  { method: 'PUT', path: '/api/notes/some-note-id', body: { date: '2024-01-01', water_temp: 90, tea_amount: 5, brew_time: 60, score: 8 } },
  { method: 'DELETE', path: '/api/notes/some-note-id' },
  { method: 'GET', path: '/api/export' },
];

export const runAuthSuite = async ({ baseUrl, check }: SuiteContext): Promise<void> => {
  const username = 'auth_alice';
  const password = 'secret-123';

  const register = await jsonApi(baseUrl, 'POST', '/api/auth/register', {
    userId: null,
    body: { username, password },
  });
  check(
    '注册新用户成功',
    register.status === 200 && register.body.success === true && typeof register.body.user?.id === 'string',
    `用户=${username} 状态码=${register.status} 响应=${JSON.stringify(register.body)}`
  );
  const aliceId = register.body.user?.id as string;

  const duplicate = await jsonApi(baseUrl, 'POST', '/api/auth/register', {
    userId: null,
    body: { username, password: 'other-pass' },
  });
  check(
    '重复用户名注册返回400与固定错误语义',
    duplicate.status === 400 && duplicate.body.success === false && duplicate.body.error === '用户名已存在',
    `用户=${username} 状态码=${duplicate.status} 响应=${JSON.stringify(duplicate.body)}`
  );

  const missingPassword = await jsonApi(baseUrl, 'POST', '/api/auth/register', {
    userId: null,
    body: { username: 'auth_no_pass' },
  });
  check(
    '注册缺少密码返回400',
    missingPassword.status === 400 && missingPassword.body.success === false,
    `状态码=${missingPassword.status} 响应=${JSON.stringify(missingPassword.body)}`
  );

  const wrongPassword = await jsonApi(baseUrl, 'POST', '/api/auth/login', {
    userId: null,
    body: { username, password: 'wrong-pass' },
  });
  check(
    '错误密码登录返回401与固定错误语义',
    wrongPassword.status === 401 && wrongPassword.body.success === false && wrongPassword.body.error === '用户名或密码错误',
    `用户=${username} 状态码=${wrongPassword.status} 响应=${JSON.stringify(wrongPassword.body)}`
  );

  const unknownUser = await jsonApi(baseUrl, 'POST', '/api/auth/login', {
    userId: null,
    body: { username: 'auth_ghost', password: 'whatever' },
  });
  check(
    '不存在用户登录返回401且错误语义与错误密码一致',
    unknownUser.status === 401 && unknownUser.body.success === false && unknownUser.body.error === '用户名或密码错误',
    `用户=auth_ghost 状态码=${unknownUser.status} 响应=${JSON.stringify(unknownUser.body)}`
  );

  const login = await jsonApi(baseUrl, 'POST', '/api/auth/login', {
    userId: null,
    body: { username, password },
  });
  check(
    '正确密码登录成功且返回同一用户标识',
    login.status === 200 && login.body.success === true && login.body.user?.id === aliceId,
    `用户=${username} 状态码=${login.status} 响应=${JSON.stringify(login.body)}`
  );

  for (const route of UNAUTHENTICATED_ROUTES) {
    const res = await jsonApi(baseUrl, route.method, route.path, { userId: null, body: route.body });
    check(
      `缺失用户标识访问 ${route.method} ${route.path} 返回401`,
      res.status === 401 && res.body.success === false && res.body.error === '未授权',
      `状态码=${res.status} 响应=${JSON.stringify(res.body)}`
    );
  }

  const bobId = await registerUser(baseUrl, 'auth_bob', 'bob-pass');
  const aliceTeaId = await createTea(baseUrl, aliceId, {
    name: '爱丽丝的龙井',
    category: '绿茶',
    origin: '杭州',
    year: 2021,
  });
  const aliceNoteId = await addNote(baseUrl, aliceId, aliceTeaId, 9);

  const crossRead = await jsonApi(baseUrl, 'GET', `/api/teas/${aliceTeaId}`, { userId: bobId });
  check(
    '用户B读取用户A的茶品详情返回404',
    crossRead.status === 404 && crossRead.body.success === false,
    `访问者=auth_bob 目标茶品=${aliceTeaId}(属auth_alice) 状态码=${crossRead.status}`
  );

  const crossUpdate = await jsonApi(baseUrl, 'PUT', `/api/teas/${aliceTeaId}`, { userId: bobId });
  check(
    '用户B修改用户A的茶品返回404',
    crossUpdate.status === 404 && crossUpdate.body.success === false,
    `访问者=auth_bob 目标茶品=${aliceTeaId} 状态码=${crossUpdate.status}`
  );

  const crossDelete = await jsonApi(baseUrl, 'DELETE', `/api/teas/${aliceTeaId}`, { userId: bobId });
  check(
    '用户B删除用户A的茶品返回404',
    crossDelete.status === 404 && crossDelete.body.success === false,
    `访问者=auth_bob 目标茶品=${aliceTeaId} 状态码=${crossDelete.status}`
  );

  const crossAddNote = await jsonApi(baseUrl, 'POST', `/api/teas/${aliceTeaId}/notes`, {
    userId: bobId,
    body: { date: '2024-02-01', water_temp: 90, tea_amount: 5, brew_time: 60, score: 1 },
  });
  check(
    '用户B为用户A的茶品添加笔记返回404',
    crossAddNote.status === 404 && crossAddNote.body.success === false,
    `访问者=auth_bob 目标茶品=${aliceTeaId} 状态码=${crossAddNote.status}`
  );

  const crossUpdateNote = await jsonApi(baseUrl, 'PUT', `/api/notes/${aliceNoteId}`, {
    userId: bobId,
    body: { date: '2024-02-01', water_temp: 90, tea_amount: 5, brew_time: 60, score: 1 },
  });
  check(
    '用户B修改用户A的笔记返回404',
    crossUpdateNote.status === 404 && crossUpdateNote.body.success === false,
    `访问者=auth_bob 目标笔记=${aliceNoteId} 状态码=${crossUpdateNote.status}`
  );

  const crossDeleteNote = await jsonApi(baseUrl, 'DELETE', `/api/notes/${aliceNoteId}`, { userId: bobId });
  check(
    '用户B删除用户A的笔记返回404',
    crossDeleteNote.status === 404 && crossDeleteNote.body.success === false,
    `访问者=auth_bob 目标笔记=${aliceNoteId} 状态码=${crossDeleteNote.status}`
  );

  const bobList = await jsonApi(baseUrl, 'GET', '/api/teas?page=1&limit=50', { userId: bobId });
  const bobTeaIds = (bobList.body.teas ?? []).map((t: any) => t.id);
  check(
    '用户B的茶品列表不包含用户A的茶品',
    bobList.status === 200 && !bobTeaIds.includes(aliceTeaId),
    `访问者=auth_bob 列表茶品数=${bobTeaIds.length} 目标茶品=${aliceTeaId}`
  );

  const bobExport = await jsonApi(baseUrl, 'GET', '/api/export', { userId: bobId });
  const bobExportIds = (bobExport.body.teas ?? []).map((t: any) => t.id);
  check(
    '用户B的导出不包含用户A的茶品',
    bobExport.status === 200 && !bobExportIds.includes(aliceTeaId),
    `访问者=auth_bob 导出茶品数=${bobExportIds.length} 目标茶品=${aliceTeaId}`
  );

  const aliceDetail = await jsonApi(baseUrl, 'GET', `/api/teas/${aliceTeaId}`, { userId: aliceId });
  const noteIntact = (aliceDetail.body.tea?.tasting_notes ?? []).some((n: any) => n.id === aliceNoteId && n.score === 9);
  check(
    '跨用户攻击尝试后用户A的茶品与笔记保持原样',
    aliceDetail.status === 200 && aliceDetail.body.tea?.name === '爱丽丝的龙井' && noteIntact,
    `拥有者=auth_alice 茶品=${aliceTeaId} 笔记=${aliceNoteId} 详情=${JSON.stringify(aliceDetail.body.tea ?? {})}`
  );
};
