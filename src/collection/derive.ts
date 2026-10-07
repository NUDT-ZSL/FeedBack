import type { Scroll } from '../types/index.ts';
import { adjudicateRecord } from './validate.ts';
import type {
  AdjudicationRecord,
  DerivedCollectionItem,
  DerivedCollectionState,
  RawCollectionRecord,
} from './types.ts';

const makeOrderAdjudication = (
  scrollId: string,
  kind: 'order-conflict' | 'order-normalized',
  input: unknown,
  decision: string,
  output: unknown,
  reason: string,
  at: number,
): AdjudicationRecord => ({
  id: `${scrollId}::${kind}::requestedOrder`,
  scrollId,
  kind,
  field: 'requestedOrder',
  input,
  decision,
  output,
  reason,
  at,
});

interface OrderCandidate {
  record: RawCollectionRecord;
  item: Omit<DerivedCollectionItem, 'order'>;
  adjudications: AdjudicationRecord[];
}

/**
 * 顺序归一：requestedOrder 非法（缺失/非有限数/负数）的记录排在末尾；
 * 并列时按 collectedAt、再按 scrollId 字典序确定性裁决，全部留痕。
 */
export const normalizeOrder = (
  candidates: OrderCandidate[],
): { items: DerivedCollectionItem[]; adjudications: AdjudicationRecord[] } => {
  const isValidOrder = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

  const decorated = candidates.map((candidate, index) => ({
    candidate,
    index,
    valid: isValidOrder(candidate.record.requestedOrder),
    requested: isValidOrder(candidate.record.requestedOrder)
      ? (candidate.record.requestedOrder as number)
      : Number.POSITIVE_INFINITY,
  }));

  const sorted = [...decorated].sort((a, b) => {
    if (a.requested !== b.requested) return a.requested - b.requested;
    if (a.candidate.record.collectedAt !== b.candidate.record.collectedAt) {
      return a.candidate.record.collectedAt - b.candidate.record.collectedAt;
    }
    return a.candidate.record.scrollId < b.candidate.record.scrollId ? -1 : 1;
  });

  const adjudications: AdjudicationRecord[] = [];

  const byRequested = new Map<number, typeof sorted>();
  sorted.forEach((entry) => {
    if (!entry.valid) return;
    const group = byRequested.get(entry.requested) ?? [];
    group.push(entry);
    byRequested.set(entry.requested, group);
  });
  byRequested.forEach((group, requested) => {
    if (group.length < 2) return;
    group.forEach((entry) => {
      adjudications.push(
        makeOrderAdjudication(
          entry.candidate.record.scrollId,
          'order-conflict',
          requested,
          `顺序位 ${requested} 被 ${group.length} 条收藏同时占用，按收藏时间再按卷轴 id 字典序裁决`,
          sorted.indexOf(entry),
          '同一顺序位只允许一条收藏，冲突不得静默随机落位',
          entry.candidate.record.collectedAt,
        ),
      );
    });
  });

  const items = sorted.map((entry, order) => {
    if (!entry.valid) {
      adjudications.push(
        makeOrderAdjudication(
          entry.candidate.record.scrollId,
          'order-normalized',
          entry.candidate.record.requestedOrder ?? null,
          `顺序位缺失或非法，归一到末尾第 ${order} 位`,
          order,
          'requestedOrder 必须是非负有限数',
          entry.candidate.record.collectedAt,
        ),
      );
    }
    return { ...entry.candidate.item, order };
  });

  return { items, adjudications };
};

/** 整体重推：从原始记录出发完整推导收藏链（卷轴 → 印章/题跋 → 顺序）。 */
export const deriveAll = (
  records: RawCollectionRecord[],
  scrollsById: ReadonlyMap<string, Scroll>,
): DerivedCollectionState => {
  const candidates: OrderCandidate[] = [];
  const adjudications: AdjudicationRecord[] = [];

  records.forEach((record) => {
    const { item, adjudications: recordAdj } = adjudicateRecord(
      record,
      scrollsById.get(record.scrollId),
    );
    adjudications.push(...recordAdj);
    if (item) {
      candidates.push({ record, item, adjudications: recordAdj });
    }
  });

  const ordered = normalizeOrder(candidates);
  return {
    items: ordered.items,
    adjudications: [...adjudications, ...ordered.adjudications],
  };
};

/** 状态签名：用于增量重推与整体重推的一致性比对。 */
export const stateSignature = (state: DerivedCollectionState): string =>
  JSON.stringify({
    items: state.items.map((item) => ({
      scrollId: item.scrollId,
      colophon: item.colophon,
      seal: item.seal
        ? {
            shape: item.seal.shape,
            character: item.seal.character,
            color: item.seal.color,
            rotation: item.seal.rotation,
            position: item.seal.position,
          }
        : null,
      collectedAt: item.collectedAt,
      order: item.order,
    })),
    adjudications: state.adjudications,
  });
