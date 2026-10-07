import { useSyncExternalStore } from 'react';
import scrolls from '../data/scrolls';
import { CollectionStore } from '../collection/store';
import type { DerivedCollectionState } from '../collection/types';

/** 收藏域唯一状态源：全应用共享一个 store，不再各存副本。 */
export const collectionStore = new CollectionStore(scrolls);

export const useCollectionState = (): DerivedCollectionState =>
  useSyncExternalStore(collectionStore.subscribe, collectionStore.getState);
