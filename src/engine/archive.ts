// 落档存储：既有的“结论与依据一起落档”路径保持不变，
// 推演台的批注、裁决、依赖推演结果随结论一起存入同一份档案。
// 浏览器使用 localStorage；离线批处理可注入任意 ArchiveStore 实现（如文件）。

import type { ArchiveBundle } from './types.ts'

export interface ArchiveStore {
  save(bundle: ArchiveBundle): void
  load(): ArchiveBundle | null
  clear(): void
}

const STORAGE_KEY = 'xiangmian-ge:bench-archive:v1'

export class LocalStorageArchiveStore implements ArchiveStore {
  save(bundle: ArchiveBundle): void {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle))
  }
  load(): ArchiveBundle | null {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ArchiveBundle
  }
  clear(): void {
    globalThis.localStorage.removeItem(STORAGE_KEY)
  }
}

export class MemoryArchiveStore implements ArchiveStore {
  private bundle: ArchiveBundle | null = null
  save(bundle: ArchiveBundle): void {
    this.bundle = JSON.parse(JSON.stringify(bundle)) as ArchiveBundle
  }
  load(): ArchiveBundle | null {
    return this.bundle ? (JSON.parse(JSON.stringify(this.bundle)) as ArchiveBundle) : null
  }
  clear(): void {
    this.bundle = null
  }
}

export function archiveBundle(store: ArchiveStore, bundle: ArchiveBundle): void {
  store.save(bundle)
}

export function restoreBundle(store: ArchiveStore): ArchiveBundle | null {
  return store.load()
}
