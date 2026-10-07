import type {
  DailyStats,
  InspectionLog,
  IronCertificate,
  IronCertificateStatus,
  MonthlyReport,
  ReportAnomaly,
  SaltCertificate,
  SaltCertificateStatus,
} from '../src/types';
import type { Deps } from './deps';
import { badRequest, conflict, notFound } from './errors';
import {
  AppState,
  formatDate,
  generateIronId,
  generateSaltId,
  inspectorNames,
  randomItem,
} from './state';

export type SortDirection = 'asc' | 'desc';

export function listSaltCertificates(
  state: AppState,
  options: { search?: string; sort?: SortDirection } = {},
): SaltCertificate[] {
  let result = [...state.saltCertificates];
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    result = result.filter((cert) => cert.id.toLowerCase().includes(searchLower));
  }
  if (options.sort === 'asc' || options.sort === 'desc') {
    const direction = options.sort;
    result.sort((a, b) => {
      const diff = new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime();
      if (diff !== 0) {
        return direction === 'asc' ? diff : -diff;
      }
      return a.id.localeCompare(b.id);
    });
  }
  return result;
}

export interface SaltCertificateInput {
  saltAmount: number;
  region: string;
  seal: string;
  secretMark: string;
}

function bumpDailyStat(state: AppState, date: string, field: 'issued' | 'verified' | 'rejected'): void {
  const entry = state.dailyStats.find((d) => d.date === date);
  if (entry) {
    entry[field]++;
  } else {
    state.dailyStats.push({
      date,
      issued: field === 'issued' ? 1 : 0,
      verified: field === 'verified' ? 1 : 0,
      rejected: field === 'rejected' ? 1 : 0,
    });
    state.dailyStats.sort((a, b) => a.date.localeCompare(b.date));
  }
}

function appendInspectionLog(
  state: AppState,
  log: Omit<InspectionLog, 'id' | 'timestamp'>,
  deps: Deps,
): InspectionLog {
  const entry: InspectionLog = {
    ...log,
    id: `log-${state.inspectionLogs.length + 1}`,
    timestamp: deps.clock.now().toISOString(),
  };
  state.inspectionLogs.unshift(entry);
  return entry;
}

export function createSaltCertificate(
  state: AppState,
  deps: Deps,
  input: SaltCertificateInput,
): SaltCertificate {
  const cert: SaltCertificate = {
    id: generateSaltId(deps, state.saltCertificates),
    saltAmount: input.saltAmount,
    issueDate: formatDate(deps.clock.now()),
    region: input.region,
    seal: input.seal,
    secretMark: input.secretMark,
    status: 'pending',
  };
  state.saltCertificates.unshift(cert);

  appendInspectionLog(state, {
    certificateId: cert.id,
    certificateType: 'salt',
    action: 'issue',
    operator: randomItem(deps.rng, inspectorNames),
    result: '已核发',
  }, deps);

  bumpDailyStat(state, cert.issueDate, 'issued');
  return cert;
}

export function inspectSaltCertificate(
  state: AppState,
  deps: Deps,
  id: string,
  result: SaltCertificateStatus,
  inspector?: string,
): SaltCertificate {
  if (result !== 'verified' && result !== 'rejected') {
    throw badRequest('INVALID_INSPECTION_RESULT', `无效的核验结果: ${String(result)}`);
  }
  const cert = state.saltCertificates.find((c) => c.id === id);
  if (!cert) {
    throw notFound('SALT_CERT_NOT_FOUND', `盐引不存在: ${id}`);
  }
  if (cert.status !== 'pending') {
    throw conflict(
      'SALT_CERT_ALREADY_FINAL',
      `盐引 ${id} 已处于终态(${cert.status})，不可重复核验`,
    );
  }

  const operator = inspector || randomItem(deps.rng, inspectorNames);
  cert.status = result;
  cert.inspector = operator;
  cert.inspectionDate = formatDate(deps.clock.now());

  appendInspectionLog(state, {
    certificateId: cert.id,
    certificateType: 'salt',
    action: result === 'verified' ? 'verify' : 'reject',
    operator,
    result: result === 'verified' ? '核验通过' : '已驳回',
  }, deps);

  bumpDailyStat(state, cert.inspectionDate, result === 'verified' ? 'verified' : 'rejected');
  return cert;
}

