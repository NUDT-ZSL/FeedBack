import type {
  DailyStats,
  InspectionLog,
  IronCertChange,
  IronCertificate,
  MonthlyReport,
  SaltCertificate,
} from '../../src/types';
import {
  assert,
  assertDeepEqual,
  assertEqual,
  FIXED_MONTH,
  type Check,
  type Client,
} from '../framework';

interface BaseRecords {
  saltCerts: SaltCertificate[];
  ironCerts: IronCertificate[];
  logs: InspectionLog[];
  changes: IronCertChange[];
  stats: DailyStats[];
}

async function fetchBaseRecords(client: Client): Promise<BaseRecords> {
  const [saltCerts, ironCerts, logs, changes, stats] = await Promise.all([
    client.get<SaltCertificate[]>('/api/salt-certificates'),
    client.get<IronCertificate[]>('/api/iron-certificates'),
    client.get<InspectionLog[]>('/api/inspection-logs'),
    client.get<IronCertChange[]>('/api/iron-cert-changes'),
    client.get<DailyStats[]>('/api/daily-stats'),
  ]);
  return {
    saltCerts: saltCerts.body,
    ironCerts: ironCerts.body,
    logs: logs.body,
    changes: changes.body,
    stats: stats.body,
  };
}

function previousMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNum - 2, 1)).toISOString().slice(0, 7);
}

