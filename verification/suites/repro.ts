import type {
  MonthlyReport,
  SaltCertificate,
} from '../../src/types';
import {
  assertDeepEqual,
  FIXED_MONTH,
  type Check,
  type Client,
  type ServerHandle,
} from '../framework';
import { startServer } from '../framework';

async function fullSnapshot(client: Client): Promise<unknown> {
  const [salt, iron, logs, changes, stats] = await Promise.all([
    client.get('/api/salt-certificates'),
    client.get('/api/iron-certificates'),
    client.get('/api/inspection-logs'),
    client.get('/api/iron-cert-changes'),
    client.get('/api/daily-stats'),
  ]);
  return {
    salt: salt.body,
    iron: iron.body,
    logs: logs.body,
    changes: changes.body,
    stats: stats.body,
  };
}

async function runScript(server: ServerHandle): Promise<void> {
  const createdA = await server.client.post<SaltCertificate>('/api/salt-certificates', {
    saltAmount: 3200, region: '淮南东路', seal: '转运司印', secretMark: '青龙',
  });
  await server.client.post('/api/salt-certificates', {
    saltAmount: 1800, region: '福建路', seal: '提举盐事司印', secretMark: '玄武',
  });
  const { body: certs } = await server.client.get<SaltCertificate[]>('/api/salt-certificates');
  const pending = certs.filter((c) => c.id !== createdA.body.id && c.status === 'pending');
  await server.client.put(`/api/salt-certificates/${createdA.body.id}/inspect`, { result: 'verified', inspector: '钱核验' });
  await server.client.put(`/api/salt-certificates/${pending[0].id}/inspect`, { result: 'rejected', inspector: '孙核验' });

  const { body: irons } = await server.client.get<Array<{ id: string }>>('/api/iron-certificates');
  await server.client.put(`/api/iron-certificates/${irons[0].id}`, { status: 'revoked' });
  await server.client.put(`/api/iron-certificates/${irons[1].id}`, {
    status: 'active', expiryDate: '2028-12-31',
  });
}

export const reproChecks: Check[] = [
  {
    id: 'REPRO-01',
    name: '同种子同时钟冷启动得到完全一致的初始数据',
    run: async () => {
      const a = await startServer({ seed: 20261007 });
      const b = await startServer({ seed: 20261007 });
      try {
        assertDeepEqual(await fullSnapshot(b.client), await fullSnapshot(a.client),
          '两个隔离实例的初始快照不一致');
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    },
  },
  {
    id: 'REPRO-02',
    name: '相同操作序列在同种子实例上得到相同终态',
    run: async () => {
      const a = await startServer({ seed: 4242 });
      const b = await startServer({ seed: 4242 });
      try {
        await runScript(a);
        await runScript(b);
        assertDeepEqual(await fullSnapshot(b.client), await fullSnapshot(a.client),
          '相同输入重复执行终态不一致');
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    },
  },
  {
    id: 'REPRO-03',
    name: '月度汇总重复生成结论一致(不含随机异常)',
    run: async ({ server }) => {
      await runScript(server);
      const first = await server.client.get<MonthlyReport>(`/api/report?month=${FIXED_MONTH}`);
      const second = await server.client.get<MonthlyReport>(`/api/report?month=${FIXED_MONTH}`);
      assertDeepEqual(second.body, first.body, '同一数据两次生成月报结果不一致');
    },
  },
];
