import type { Scroll } from '../types/index.ts';
import { deriveAll, normalizeOrder } from './derive.ts';
import { adjudicateRecord } from './validate.ts';
import type {
  AdjudicationRecord,
  CollectionChange,
  DerivationReport,
  DerivedCollectionItem,
  DerivedCollectionState,
  RawCollectionRecord,
} from './types.ts';

type ItemWithoutOrder = Omit<DerivedCollectionItem, 'order'>;

/**
 * 收藏域唯一状态源。
 * 原始记录只存一份（records），每条记录的卷轴/印章/题跋推导结果缓存一份，
 * 顺序由全量记录统一归一；单条修改只重推该条与受影响的顺序位。
 */
export class CollectionStore {
  private readonly scrollsById: ReadonlyMap<string, Scroll>;
  private records = new Map<string, RawCollectionRecord>();
  private itemCache = new Map<string, ItemWithoutOrder>();
  private recordAdjudications = new Map<string, AdjudicationRecord[]>();
  private state: DerivedCollectionState = { items: [], adjudications: [] };
  private listeners = new Set<() => void>();

  constructor(scrolls: Scroll[]) {
    this.scrollsById = new Map(scrolls.map((scroll) => [scroll.id, scroll]));
  }

  getState = (): DerivedCollectionState => this.state;

  getRawRecords = (): RawCollectionRecord[] => [...this.records.values()];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 整体重推：丢弃全部缓存，从原始记录完整推导。供校验与兜底使用。 */
  rederiveAll = (): DerivedCollectionState => {
    this.itemCache.clear();
    this.recordAdjudications.clear();
    const records = this.getRawRecords();
    records.forEach((record) => {
      const { item, adjudications } = adjudicateRecord(record, this.scrollsById.get(record.scrollId));
      this.recordAdjudications.set(record.scrollId, adjudications);
      if (item) this.itemCache.set(record.scrollId, item);
    });
    this.state = deriveAll(records, this.scrollsById);
    this.emit();
    return this.state;
  };

  /** 局部重推：只重推被修改的记录与受影响的顺序位，结果与整体重推一致。 */
  dispatch = (change: CollectionChange): DerivationReport => {
    const previousOrders = new Map(this.state.items.map((item) => [item.scrollId, item.order]));
    const touched = this.applyChange(change);
    if (touched.length === 0 && change.kind !== 'remove') {
      return { affectedScrollIds: [], adjudications: this.state.adjudications, state: this.state };
    }

    const candidates = [...this.records.values()].flatMap((record) => {
      const item = this.itemCache.get(record.scrollId);
      return item ? [{ record, item, adjudications: this.recordAdjudications.get(record.scrollId) ?? [] }] : [];
    });
    const ordered = normalizeOrder(candidates);

    const adjudications: AdjudicationRecord[] = [];
    this.records.forEach((record) => {
      adjudications.push(...(this.recordAdjudications.get(record.scrollId) ?? []));
    });
    adjudications.push(...ordered.adjudications);

    this.state = { items: ordered.items, adjudications };

    const affected = new Set<string>(touched);
    this.state.items.forEach((item) => {
      if (previousOrders.get(item.scrollId) !== item.order) affected.add(item.scrollId);
    });
    previousOrders.forEach((_, scrollId) => {
      if (!this.records.has(scrollId)) affected.add(scrollId);
    });

    this.emit();
    return {
      affectedScrollIds: [...affected],
      adjudications: this.state.adjudications,
      state: this.state,
    };
  };

  private applyChange = (change: CollectionChange): string[] => {
    switch (change.kind) {
      case 'collect': {
        const { record } = change;
        this.records.set(record.scrollId, record);
        this.deriveRecord(record);
        return [record.scrollId];
      }
      case 'update': {
        const existing = this.records.get(change.scrollId);
        if (!existing) return [];
        const next: RawCollectionRecord = { ...existing, ...change.patch, scrollId: change.scrollId };
        this.records.set(change.scrollId, next);
        this.deriveRecord(next);
        return [change.scrollId];
      }
      case 'move': {
        const existing = this.records.get(change.scrollId);
        if (!existing) return [];
        this.records.set(change.scrollId, { ...existing, requestedOrder: change.requestedOrder });
        return [change.scrollId];
      }
      case 'remove': {
        this.records.delete(change.scrollId);
        this.itemCache.delete(change.scrollId);
        this.recordAdjudications.delete(change.scrollId);
        return [change.scrollId];
      }
    }
  };

  private deriveRecord = (record: RawCollectionRecord): void => {
    const { item, adjudications } = adjudicateRecord(record, this.scrollsById.get(record.scrollId));
    this.recordAdjudications.set(record.scrollId, adjudications);
    if (item) {
      this.itemCache.set(record.scrollId, item);
    } else {
      this.itemCache.delete(record.scrollId);
    }
  };

  private emit = (): void => {
    this.listeners.forEach((listener) => listener());
  };
}