export function listIronCertificates(
  state: AppState,
  options: { search?: string; sort?: SortDirection } = {},
): IronCertificate[] {
  let result = [...state.ironCertificates];
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    result = result.filter((cert) => cert.holderName.toLowerCase().includes(searchLower));
  }
  if (options.sort === 'asc' || options.sort === 'desc') {
    const direction = options.sort;
    result.sort((a, b) => {
      const diff = new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime();
      if (diff !== 0) {
        return direction === 'asc' ? diff : -diff;
      }
      return a.id.localeCompare(b.id);
    });
  }
  return result;
}

export interface IronCertificateInput {
  type: IronCertificate['type'];
  holderName: string;
  holderTitle: string;
  holderAvatar: string;
}

export function createIronCertificate(
  state: AppState,
  deps: Deps,
  input: IronCertificateInput,
): IronCertificate {
  const cert: IronCertificate = {
    id: generateIronId(deps, state.ironCertificates),
    type: input.type,
    holderName: input.holderName,
    holderTitle: input.holderTitle,
    holderAvatar: input.holderAvatar,
    issueDate: formatDate(deps.clock.now()),
    expiryDate: formatDate(new Date(deps.clock.now().getTime() + 365 * 24 * 3600 * 1000)),
    status: 'active',
  };
  state.ironCertificates.unshift(cert);

  state.ironCertChanges.unshift({
    id: `change-${state.ironCertChanges.length + 1}`,
    certificateId: cert.id,
    operationTime: deps.clock.now().toISOString(),
    operator: randomItem(deps.rng, inspectorNames),
    result: '已铸造',
    toStatus: 'active',
  });
  return cert;
}

const IRON_STATUSES: IronCertificateStatus[] = ['active', 'expired', 'revoked'];

export function changeIronCertificate(
  state: AppState,
  deps: Deps,
  id: string,
  targetStatus: IronCertificateStatus,
  expiryDate?: string,
): IronCertificate {
  if (!IRON_STATUSES.includes(targetStatus)) {
    throw badRequest('INVALID_IRON_STATUS', `无效的铁券状态: ${String(targetStatus)}`);
  }
  const cert = state.ironCertificates.find((c) => c.id === id);
  if (!cert) {
    throw notFound('IRON_CERT_NOT_FOUND', `铁券不存在: ${id}`);
  }
  const fromStatus = cert.status;
  if (fromStatus === 'revoked') {
    throw conflict('IRON_CERT_REVOKED', `铁券 ${id} 已吊销，不可再变更`);
  }

  const isRenewal = targetStatus === 'active';
  let renewedExpiryDate: string | undefined;
  if (isRenewal) {
    if (expiryDate === undefined) {
      throw badRequest('RENEWAL_REQUIRES_EXPIRY_DATE', '续期必须提供新的到期日 expiryDate');
    }
    if (expiryDate <= cert.expiryDate) {
      throw badRequest(
        'INVALID_RENEWAL_DATE',
        `续期日期 ${expiryDate} 必须晚于当前到期日 ${cert.expiryDate}`,
      );
    }
    renewedExpiryDate = expiryDate;
  } else if (targetStatus === fromStatus) {
    throw conflict('IRON_CERT_ALREADY_IN_STATE', `铁券 ${id} 已处于状态 ${targetStatus}`);
  } else if (fromStatus === 'expired') {
    throw conflict('IRON_CERT_INVALID_TRANSITION', `铁券 ${id} 已过期，仅可续期`);
  }

  cert.status = targetStatus;
  if (renewedExpiryDate !== undefined) {
    cert.expiryDate = renewedExpiryDate;
  }

  const resultText = isRenewal
    ? '已续期'
    : targetStatus === 'revoked'
      ? '已吊销'
      : targetStatus === 'expired'
        ? '已过期'
        : '状态已更新';
  const operator = randomItem(deps.rng, inspectorNames);
  const operationTime = deps.clock.now().toISOString();

  state.ironCertChanges.unshift({
    id: `change-${state.ironCertChanges.length + 1}`,
    certificateId: cert.id,
    operationTime,
    operator,
    result: resultText,
    fromStatus,
    toStatus: targetStatus,
  });

  appendInspectionLog(state, {
    certificateId: cert.id,
    certificateType: 'iron',
    action: 'update',
    operator,
    result: resultText,
  }, deps);

  return cert;
}

