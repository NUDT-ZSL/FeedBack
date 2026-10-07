import type { DailyStats, InspectionLog, SaltCertificate } from '../../src/types';
import {
  assert,
  assertDeepEqual,
  assertEqual,
  FIXED_TODAY,
  type Check,
  type Client,
} from '../framework';

async function snapshot(client: Client): Promise<unknown> {
  const [certs, logs, stats] = await Promise.all([
    client.get('/api/salt-certificates'),
    client.get('/api/inspection-logs'),
    client.get('/api/daily-stats'),
  ]);
  return { certs: certs.body, logs: logs.body, stats: stats.body };
}

async function firstPending(client: Client): Promise<SaltCertificate> {
  const { body } = await client.get<SaltCertificate[]>('/api/salt-certificates');
  const pending = body.find((cert) => cert.status === 'pending');
  assert(pending, '前置数据应包含待核验盐引');
  return pending;
}

async function statFor(client: Client, date: string): Promise<DailyStats> {
  const { body } = await client.get<DailyStats[]>('/api/daily-stats');
  const entry = body.find((d) => d.date === date);
  return entry ?? { date, issued: 0, verified: 0, rejected: 0 };
}

export const saltChecks: Check[] = [
  {
    id: 'SALT-01',
    name: '盐引核发后状态、留痕与当日统计同步',
    run: async ({ server }) => {
      const before = await statFor(server.client, FIXED_TODAY);
      const created = await server.client.post<SaltCertificate>('/api/salt-certificates', {
        saltAmount: 2500,
        region: '淮南东路',
        seal: '转运司印',
        secretMark: '青龙',
      });
      assertEqual(created.status, 201, '核发应返回201');
      assertEqual(created.body.status, 'pending', '新盐引应为待核验');
      assertEqual(created.body.issueDate, FIXED_TODAY, '核发日期应取自受控时钟');

      const after = await statFor(server.client, FIXED_TODAY);
      assertEqual(after.issued, before.issued + 1, '当日核发统计应+1');

      const { body: logs } = await server.client.get<InspectionLog[]>('/api/inspection-logs');
      const log = logs.find((l) => l.certificateId === created.body.id && l.action === 'issue');
      assert(log, `核发留痕缺失: ${created.body.id}`);
      assertEqual(log.result, '已核发', '核发留痕结论');
    },
  },
  {
    id: 'SALT-02',
    name: '核验通过后状态、核验人、日期、留痕与统计自洽',
    run: async ({ server }) => {
      const cert = await firstPending(server.client);
      const before = await statFor(server.client, FIXED_TODAY);

      const inspected = await server.client.put<SaltCertificate>(
        `/api/salt-certificates/${cert.id}/inspect`,
        { result: 'verified', inspector: '测试核验官' },
      );
      assertEqual(inspected.status, 200, '核验应成功');
      assertEqual(inspected.body.status, 'verified', '状态应为已通过');
      assertEqual(inspected.body.inspector, '测试核验官', '核验人应落库');
      assertEqual(inspected.body.inspectionDate, FIXED_TODAY, '核验日期应取自受控时钟');

      const { body: logs } = await server.client.get<InspectionLog[]>('/api/inspection-logs');
      const log = logs.find((l) => l.certificateId === cert.id && l.action === 'verify');
      assert(log, '核验留痕缺失');
      assertEqual(log.operator, '测试核验官', '留痕操作人应与核验人一致');
      assertEqual(log.result, '核验通过', '留痕结论');
      assertEqual(log.timestamp.slice(0, 10), FIXED_TODAY, '留痕日期应与核验日期一致');

      const after = await statFor(server.client, FIXED_TODAY);
      assertEqual(after.verified, before.verified + 1, '当日核验通过统计应+1');
    },
  },
  {
    id: 'SALT-03',
    name: '核验驳回后状态、留痕与统计自洽',
    run: async ({ server }) => {
      const cert = await firstPending(server.client);
      const before = await statFor(server.client, FIXED_TODAY);

      const inspected = await server.client.put<SaltCertificate>(
        `/api/salt-certificates/${cert.id}/inspect`,
        { result: 'rejected', inspector: '测试核验官' },
      );
      assertEqual(inspected.status, 200, '驳回应成功');
      assertEqual(inspected.body.status, 'rejected', '状态应为已驳回');

      const { body: logs } = await server.client.get<InspectionLog[]>('/api/inspection-logs');
      const log = logs.find((l) => l.certificateId === cert.id && l.action === 'reject');
      assert(log, '驳回留痕缺失');
      assertEqual(log.result, '已驳回', '留痕结论');

      const after = await statFor(server.client, FIXED_TODAY);
      assertEqual(after.rejected, before.rejected + 1, '当日驳回统计应+1');
    },
  },
  {
    id: 'SALT-04',
    name: '混合操作后当日统计可由底层记录完整重算',
    run: async ({ server }) => {
      const certs = (await server.client.get<SaltCertificate[]>('/api/salt-certificates')).body;
      const pending = certs.filter((c) => c.status === 'pending').slice(0, 4);
      assert(pending.length >= 4, '前置待核验盐引不足');
      await server.client.post('/api/salt-certificates', {
        saltAmount: 1000, region: '两浙路', seal: '盐铁使印', secretMark: '白虎',
      });
      await server.client.put(`/api/salt-certificates/${pending[0].id}/inspect`, { result: 'verified', inspector: '甲' });
      await server.client.put(`/api/salt-certificates/${pending[1].id}/inspect`, { result: 'verified', inspector: '乙' });
      await server.client.put(`/api/salt-certificates/${pending[2].id}/inspect`, { result: 'rejected', inspector: '丙' });
      await server.client.put(`/api/salt-certificates/${pending[3].id}`, { status: 'verified', inspector: '丁' });

      const [allCerts, logs, stats] = await Promise.all([
        server.client.get<SaltCertificate[]>('/api/salt-certificates'),
        server.client.get<InspectionLog[]>('/api/inspection-logs'),
        server.client.get<DailyStats[]>('/api/daily-stats'),
      ]);

      const derived = new Map<string, DailyStats>();
      const ensure = (date: string): DailyStats => {
        let entry = derived.get(date);
        if (!entry) {
          entry = { date, issued: 0, verified: 0, rejected: 0 };
          derived.set(date, entry);
        }
        return entry;
      };
      for (const cert of allCerts.body) {
        ensure(cert.issueDate).issued++;
      }
      for (const log of logs.body) {
        if (log.certificateType !== 'salt') continue;
        const date = log.timestamp.slice(0, 10);
        if (log.action === 'verify') ensure(date).verified++;
        if (log.action === 'reject') ensure(date).rejected++;
      }
      const expected = [...derived.values()].sort((a, b) => a.date.localeCompare(b.date));
      assertDeepEqual(
        [...stats.body].sort((a, b) => a.date.localeCompare(b.date)),
        expected,
        '当日统计与底层记录(盐引+留痕)重算结果不一致',
      );
    },
  },
];

