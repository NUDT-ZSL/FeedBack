import type { CollectedScroll, Scroll, Seal } from '../../types/index.ts';
import { adjudicateEntry, normalizeOrder } from './adjudicate.ts';
import type { AdjudicationIssue, RawCollectionState, RawCollectionEntry } from './raw.ts';

export type DerivedSeal = Seal;

/** 单条收藏沿依赖链推导出的结果：卷轴目录 + 题跋 + 印章裁决（不含顺序，顺序是全局依赖） */
export interface DerivedEntry {
  scrollId: string;
  scroll: Scroll;
  colophon: string;
  seal: DerivedSeal | null;
  collectedAt: number;
  issues: AdjudicationIssue[];
}

/** 整体推导结果：同一卷轴的收藏结果、印章、题跋、顺序都只此一份 */
export interface DerivedCollection {
  /** 最终收藏结果，按收藏顺序排列；order 从 0 起连续且唯一 */
  ordered: CollectedScroll[];
  /** 按 scrollId 索引的单条推导，供局部重推与 UI 定点读取 */
  entries: Record<string, DerivedEntry>;
  issues: AdjudicationIssue[];
  /** 被拒绝的原始条目（含裁决依据），不静默吞掉 */
  rejected: Array<{ index: number; issues: AdjudicationIssue[] }>;
  revision: string;
}

export interface SliceCacheEntry {
  revision: string;
  entry: DerivedEntry;
}

export type SliceCache = Map<string, SliceCacheEntry>;

/**
 * 切片哈希只覆盖 卷轴->题跋/印章 的局部依赖；order 是全局依赖，
 * 因此重排顺序不会使任何单条切片失效。
 */
function hashEntry(entry: RawCollectionEntry): string {
  const { order: _order, ...local } = entry;
  return hashRaw({ entries: [local] });
}

