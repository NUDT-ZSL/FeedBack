import { useEffect, useState } from 'react';
import type { CollectionEngine } from '../engine.ts';
import type { DerivedCollection } from '../domain/derive.ts';
import type { RawSeal } from '../domain/raw.ts';

export interface CollectionActions {
  collection: DerivedCollection;
  isCollected: (scrollId: string) => boolean;
  collect: (scrollId: string) => void;
  remove: (scrollId: string) => void;
  setColophon: (scrollId: string, colophon: string) => void;
  setSeal: (scrollId: string, seal: RawSeal | null) => void;
  reorder: (orderedScrollIds: string[]) => void;
}

/** React 侧唯一读取收藏状态的入口：所有组件共享同一份引擎推导结果 */
export function useCollection(engine: CollectionEngine): CollectionActions {
  const [collection, setCollection] = useState<DerivedCollection>(() => engine.getDerived());

  useEffect(() => engine.subscribe(() => setCollection(engine.getDerived())), [engine]);

  return {
    collection,
    isCollected: (scrollId) => scrollId in collection.entries,
    collect: (scrollId) => {
      if (scrollId in collection.entries) return;
      engine.upsertEntry({
        scrollId,
        colophon: '',
        seal: null,
        collectedAt: Date.now(),
        order: collection.ordered.length,
      });
    },
    remove: (scrollId) => engine.removeEntry(scrollId),
    setColophon: (scrollId, colophon) => engine.patchEntry(scrollId, { colophon }),
    setSeal: (scrollId, seal) => engine.patchEntry(scrollId, { seal }),
    reorder: (orderedScrollIds) => engine.reorder(orderedScrollIds),
  };
}