export const saltErrorChecks: Check[] = [
  {
    id: 'ERR-01',
    name: '核验不存在的盐引返回明确404且状态不变',
    run: async ({ server }) => {
      const before = await snapshot(server.client);
      const res = await server.client.put<{ error: string; code: string }>(
        '/api/salt-certificates/盐引0000000000/inspect',
        { result: 'verified', inspector: '测试核验官' },
      );
      assertEqual(res.status, 404, '不存在的盐引应返回404');
      assertEqual(res.body.code, 'SALT_CERT_NOT_FOUND', '错误码');
      assertDeepEqual(await snapshot(server.client), before, '失败后系统状态不应发生变化');
    },
  },
  {
    id: 'ERR-02',
    name: '已通过盐引重复核验返回409且状态不被改写',
    run: async ({ server }) => {
      const cert = await firstPending(server.client);
      await server.client.put(`/api/salt-certificates/${cert.id}/inspect`, { result: 'verified', inspector: '首任核验官' });
      const before = await snapshot(server.client);

      const res = await server.client.put<{ error: string; code: string }>(
        `/api/salt-certificates/${cert.id}/inspect`,
        { result: 'rejected', inspector: '继任核验官' },
      );
      assertEqual(res.status, 409, '终态盐引重复核验应返回409');
      assertEqual(res.body.code, 'SALT_CERT_ALREADY_FINAL', '错误码');
      assertDeepEqual(await snapshot(server.client), before, '重复核验不应改写状态、留痕或统计');
    },
  },
  {
    id: 'ERR-03',
    name: '已驳回盐引重复核验返回409且状态不被改写',
    run: async ({ server }) => {
      const cert = await firstPending(server.client);
      await server.client.put(`/api/salt-certificates/${cert.id}/inspect`, { result: 'rejected', inspector: '首任核验官' });
      const before = await snapshot(server.client);

      const res = await server.client.put<{ error: string; code: string }>(
        `/api/salt-certificates/${cert.id}`,
        { status: 'verified', inspector: '继任核验官' },
      );
      assertEqual(res.status, 409, '终态盐引经旧接口重复核验应返回409');
      assertEqual(res.body.code, 'SALT_CERT_ALREADY_FINAL', '错误码');
      assertDeepEqual(await snapshot(server.client), before, '重复核验不应改写状态、留痕或统计');
    },
  },
  {
    id: 'ERR-04',
    name: '非法核验结果返回400且状态不变',
    run: async ({ server }) => {
      const cert = await firstPending(server.client);
      const before = await snapshot(server.client);
      const res = await server.client.put<{ error: string; code: string }>(
        `/api/salt-certificates/${cert.id}/inspect`,
        { result: 'pending', inspector: '测试核验官' },
      );
      assertEqual(res.status, 400, '非法核验结果应返回400');
      assertEqual(res.body.code, 'INVALID_INSPECTION_RESULT', '错误码');
      assertDeepEqual(await snapshot(server.client), before, '失败后系统状态不应发生变化');
    },
  },
];
