import type { Scroll } from '../types/index.ts';
import { deriveAll, type DerivedCollection, type SliceCache } from './domain/derive.ts';
import type { RawCollectionEntry, RawCollectionState } from './domain/raw.ts';
import {
  COLLECTION_STORAGE_KEY,
  createBrowserStorage,
  loadRawState,
  saveRawState,
  type KeyValueStorage,
} from './storage/localStorage.ts';

export interface CollectionEngineOptions {
  catalog: Scroll[];
  /** 持久化适配器；默认浏览器 localStorage，离线验证可注入内存实现或传 null */
  storage?: KeyValueStorage | null;
  storageKey?: string;
  /** 初始原始状态（优先级高于持久化数据），用于离线验证与回放 */
  initialState?: RawCollectionState;
}

/**
 * 收藏引擎：收藏状态的唯一事实来源。
 * - 原始记录（raw）只此一份，收藏结果/印章/题跋/顺序全部由它沿依赖链推导；
 * - 单条修改或清除后只重推受影响切片（缓存未变切片），顺序作为全局依赖重算；
 * - 局部重推与整体重推共用 deriveAll，结果一致性由验证脚本断言。
 */
export class CollectionEngine {
  private readonly catalogById: Map<string, Scroll>;
  private readonly storage: KeyValueStorage | null;
  private readonly storageKey: string;
  private rawState: RawCollectionState;
  private sliceCache: SliceCache = new Map();
  private derived: DerivedCollection;
  private lastRecomputed: string[] = [];
  private listeners = new Set<() => void>();

  constructor(options: CollectionEngineOptions) {
    this.catalogById = new Map(options.catalog.map((s) => [s.id, s]));
    this.storage = options.storage === undefined ? createBrowserStorage() : options.storage;
    this.storageKey = options.storageKey ?? COLLECTION_STORAGE_KEY;
    this.rawState = options.initialState
      ?? (this.storage ? loadRawState(this.storage, this.storageKey) : null)
      ?? { entries: [] };
    this.derived = this.recompute();
    if (this.storage) saveRawState(this.storage, this.storageKey, this.rawState);
  }

  private recompute(): DerivedCollection {
    const { derived, recomputed } = deriveAll(this.rawState, this.catalogById, this.sliceCache);
    this.lastRecomputed = recomputed;
    return derived;
  }

  private commit(): void {
    this.derived = this.recompute();
    if (this.storage) saveRawState(this.storage, this.storageKey, this.rawState);
    for (const listener of this.listeners) listener();
  }

  /** 当前推导结果（只读快照） */
  getDerived(): DerivedCollection {
    return this.derived;
  }

  /** 上一次提交中实际被重推的 scrollId 列表（用于验证“只重推受影响部分”） */
  getLastRecomputed(): string[] {
    return this.lastRecomputed;
  }

  /** 原始状态深拷贝，供验证脚本构造场景 */
  getRawState(): RawCollectionState {
    return JSON.parse(JSON.stringify(this.rawState)) as RawCollectionState;
  }

  getRawEntry(scrollId: string): RawCollectionEntry | undefined {
    return this.rawState.entries.find((e) => e.scrollId === scrollId);
  }

  /** 强制整体重推（清空切片缓存），用于与局部重推对照 */
  recomputeAll(): DerivedCollection {
    this.sliceCache = new Map();
    this.derived = this.recompute();
    return this.derived;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 新增或整体替换一条收藏原始记录 */
  upsertEntry(entry: RawCollectionEntry): void {
    if (typeof entry.scrollId !== 'string' || !this.catalogById.has(entry.scrollId)) {
      throw new Error(`upsertEntry: 未知卷轴 ${String(entry.scrollId)}`);
    }
    const index = this.rawState.entries.findIndex((e) => e.scrollId === entry.scrollId);
    if (index >= 0) this.rawState.entries[index] = entry;
    else this.rawState.entries.push(entry);
    this.commit();
  }

  /** 局部修改单条收藏的若干字段（题跋/印章/顺序等） */
  patchEntry(scrollId: string, patch: Partial<RawCollectionEntry>): void {
    const index = this.rawState.entries.findIndex((e) => e.scrollId === scrollId);
    if (index < 0) throw new Error(`patchEntry: 未收藏 ${scrollId}`);
    this.rawState.entries[index] = { ...this.rawState.entries[index], ...patch, scrollId };
    this.commit();
  }

  /** 清除单条收藏 */
  removeEntry(scrollId: string): void {
    const next = this.rawState.entries.filter((e) => e.scrollId !== scrollId);
    if (next.length === this.rawState.entries.length) return;
    this.rawState = { entries: next };
    this.commit();
  }

  /** 按给定 scrollId 序列重写收藏顺序（0..n-1） */
  reorder(orderedScrollIds: string[]): void {
    const rank = new Map(orderedScrollIds.map((id, i) => [id, i]));
    this.rawState = {
      entries: this.rawState.entries.map((e) =>
        typeof e.scrollId === 'string' && rank.has(e.scrollId)
          ? { ...e, order: rank.get(e.scrollId) as number }
          : e),
    };
    this.commit();
  }

  /** 整体替换原始状态（离线验证/回放用） */
  setEntries(entries: RawCollectionEntry[]): void {
    this.rawState = { entries };
    this.commit();
  }
}
