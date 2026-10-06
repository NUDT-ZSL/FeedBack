/**
 * 回放会话：在不可变 Dataset 之上维护可演进的工作副本，
 * 支持矛盾裁决与事件关联修正/撤回后的“局部重推”。
 *
 * 局部重推原则：
 *  - 矛盾裁决只重推受影响对象在受影响时刻的时间线条目，
 *    以及可达该对象的事件影响范围；其余对象/事件保持原对象引用不变；
 *  - 事件关联修正/撤回只重推该事件的影响范围，时间线不动；
 *  - 每次局部重推后可用 verifyAgainstFullRecompute() 与整体重推对拍。
 */

import { ANOMALY_CATEGORY, ANOMALY_CODE } from './types.js';
import {
  compareStrings,
  deepClone,
  deepEqual,
  mergeIntervals,
  stableStringify,
} from './canonical.js';
import {
  deriveFullReport,
  traceEventRecords,
} from './engine.js';

function sortAnomalies(anomalies) {
  return anomalies.slice().sort(
    (a, b) =>
      compareStrings(a.category, b.category) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.ownerType, b.ownerType) ||
      compareStrings(a.ownerId, b.ownerId) ||
      compareStrings(stableStringify(a.details ?? null), stableStringify(b.details ?? null)),
  );
}

export class ReplaySession {
  constructor(dataset) {
    this._baseDataset = dataset;
    this._working = {
      records: new Map(dataset.records),
      events: new Map(dataset.events),
      anomalies: dataset.anomalies.map((a) => deepClone(a)),
      validLinks: new Map([...dataset.validLinks].map(([k, v]) => [k, v.slice()])),
    };
    this._adjudications = new Map();
    this._report = deriveFullReport(this._working, this._adjudications);
    this._dirtyLog = [];
  }

  get report() {
    return this._report;
  }

  get workingDataset() {
    return this._working;
  }

  /** 与整体重推对拍：局部重推结果必须等于从零全量推导。 */
  verifyAgainstFullRecompute() {
    const fresh = deriveFullReport(this._working, this._adjudications);
    return deepEqual(this._report, fresh);
  }

  /** 当前未裁决矛盾清单（裁决前双方均保留在 conflictRecords 中）。 */
  pendingConflicts() {
    return deepClone(this._report.conflicts);
  }

  /**
   * 矛盾裁决：指定 objectId@timestamp 的胜方记录。
   * 只重推该对象该时刻条目 + 可达该对象的事件影响范围。
   * 返回受影响对象与时间区间（供“只重推该部分”的核对）。
   */
  adjudicateConflict(objectId, timestamp, winnerRecordId) {
    const key = `${objectId}@${timestamp}`;
    const entry = (this._report.timeline[objectId] ?? []).find((e) => e.timestamp === timestamp);
    if (!entry) throw new Error(`no timeline entry for ${key}`);
    if (entry.status !== 'conflicting') throw new Error(`entry ${key} is not a pending conflict`);
    if (!entry.conflictRecords.some((c) => c.recordId === winnerRecordId)) {
      throw new Error(`winner "${winnerRecordId}" is not among conflicting records of ${key}`);
    }
    this._adjudications.set(key, winnerRecordId);

    // 受影响回放区间：从矛盾时刻到下一条“本就无矛盾”的记录前一时刻。
    const objectRecords = [...this._working.records.values()]
      .filter((r) => r.objectId === objectId)
      .sort((a, b) => a.timestamp - b.timestamp || compareStrings(a.id, b.id));
    const laterClean = objectRecords.find((r) => {
      if (r.timestamp <= timestamp) return false;
      const sameMoment = objectRecords.filter((x) => x.timestamp === r.timestamp);
      const sigs = new Set(sameMoment.map((x) => stableStringify(x.state)));
      return sigs.size === 1;
    });
    const affectedIntervals = laterClean
      ? [{ start: timestamp, end: laterClean.timestamp - 1 }]
      : [{ start: timestamp, end: null }];

    // 局部重推：仅重建该对象的时间线条目。
    const full = deriveFullReport(this._working, this._adjudications);
    this._report.timeline[objectId] = full.timeline[objectId];
    this._report.conflicts = full.conflicts;

    // 受影响事件：可达该对象的活跃事件，仅重推这些事件的影响范围。
    const affectedEventIds = [];
    for (const event of full.events) {
      if (event.affectedObjects.includes(objectId)) affectedEventIds.push(event.id);
    }
    this._report.events = this._report.events.map((e) =>
      affectedEventIds.includes(e.id) ? full.events.find((f) => f.id === e.id) : e,
    );

    const dirty = {
      kind: 'adjudication',
      key,
      winnerRecordId,
      affectedObjects: [objectId],
      affectedIntervals,
      affectedEventIds: affectedEventIds.sort(compareStrings),
    };
    this._dirtyLog.push(dirty);
    return deepClone(dirty);
  }