export function deriveDailyStats(state: AppState): DailyStats[] {
  const byDate = new Map<string, DailyStats>();
  const ensure = (date: string): DailyStats => {
    let entry = byDate.get(date);
    if (!entry) {
      entry = { date, issued: 0, verified: 0, rejected: 0 };
      byDate.set(date, entry);
    }
    return entry;
  };
  for (const cert of state.saltCertificates) {
    ensure(cert.issueDate).issued++;
  }
  for (const log of state.inspectionLogs) {
    if (log.certificateType !== 'salt') {
      continue;
    }
    const date = log.timestamp.slice(0, 10);
    if (log.action === 'verify') {
      ensure(date).verified++;
    } else if (log.action === 'reject') {
      ensure(date).rejected++;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function previousMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNum - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function computeMonthlyReport(state: AppState, month: string): MonthlyReport {
  const monthStats = state.dailyStats
    .filter((d) => d.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalIssued = monthStats.reduce((sum, d) => sum + d.issued, 0);
  const totalVerified = monthStats.reduce((sum, d) => sum + d.verified, 0);
  const totalRejected = monthStats.reduce((sum, d) => sum + d.rejected, 0);
  const matchRate = totalVerified + totalRejected > 0
    ? Math.round((totalVerified / (totalVerified + totalRejected)) * 100)
    : 0;

  const anomalies: ReportAnomaly[] = [];
  const pushAnomaly = (
    type: string,
    description: string,
    severity: ReportAnomaly['severity'],
    evidence: string[],
  ) => {
    anomalies.push({
      id: `anomaly-${anomalies.length + 1}`,
      type,
      description,
      severity,
      evidence,
    });
  };

  const dateAnomalies = state.saltCertificates
    .filter((cert) => cert.inspectionDate && cert.inspectionDate < cert.issueDate)
    .map((cert) => cert.id)
    .sort();
  if (dateAnomalies.length > 0) {
    pushAnomaly('日期异常', '发现核发日期晚于核验日期', 'high', dateAnomalies);
  }

  const decided = totalVerified + totalRejected;
  if (decided > 0 && totalRejected / decided > 0.2) {
    const evidence = monthStats.filter((d) => d.rejected > 0).map((d) => d.date);
    pushAnomaly('驳回率过高', '盐引驳回率超过20%', 'high', evidence);
  }

  const prevMonth = previousMonth(month);
  const prevIssued = state.dailyStats
    .filter((d) => d.date.startsWith(prevMonth))
    .reduce((sum, d) => sum + d.issued, 0);
  if (Math.abs(totalIssued - prevIssued) / Math.max(prevIssued, 1) > 0.3) {
    pushAnomaly('核发数量异常', '本月核发数量与上月相比波动超过30%', 'medium', [month, prevMonth]);
  }

  const changeCountByCert = new Map<string, number>();
  for (const change of state.ironCertChanges) {
    if (change.operationTime.slice(0, 7) === month) {
      changeCountByCert.set(change.certificateId, (changeCountByCert.get(change.certificateId) ?? 0) + 1);
    }
  }
  const frequentChanges = [...changeCountByCert.entries()]
    .filter(([, count]) => count > 3)
    .map(([certId]) => certId)
    .sort();
  if (frequentChanges.length > 0) {
    pushAnomaly('铁券变更频繁', '某铁券本月变更超过3次', 'low', frequentChanges);
  }

  const derived = deriveDailyStats(state);
  const mismatchDates: string[] = [];
  const allDates = new Set([...derived.map((d) => d.date), ...state.dailyStats.map((d) => d.date)]);
  for (const date of [...allDates].sort()) {
    const expected = derived.find((d) => d.date === date);
    const actual = state.dailyStats.find((d) => d.date === date);
    if (
      (expected?.issued ?? 0) !== (actual?.issued ?? 0) ||
      (expected?.verified ?? 0) !== (actual?.verified ?? 0) ||
      (expected?.rejected ?? 0) !== (actual?.rejected ?? 0)
    ) {
      mismatchDates.push(date);
    }
  }
  if (mismatchDates.length > 0) {
    pushAnomaly('数量不符', '核发总量与账册记录不一致', 'medium', mismatchDates);
  }

  return {
    month,
    totalIssued,
    totalVerified,
    totalRejected,
    matchRate,
    anomalies,
    dailyStats: monthStats,
  };
}
