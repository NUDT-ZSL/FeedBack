import type { CanvasState } from '../types.ts';
import {
  CANVAS_STORAGE_VERSION,
  COLLAPSED_GROUP_HEIGHT,
  COLLAPSED_GROUP_WIDTH,
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  GROUP_COLORS,
  MAX_SCALE,
  MIN_SCALE,
  STORAGE_KEY,
} from '../types.ts';
import { createId } from './groups.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LoadResult {
  ok: boolean;
  state?: CanvasState;
  /** 数据原始版本；低于当前版本表示发生了兼容迁移 */
  migratedFrom?: number;
  /** 兼容修复过程的可观察说明（缺字段补默认、非法成员被剔除等） */
  warnings: string[];
  error?: string;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 把任意来源的数据迁移为当前版本 CanvasState。
 * 旧版本（v1，无 groups 字段）或缺字段的数据按默认值补齐，不会整体失败；
 * 仅当输入根本不是对象时才判定加载失败。
 */
export function migrateState(raw: unknown): LoadResult {
  const warnings: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, warnings, error: '状态数据不是有效的对象' };
  }
  const data = raw as Record<string, unknown>;
  const originalVersion = num(data.version, 1);
  if (originalVersion < CANVAS_STORAGE_VERSION) {
    warnings.push(`检测到 v${originalVersion} 旧版本状态，已兼容迁移到 v${CANVAS_STORAGE_VERSION}`);
  }

  const rawCards = Array.isArray(data.cards) ? data.cards : [];
  if (!Array.isArray(data.cards)) warnings.push('缺少 cards 字段，已按空列表处理');
  const cards = rawCards
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: str(item.id, createId()),
      title: str(item.title, ''),
      content: str(item.content, ''),
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
      color: str(item.color, '#2a2a4e'),
      x: num(item.x, 0),
      y: num(item.y, 0),
      width: num(item.width, DEFAULT_CARD_WIDTH),
      height: num(item.height, DEFAULT_CARD_HEIGHT),
      createdAt: num(item.createdAt, Date.now()),
      updatedAt: num(item.updatedAt, Date.now()),
    }));
  const cardIds = new Set(cards.map((card) => card.id));

  const rawConnections = Array.isArray(data.connections) ? data.connections : [];
  if (!Array.isArray(data.connections)) warnings.push('缺少 connections 字段，已按空列表处理');
  const connections = rawConnections
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => {
      const valid = cardIds.has(str(item.fromCardId, '')) && cardIds.has(str(item.toCardId, ''));
      if (!valid) warnings.push(`连线 ${str(item.id, '?')} 引用了不存在的卡片，已剔除`);
      return valid;
    })
    .map((item) => ({
      id: str(item.id, createId()),
      fromCardId: str(item.fromCardId, ''),
      toCardId: str(item.toCardId, ''),
      type: item.type === 'dashed' ? ('dashed' as const) : ('arrow' as const),
      color: str(item.color, '#aaaaaa'),
      label: str(item.label, ''),
    }));

  const rawGroups = Array.isArray(data.groups) ? data.groups : [];
  if (data.groups === undefined) {
    warnings.push('旧版本状态不含 groups 字段，已按空卡组列表兼容');
  } else if (!Array.isArray(data.groups)) {
    warnings.push('groups 字段格式非法，已按空卡组列表兼容');
  }
  const claimed = new Map<string, string>();
  const groups = rawGroups
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item, index) => {
      const groupId = str(item.id, createId());
      const memberIds = (Array.isArray(item.memberIds) ? item.memberIds : [])
        .filter((id): id is string => typeof id === 'string')
        .filter((id) => {
          if (!cardIds.has(id)) {
            warnings.push(`卡组「${str(item.name, groupId)}」的成员 ${id} 不存在，已剔除`);
            return false;
          }
          const owner = claimed.get(id);
          if (owner && owner !== groupId) {
            warnings.push(`卡片 ${id} 同时出现在多个卡组中，保留其在卡组 ${owner} 的归属`);
            return false;
          }
          claimed.set(id, groupId);
          return true;
        });
      return {
        id: groupId,
        name: str(item.name, `卡组 ${index + 1}`),
        color: str(item.color, GROUP_COLORS[index % GROUP_COLORS.length]),
        collapsed: item.collapsed === true,
        memberIds,
        x: num(item.x, 0),
        y: num(item.y, 0),
        width: num(item.width, 220),
        height: num(item.height, 120),
        collapsedWidth: num(item.collapsedWidth, COLLAPSED_GROUP_WIDTH),
        collapsedHeight: num(item.collapsedHeight, COLLAPSED_GROUP_HEIGHT),
        createdAt: num(item.createdAt, Date.now()),
        updatedAt: num(item.updatedAt, Date.now()),
      };
    });

  return {
    ok: true,
    migratedFrom: originalVersion,
    warnings,
    state: {
      version: CANVAS_STORAGE_VERSION,
      offsetX: num(data.offsetX, 0),
      offsetY: num(data.offsetY, 0),
      scale: clamp(num(data.scale, 1), MIN_SCALE, MAX_SCALE),
      cards,
      connections,
      groups,
    },
  };
}

export function serializeState(state: CanvasState): string {
  return JSON.stringify({ ...state, version: CANVAS_STORAGE_VERSION });
}

export function parseState(json: string): LoadResult {
  try {
    return migrateState(JSON.parse(json));
  } catch {
    return { ok: false, warnings: [], error: '状态数据不是合法的 JSON' };
  }
}

function defaultStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadCanvasState(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { ok: false, warnings: [], error: '当前环境不支持本地存储' };
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { ok: false, warnings: [], error: '没有找到已保存的画布状态' };
  return parseState(raw);
}

export function saveCanvasState(
  state: CanvasState,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeState(state));
    return true;
  } catch {
    return false;
  }
}

export function emptyCanvasState(): CanvasState {
  return {
    version: CANVAS_STORAGE_VERSION,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    cards: [],
    connections: [],
    groups: [],
  };
}
