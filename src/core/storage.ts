/**
 * 本地持久化：工作区整体存入 localStorage，完全离线可用。
 */
import type { Workspace } from './types';

const KEY = 'sishan.workspace.v1';

export function loadWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Workspace;
    if (parsed.version !== 1 || !Array.isArray(parsed.banquets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
  } catch {
    // 存储不可用时静默降级为内存态
  }
}

export function clearWorkspace(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