function deriveStats(records: BaseRecords): DailyStats[] {
  const byDate = new Map<string, DailyStats>();
  const ensure = (date: string): DailyStats => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = { date, issued: 0, verified: 0, rejected: 0 };
      byDate.set(date, entry);
    }
    return entry;
  };
  for (const cert of records.saltCerts) {
    ensure(cert.issueDate).issued++;
  }
  for (const log of records.logs) {
    if (log.certificateType !== 'salt') continue;
    const date = log.timestamp.slice(0, 10);
    if (log.action === 'verify') ensure(date).verified++;
    if (log.action === 'reject') ensure(date).rejected++;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function doMixedOps(client: Client): Promise<void> {
  await client.post('/api/salt-certificates', { saltAmount: 1000, region: '两浙路', seal: '盐铁使印', secretMark: '白虎' });
  await client.post('/api/salt-certificates', { saltAmount: 2000, region: '河北路', seal: '榷货务印', secretMark: '朱雀' });
  const { body: certs } = await client.get<SaltCertificate[]>('/api/salt-certificates');
  const pending = certs.filter((c) => c.status === 'pending');
  assert(pending.length >= 4, '前置待核验盐引不足');
  await client.put(`/api/salt-certificates/${pending[0].id}/inspect`, { result: 'verified', inspector: '甲' });
  await client.put(`/api/salt-certificates/${pending[1].id}/inspect`, { result: 'verified', inspector: '乙' });
  await client.put(`/api/salt-certificates/${pending[2].id}/inspect`, { result: 'verified', inspector: '丙' });
  await client.put(`/api/salt-certificates/${pending[3].id}/inspect`, { result: 'rejected', inspector: '丁' });
}

export const reportChecks: Check[] = [
  {
    id: 'REPORT-01',
    name: '月度汇总核发、核验、驳回总量与底层记录一致',
    run: async ({ server }) => {
      await doMixedOps(server.client);
      const records = await fetchBaseRecords(server.client);
      const { body: report } = await server.client.get<MonthlyReport>(`/api/report?month=${FIXED_MONTH}`);

      const monthStats = deriveStats(records).filter((d) => d.date.startsWith(FIXED_MONTH));
      const issued = monthStats.reduce((sum, d) => sum + d.issued, 0);
      const verified = monthStats.reduce((sum, d) => sum + d.verified, 0);
      const rejected = monthStats.reduce((sum, d) => sum + d.rejected, 0);

      assertEqual(report.totalIssued, issued, '月度核发总量与底层记录不符');
      assertEqual(report.totalVerified, verified, '月度核验总量与底层记录不符');
      assertEqual(report.totalRejected, rejected, '月度驳回总量与底层记录不符');
      assertDeepEqual(
        report.dailyStats,
        records.stats.filter((d) => d.date.startsWith(FIXED_MONTH)),
        '月度汇总逐日明细与当日统计不符',
      );
    },
  },
  {
    id: 'REPORT-02',
    name: '月度匹配率口径与核验、驳回总量一致',
    run: async ({ server }) => {
      await doMixedOps(server.client);
      const { body: report } = await server.client.get<MonthlyReport>(`/api/report?month=${FIXED_MONTH}`);
      const decided = report.totalVerified + report.totalRejected;
      const expected = decided > 0 ? Math.round((report.totalVerified / decided) * 100) : 0;
      assertEqual(report.matchRate, expected, '匹配率应等于 核验通过/(核验通过+驳回) 的百分比取整');
    },
  },
  {
    id: 'REPORT-03',
    name: '汇总异常项均可追溯到底层记录',
    run: async ({ server }) => {
      await doMixedOps(server.client);
      const records = await fetchBaseRecords(server.client);
      const { body: report } = await server.client.get<MonthlyReport>(`/api/report?month=${FIXED_MONTH}`);

      const certIds = new Set([
        ...records.saltCerts.map((c) => c.id),
        ...records.ironCerts.map((c) => c.id),
      ]);
      const statDates = new Set(records.stats.map((d) => d.date));
      const prevMonth = previousMonth(FIXED_MONTH);

      for (const anomaly of report.anomalies) {
        assert(anomaly.evidence.length > 0, `异常项 ${anomaly.type} 缺少可追溯证据`);
        for (const item of anomaly.evidence) {
          const traceable =
            certIds.has(item) ||
            statDates.has(item) ||
            item === FIXED_MONTH ||
            item === prevMonth;
          assert(traceable, `异常项 ${anomaly.type} 的证据 ${item} 无法追溯到底层记录`);
        }
      }
    },
  },
  {
    id: 'REPORT-04',
    name: '异常项集合与底层记录独立推导结果完全一致',
    run: async ({ server }) => {
      await doMixedOps(server.client);
      const records = await fetchBaseRecords(server.client);
      const { body: report } = await server.client.get<MonthlyReport>(`/api/report?month=${FIXED_MONTH}`);

      const derived = deriveStats(records);
      const monthStats = derived.filter((d) => d.date.startsWith(FIXED_MONTH));
      const totalIssued = monthStats.reduce((sum, d) => sum + d.issued, 0);
      const totalVerified = monthStats.reduce((sum, d) => sum + d.verified, 0);
      const totalRejected = monthStats.reduce((sum, d) => sum + d.rejected, 0);

      const expected: { type: string; evidence: string[] }[] = [];

      const dateAnomalies = records.saltCerts
        .filter((c) => c.inspectionDate && c.inspectionDate < c.issueDate)
        .map((c) => c.id)
        .sort();
      if (dateAnomalies.length > 0) {
        expected.push({ type: '日期异常', evidence: dateAnomalies });
      }

      const decided = totalVerified + totalRejected;
      if (decided > 0 && totalRejected / decided > 0.2) {
        expected.push({
          type: '驳回率过高',
          evidence: monthStats.filter((d) => d.rejected > 0).map((d) => d.date),
        });
      }

      const prevMonth = previousMonth(FIXED_MONTH);
      const prevIssued = derived
        .filter((d) => d.date.startsWith(prevMonth))
        .reduce((sum, d) => sum + d.issued, 0);
      if (Math.abs(totalIssued - prevIssued) / Math.max(prevIssued, 1) > 0.3) {
        expected.push({ type: '核发数量异常', evidence: [FIXED_MONTH, prevMonth] });
      }

      const changeCount = new Map<string, number>();
      for (const change of records.changes) {
        if (change.operationTime.slice(0, 7) === FIXED_MONTH) {
          changeCount.set(change.certificateId, (changeCount.get(change.certificateId) ?? 0) + 1);
        }
      }
      const frequent = [...changeCount.entries()].filter(([, n]) => n > 3).map(([id]) => id).sort();
      if (frequent.length > 0) {
        expected.push({ type: '铁券变更频繁', evidence: frequent });
      }

      const mismatchDates: string[] = [];
      const allDates = new Set([...derived.map((d) => d.date), ...records.stats.map((d) => d.date)]);
      for (const date of [...allDates].sort()) {
        const expectedStat = derived.find((d) => d.date === date);
        const actualStat = records.stats.find((d) => d.date === date);
        if (
          (expectedStat?.issued ?? 0) !== (actualStat?.issued ?? 0) ||
          (expectedStat?.verified ?? 0) !== (actualStat?.verified ?? 0) ||
          (expectedStat?.rejected ?? 0) !== (actualStat?.rejected ?? 0)
        ) {
          mismatchDates.push(date);
        }
      }
      if (mismatchDates.length > 0) {
        expected.push({ type: '数量不符', evidence: mismatchDates });
      }

      const normalize = (list: { type: string; evidence: string[] }[]) =>
        list
          .map((a) => ({ type: a.type, evidence: [...a.evidence].sort() }))
          .sort((a, b) => a.type.localeCompare(b.type));
      assertDeepEqual(
        normalize(report.anomalies),
        normalize(expected),
        '异常项集合与底层记录独立推导结果不一致(存在虚报或漏报)',
      );
    },
  },
  {
    id: 'REPORT-05',
    name: '非法月份参数返回明确400错误语义',
    run: async ({ server }) => {
      const missing = await server.client.get<{ code: string }>('/api/report');
      assertEqual(missing.status, 400, '缺少月份应返回400');
      assertEqual(missing.body.code, 'INVALID_MONTH', '错误码');

      const malformed = await server.client.get<{ code: string }>('/api/report?month=2026-13');
      assertEqual(malformed.status, 400, '非法月份应返回400');
      assertEqual(malformed.body.code, 'INVALID_MONTH', '错误码');
    },
  },
];