  /**
   * 修正事件关联：只重推该事件的影响范围；新关联重新校验，
   * 缺失/自引用归属到该事件的异常台账（不静默跳过）。
   */
  reviseEventLinks(eventId, newLinks) {
    const event = this._working.events.get(eventId);
    if (!event) throw new Error(`unknown event "${eventId}"`);
    const before = this._report.events.find((e) => e.id === eventId);

    const updated = { ...event, links: newLinks.map(String) };
    this._working.events.set(eventId, updated);

    const anomalies = this._working.anomalies.filter(
      (a) => !(a.ownerType === 'event' && a.ownerId === eventId),
    );
    const valid = [];
    for (const ref of updated.links) {
      if (!this._working.records.has(ref)) {
        anomalies.push({
          category: ANOMALY_CATEGORY.LINK_INTEGRITY,
          code: ANOMALY_CODE.MISSING_REFERENCE,
          ownerType: 'event',
          ownerId: eventId,
          message: `event "${eventId}" references missing record "${ref}"`,
          details: { reference: ref },
        });
        continue;
      }
      valid.push(ref);
    }
    this._working.anomalies = sortAnomalies(anomalies);
    this._working.validLinks.set(`event:${eventId}`, [...new Set(valid)].sort(compareStrings));

    const full = deriveFullReport(this._working, this._adjudications);
    this._report.anomalies = full.anomalies;
    this._report.events = this._report.events.map((e) =>
      e.id === eventId ? full.events.find((f) => f.id === eventId) : e,
    );
    const after = this._report.events.find((e) => e.id === eventId);

    const dirty = {
      kind: 'event-revise',
      eventId,
      affectedObjects: after.affectedObjects,
      affectedIntervals: after.intervals,
      previousScope: before,
      newScope: after,
    };
    this._dirtyLog.push(dirty);
    return deepClone(dirty);
  }

  /** 撤回事件：影响范围清空，事件保留在清单中（状态 withdrawn），其余不动。 */
  withdrawEvent(eventId) {
    const event = this._working.events.get(eventId);
    if (!event) throw new Error(`unknown event "${eventId}"`);
    const before = this._report.events.find((e) => e.id === eventId);
    this._working.events.set(eventId, { ...event, status: 'withdrawn' });

    const full = deriveFullReport(this._working, this._adjudications);
    this._report.events = this._report.events.map((e) =>
      e.id === eventId ? full.events.find((f) => f.id === eventId) : e,
    );
    const after = this._report.events.find((e) => e.id === eventId);

    const dirty = {
      kind: 'event-withdraw',
      eventId,
      affectedObjects: before.affectedObjects,
      affectedIntervals: before.intervals,
      previousScope: before,
      newScope: after,
    };
    this._dirtyLog.push(dirty);
    return deepClone(dirty);
  }

  /** 局部重推审计日志。 */
  dirtyLog() {
    return deepClone(this._dirtyLog);
  }
}

export { mergeIntervals };
