/**
 * 导入段：支持任意批次、任意顺序分批喂入记录/事件。
 * 导入本身只做归并；批次喂完后 buildDataset 统一做全量校验，
 * 因此校验结论与“第几个批次到达”无关。
 *
 * 不丢弃任何输入：
 *  - 重复 ID 且内容一致  -> 去重
 *  - 重复 ID 但内容不一致 -> 登记 duplicate 异常，按规范内容最小者为保留版本
 *  - 链接缺失 / 自引用 / 成环 -> 登记 link-integrity 异常，坏边从有效边中剔除
 */

import { ANOMALY_CATEGORY, ANOMALY_CODE } from './types.js';
import {
  compareStrings,
  contentHash,
  deepClone,
  stableStringify,
} from './canonical.js';

/** 规整单条输入，补全缺省字段；不做跨条校验。 */
function normalizeRecord(input) {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string') {
    throw new Error('record must be an object with string id');
  }
  return {
    id: input.id,
    objectId: String(input.objectId),
    timestamp: Number(input.timestamp),
    state: input.state === undefined ? null : input.state,
    links: Array.isArray(input.links) ? input.links.map(String) : [],
    priority: input.priority === undefined ? 0 : Number(input.priority),
  };
}

function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string') {
    throw new Error('event must be an object with string id');
  }
  return {
    id: input.id,
    timestamp: Number(input.timestamp),
    kind: String(input.kind),
    links: Array.isArray(input.links) ? input.links.map(String) : [],
    status: input.status === 'withdrawn' ? 'withdrawn' : 'active',
  };
}

/** 累积式导入器：ingestBatch 可被调用任意次、任意顺序。 */
export class Importer {
  constructor() {
    this._rawRecords = new Map();
    this._rawEvents = new Map();
  }

  ingestBatch(batch = {}) {
    for (const raw of batch.records ?? []) {
      const record = normalizeRecord(raw);
      const existing = this._rawRecords.get(record.id);
      if (!existing) {
        this._rawRecords.set(record.id, record);
      } else if (stableStringify(existing) !== stableStringify(record)) {
        existing.__conflicts = existing.__conflicts || [];
        existing.__conflicts.push(record);
      }
    }
    for (const raw of batch.events ?? []) {
      const event = normalizeEvent(raw);
      const existing = this._rawEvents.get(event.id);
      if (!existing) {
        this._rawEvents.set(event.id, event);
      } else if (stableStringify(existing) !== stableStringify(event)) {
        existing.__conflicts = existing.__conflicts || [];
        existing.__conflicts.push(event);
      }
    }
    return this;
  }