/** 对原始状态做确定性哈希（FNV-1a 32 位） */
export function hashRaw(state: RawCollectionState): string {
  const json = JSON.stringify(state.entries.map((e) => [
    e.scrollId,
    e.colophon,
    e.collectedAt,
    e.order,
    e.seal === undefined || e.seal === null
      ? e.seal
      : [
          e.seal.id, e.seal.shape, e.seal.character, e.seal.color,
          e.seal.rotation,
          e.seal.position && typeof e.seal.position === 'object'
            ? [
                (e.seal.position as { x?: unknown }).x,
                (e.seal.position as { y?: unknown }).y,
              ]
            : e.seal.position,
        ],
  ]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 顺序裁决（全局依赖）：
 * order(非空优先) -> 空排末尾；同 order 按 collectedAt；再同按原始下标。
 * 同一 order 被多条占用即视为顺序冲突并逐条留痕；最终位置重写为 0..n-1 连续唯一。
 */
export function resolveOrder(
  accepted: Array<{ scrollId: string; requestedOrder: number | null; collectedAt: number; rawIndex: number }>,
): { ordered: Array<{ scrollId: string; order: number }>; issues: AdjudicationIssue[] } {
  const seenOrders = new Map<number, string[]>();
  for (const holder of accepted) {
    if (holder.requestedOrder === null) continue;
    const list = seenOrders.get(holder.requestedOrder) ?? [];
    list.push(holder.scrollId);
    seenOrders.set(holder.requestedOrder, list);
  }
  const issues: AdjudicationIssue[] = [];
  for (const [orderValue, ids] of seenOrders) {
    if (ids.length > 1) {
      issues.push({
        code: 'entry.order-conflict',
        severity: 'clamp',
        path: 'entries[*].order',
        received: orderValue,
        resolution: `order=${orderValue} 被 ${ids.length} 条收藏同时占用，按 入藏时间->原始下标 决胜后重排：${ids.join(', ')}`,
      });
    }
  }

  const sorted = [...accepted].sort((a, b) => {
    if (a.requestedOrder !== b.requestedOrder) {
      if (a.requestedOrder === null) return 1;
      if (b.requestedOrder === null) return -1;
      if (a.requestedOrder !== b.requestedOrder) return a.requestedOrder - b.requestedOrder;
    }
    if (a.collectedAt !== b.collectedAt) return a.collectedAt - b.collectedAt;
    return a.rawIndex - b.rawIndex;
  });

  return {
    ordered: sorted.map((item, index) => ({ scrollId: item.scrollId, order: index })),
    issues,
  };
}

interface AcceptedEntry {
  scrollId: string;
  requestedOrder: number | null;
  collectedAt: number;
  rawIndex: number;
}

/**
 * 唯一的推导实现：整体重推（无缓存）与局部重推（命中切片缓存）共用此函数，
 * 因此单条修改后局部重推的结果与整体重推天然一致（验证脚本再做断言）。
 * 传入 cache 时，未变化的切片直接复用，仅重推受影响条目；顺序始终全局重算。
 */
export function deriveAll(
  rawState: RawCollectionState,
  catalogById: Map<string, Scroll>,
  cache?: SliceCache,
): { derived: DerivedCollection; recomputed: string[] } {
  const entries: Record<string, DerivedEntry> = {};
  const accepted: AcceptedEntry[] = [];
  const rejected: DerivedCollection['rejected'] = [];
  const issues: AdjudicationIssue[] = [];
  const knownScrollIds = new Set<string>();
  const recomputed: string[] = [];

  // 同一卷轴出现多次时不使用缓存（“最先一条胜出”依赖位置），退回全量裁决
  const declaredIds = rawState.entries
    .map((e) => e.scrollId)
    .filter((id): id is string => typeof id === 'string');
  const useCache = cache !== undefined && new Set(declaredIds).size === declaredIds.length;

  rawState.entries.forEach((raw, index) => {
    const scrollId = typeof raw.scrollId === 'string' ? raw.scrollId : null;
    const pathBase = scrollId ? `entries[${scrollId}]` : `entries[${index}]`;
    // order 是全局依赖：每次推导都从原始记录现算，切片缓存不携带它
    const orderResult = normalizeOrder(raw.order, `${pathBase}.order`);
    const sliceRevision = hashEntry(raw);
    const cached = useCache && scrollId ? (cache as SliceCache).get(scrollId) : undefined;
    if (cached && cached.revision === sliceRevision) {
      entries[scrollId as string] = cached.entry;
      knownScrollIds.add(scrollId as string);
      accepted.push({
        scrollId: scrollId as string,
        requestedOrder: orderResult.order,
        collectedAt: cached.entry.collectedAt,
        rawIndex: index,
      });
      issues.push(...cached.entry.issues, ...orderResult.issues);
      return;
    }

    const verdict = adjudicateEntry(raw, pathBase, catalogById, knownScrollIds);
    if (!verdict.accepted || !verdict.normalized) {
      rejected.push({ index, issues: verdict.issues });
      issues.push(...verdict.issues);
      if (scrollId) (cache as SliceCache | undefined)?.delete(scrollId);
      return;
    }

    const { normalized } = verdict;
    const sealVerdict = normalized.seal;
    const seal: Seal | null = sealVerdict.accepted && sealVerdict.seal
      ? {
          ...(sealVerdict.seal as Seal),
          id: sealVerdict.seal.id || `seal-${verdict.scrollId}`,
        }
      : null;
    const entry: DerivedEntry = {
      scrollId: verdict.scrollId as string,
      scroll: catalogById.get(verdict.scrollId as string) as Scroll,
      colophon: normalized.colophon,
      seal,
      collectedAt: normalized.collectedAt,
      issues: verdict.issues,
    };
    entries[entry.scrollId] = entry;
    accepted.push({
      scrollId: entry.scrollId,
      requestedOrder: orderResult.order,
      collectedAt: entry.collectedAt,
      rawIndex: index,
    });
    issues.push(...entry.issues, ...orderResult.issues);
    if (useCache && scrollId) {
      (cache as SliceCache).set(scrollId, { revision: sliceRevision, entry });
      recomputed.push(scrollId);
    }
  });

  // 已被清除的收藏，其切片缓存同步失效
  if (cache) {
    for (const key of [...cache.keys()]) {
      if (!entries[key]) cache.delete(key);
    }
  }

  const orderResult = resolveOrder(accepted);
  issues.push(...orderResult.issues);
  const orderIndex = new Map(orderResult.ordered.map((o) => [o.scrollId, o.order]));

  const ordered: CollectedScroll[] = orderResult.ordered.map(({ scrollId }) => {
    const derived = entries[scrollId];
    return {
      ...derived.scroll,
      colophon: derived.colophon,
      seal: derived.seal,
      collectedAt: derived.collectedAt,
      order: orderIndex.get(scrollId) as number,
    };
  });

  return {
    derived: { ordered, entries, issues, rejected, revision: hashRaw(rawState) },
    recomputed,
  };
}

/** 整体重推：沿 卷轴 -> 题跋/印章 -> 顺序 的依赖链一次性推导全部收藏 */
export function deriveCollection(rawState: RawCollectionState, catalog: Scroll[]): DerivedCollection {
  const catalogById = new Map(catalog.map((s) => [s.id, s]));
  return deriveAll(rawState, catalogById).derived;
}

/** 只推导单条收藏：卷轴 -> 印章/题跋，不触碰全局顺序 */
export function deriveEntry(
  rawState: RawCollectionState,
  scrollId: string,
  catalog: Scroll[],
): DerivedEntry | null {
  const raw = rawState.entries.find((e) => e.scrollId === scrollId);
  if (!raw) return null;
  const catalogById = new Map(catalog.map((s) => [s.id, s]));
  const { derived } = deriveAll({ entries: [raw] }, catalogById);
  return derived.entries[scrollId] ?? null;
}
