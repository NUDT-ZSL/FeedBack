import { AnnotationStore } from './anchor/store';
import { createSampleDocument } from './sampleDocument';

const STORAGE_KEY = 'annotation-workbench:v1';

/** 离线加载：优先 localStorage，无数据时回退到内置示例文档。 */
export function loadStore(): AnnotationStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return AnnotationStore.fromJSON(raw);
  } catch {
    // 数据损坏时回退示例文档
  }
  return new AnnotationStore(createSampleDocument());
}

export function saveStore(store: AnnotationStore) {
  try {
    localStorage.setItem(STORAGE_KEY, store.toJSON());
  } catch {
    // 存储不可用时静默降级（仍保持离线可运行）
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