  /**
   * 产出不可变 Dataset。给定同样的输入集合，无论批次切分/到达顺序如何，
   * 输出的规范化内容完全一致。
   */
  buildDataset() {
    const anomalies = [];
    const records = new Map();
    const events = new Map();

    const resolveDupes = (rawMap, ownerType, target) => {
      for (const [id, first] of rawMap) {
        const variants = [first, ...(first.__conflicts ?? [])].map((v) => {
          const copy = { ...v };
          delete copy.__conflicts;
          return copy;
        });
        if (variants.length > 1) {
          const payloads = variants.map((v) => stableStringify(v));
          const distinct = [...new Set(payloads)].sort();
          if (distinct.length > 1) {
            anomalies.push({
              category: ANOMALY_CATEGORY.DUPLICATE,
              code: ANOMALY_CODE.INCONSISTENT_DUPLICATE,
              ownerType,
              ownerId: id,
              message: `${ownerType} "${id}" imported with ${distinct.length} inconsistent payloads`,
              details: { payloadHashes: distinct.map((p) => contentHash(p)) },
            });
          }
          target.set(id, JSON.parse(distinct[0]));
        } else {
          target.set(id, variants[0]);
        }
      }
    };
    resolveDupes(this._rawRecords, 'record', records);
    resolveDupes(this._rawEvents, 'event', events);

    const validLinks = new Map();
    const checkLinks = (ownerType, ownerId, links) => {
      const valid = [];
      for (const ref of links) {
        if (!records.has(ref)) {
          anomalies.push({
            category: ANOMALY_CATEGORY.LINK_INTEGRITY,
            code: ANOMALY_CODE.MISSING_REFERENCE,
            ownerType,
            ownerId,
            message: `${ownerType} "${ownerId}" references missing record "${ref}"`,
            details: { reference: ref },
          });
          continue;
        }
        if (ref === ownerId) {
          anomalies.push({
            category: ANOMALY_CATEGORY.LINK_INTEGRITY,
            code: ANOMALY_CODE.SELF_REFERENCE,
            ownerType,
            ownerId,
            message: `${ownerType} "${ownerId}" references itself`,
            details: { reference: ref },
          });
          continue;
        }
        valid.push(ref);
      }
      validLinks.set(ownerType === 'event' ? `event:${ownerId}` : ownerId, [...new Set(valid)].sort(compareStrings));
    };
    for (const [id, record] of records) checkLinks('record', id, record.links);
    for (const [id, event] of events) checkLinks('event', id, event.links);

    // 成环检测：在“记录间有效边”构成的图上找非平凡强连通分量。
    const nodeIds = [...records.keys()].sort(compareStrings);
    const indexById = new Map(nodeIds.map((id, i) => [id, i]));
    const adjacency = nodeIds.map((id) =>
      validLinks.get(id).map((to) => indexById.get(to)),
    );

    // 迭代版 Tarjan SCC，避免大样例递归栈溢出。
    let discovery = 0;
    const dfn = new Array(nodeIds.length).fill(0);
    const low = new Array(nodeIds.length).fill(0);
    const onStack = new Array(nodeIds.length).fill(false);
    const stack = [];
    const sccs = [];
    for (const start of nodeIds.map((_, i) => i)) {
      if (dfn[start]) continue;
      const work = [{ v: start, next: 0 }];
      while (work.length) {
        const frame = work[work.length - 1];
        const { v } = frame;
        if (frame.next === 0) {
          discovery += 1;
          dfn[v] = low[v] = discovery;
          stack.push(v);
          onStack[v] = true;
        }
        if (frame.next < adjacency[v].length) {
          const w = adjacency[v][frame.next];
          frame.next += 1;
          if (!dfn[w]) {
            work.push({ v: w, next: 0 });
          } else if (onStack[w]) {
            low[v] = Math.min(low[v], dfn[w]);
          }
        } else {
          if (low[v] === dfn[v]) {
            const component = [];
            while (true) {
              const w = stack.pop();
              onStack[w] = false;
              component.push(w);
              if (w === v) break;
            }
            sccs.push(component);
          }
          work.pop();
          if (work.length) {
            const parent = work[work.length - 1].v;
            low[parent] = Math.min(low[parent], low[v]);
          }
        }
      }
    }

    for (const component of sccs) {
      if (component.length === 1) continue; // 自引用已在前面单独归属
      const cycleIds = component.map((i) => nodeIds[i]).sort(compareStrings);
      for (const id of cycleIds) {
        anomalies.push({
          category: ANOMALY_CATEGORY.LINK_INTEGRITY,
          code: ANOMALY_CODE.REFERENCE_CYCLE,
          ownerType: 'record',
          ownerId: id,
          message: `record "${id}" participates in a reference cycle`,
          details: { cycle: cycleIds },
        });
      }
    }

    anomalies.sort(
      (a, b) =>
        compareStrings(a.category, b.category) ||
        compareStrings(a.code, b.code) ||
        compareStrings(a.ownerType, b.ownerType) ||
        compareStrings(a.ownerId, b.ownerId) ||
        compareStrings(stableStringify(a.details ?? null), stableStringify(b.details ?? null)),
    );

    return Object.freeze({
      records,
      events,
      anomalies: Object.freeze(anomalies.map((a) => Object.freeze(deepClone(a)))),
      validLinks,
    });
  }
}

/** 便捷函数：一次性导入全部输入（等价于单批次）。 */
export function buildDatasetFromInput(input = {}) {
  return new Importer().ingestBatch(input).buildDataset();
}
