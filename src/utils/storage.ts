import type { CanvasState, Card, CardGroup, Connection } from '../types.ts';
import { CANVAS_STORAGE_VERSION, STORAGE_KEY } from '../types.ts';
import type { MembershipConflict } from './groups.ts';

export type LoadIssue =
  | { kind: 'membership-conflict'; conflict: MembershipConflict }
  | { kind: 'dangling-connection'; connectionId: string }
  | { kind: 'unknown-member'; groupId: string; cardId: string };

export type LoadResult = {
  state: CanvasState;
  /** 加载/迁移过程中发现的可观察问题（不会因缺字段而整体失败） */
  issues: LoadIssue[];
  migratedFrom: number | null;
};

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function sanitizeCard(raw: unknown): Card | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    title: str(raw.title, ''),
    content: str(raw.content, ''),
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined,
    color: str(raw.color, '#2a2a4e'),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: num(raw.width, 200),
    height: num(raw.height, 150),
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
  };
}

function sanitizeConnection(raw: unknown): Connection | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  if (typeof raw.fromCardId !== 'string' || typeof raw.toCardId !== 'string') return null;
  return {
    id: raw.id,
    fromCardId: raw.fromCardId,
    toCardId: raw.toCardId,
    type: raw.type === 'dashed' ? 'dashed' : 'arrow',
    color: str(raw.color, '#aaaaaa'),
    label: str(raw.label, ''),
  };
}

function sanitizeGroup(raw: unknown): CardGroup | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const memberIds = Array.isArray(raw.memberIds)
    ? raw.memberIds.filter((m): m is string => typeof m === 'string')
    : [];
  return {
    id: raw.id,
    name: str(raw.name, '未命名卡组'),
    collapsed: raw.collapsed === true,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    memberIds,
    color: str(raw.color, '#4d96ff'),
  };
}

/**
 * 归一化画布状态：兼容 v1（无 groups 字段）与字段缺失的脏数据。
 * 归一化规则（全部可观察，记录到 issues）：
 * - 缺失的 groups 视为空数组，不整体失败
 * - 一张卡出现在多个卡组：保留先出现的归属，后者移除并记录冲突
 * - 组成员引用不存在的卡片：移除该引用并记录
 * - 连线引用不存在的卡片：保留连线数据并记录 dangling（不静默丢弃）
 */
export function normalizeCanvasState(raw: unknown): LoadResult {
  const issues: LoadIssue[] = [];
  if (!isRecord(raw)) {
    return { state: emptyCanvasState(), issues, migratedFrom: null };
  }
  const version = num(raw.version, 1);
  const migratedFrom = version < CANVAS_STORAGE_VERSION ? version : null;

  const cards = (Array.isArray(raw.cards) ? raw.cards : [])
    .map(sanitizeCard)
    .filter((c): c is Card => c !== null);
  const cardIds = new Set(cards.map((c) => c.id));

  const connections = (Array.isArray(raw.connections) ? raw.connections : [])
    .map(sanitizeConnection)
    .filter((c): c is Connection => c !== null);
  for (const conn of connections) {
    if (!cardIds.has(conn.fromCardId) || !cardIds.has(conn.toCardId)) {
      issues.push({ kind: 'dangling-connection', connectionId: conn.id });
    }
  }

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups: CardGroup[] = [];
  const owner = new Map<string, string>();
  for (const rawGroup of rawGroups) {
    const g = sanitizeGroup(rawGroup);
    if (!g) continue;
    const memberIds: string[] = [];
    for (const cardId of g.memberIds) {
      if (!cardIds.has(cardId)) {
        issues.push({ kind: 'unknown-member', groupId: g.id, cardId });
        continue;
      }
      const kept = owner.get(cardId);
      if (kept) {
        issues.push({
          kind: 'membership-conflict',
          conflict: { cardId, keptGroupId: kept, rejectedGroupId: g.id },
        });
        continue;
      }
      owner.set(cardId, g.id);
      memberIds.push(cardId);
    }
    groups.push({ ...g, memberIds });
  }

  const state: CanvasState = {
    version: CANVAS_STORAGE_VERSION,
    offsetX: num(raw.offsetX, 0),
    offsetY: num(raw.offsetY, 0),
    scale: num(raw.scale, 1),
    cards,
    connections,
    groups,
    outlineOrder: Array.isArray(raw.outlineOrder)
      ? raw.outlineOrder.filter((v): v is string => typeof v === 'string')
      : undefined,
  };
  return { state, issues, migratedFrom };
}

export function serializeCanvasState(state: CanvasState): string {
  return JSON.stringify({ ...state, version: CANVAS_STORAGE_VERSION });
}

export function saveCanvasState(state: CanvasState): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeCanvasState(state));
  } catch {
    // 存储不可用（隐私模式/超限）时静默失败，不打断编辑
  }
}

export function loadCanvasState(): LoadResult | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    return normalizeCanvasState(JSON.parse(text));
  } catch {
    return null;
  }
}
