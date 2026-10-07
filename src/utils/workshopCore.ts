import type {
  CarvingStyle,
  Position,
  SealDocument,
  SealFont,
  SealSize,
  SealSnapshot,
  WorkshopState,
} from '../types/index.ts';
import { MAX_CHARS } from '../types/index.ts';

export const WORKSHOP_STORAGE_KEY = 'seal-workshop-v1';
export const HISTORY_LIMIT = 100;

const genId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `seal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const DEFAULT_FONT: SealFont = 'xiaozhuan';
export const DEFAULT_SIZE: SealSize = '1cun';
export const DEFAULT_STYLE: CarvingStyle = 'yangke';

/** 初始（空白）印章参数：新增一方印时永远回到这里，不沿用上一方的任何状态 */
export function defaultSnapshot(): SealSnapshot {
  return {
    text: '',
    font: DEFAULT_FONT,
    size: DEFAULT_SIZE,
    style: DEFAULT_STYLE,
    strokeOffsets: {},
  };
}

export function createSeal(name: string, id: string = genId(), now: number = Date.now()): SealDocument {
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    ...defaultSnapshot(),
    history: { past: [], future: [] },
  };
}

export function createWorkshop(): WorkshopState {
  return { seals: [], activeId: null };
}

export function getActiveSeal(ws: WorkshopState): SealDocument | null {
  return ws.seals.find((s) => s.id === ws.activeId) ?? null;
}

export function snapshotOf(seal: SealDocument): SealSnapshot {
  return {
    text: seal.text,
    font: seal.font,
    size: seal.size,
    style: seal.style,
    strokeOffsets: { ...seal.strokeOffsets },
  };
}

function replaceSeal(ws: WorkshopState, next: SealDocument): WorkshopState {
  return { ...ws, seals: ws.seals.map((s) => (s.id === next.id ? next : s)) };
}

/** 新增一方印：回到初始状态并选中它，不影响其他印章 */
export function addSeal(ws: WorkshopState, id?: string, now?: number): WorkshopState {
  const seal = createSeal(`印章 ${ws.seals.length + 1}`, id, now);
  return { seals: [...ws.seals, seal], activeId: seal.id };
}

/** 删除印章：若删的是当前选中的一方，自动选中相邻一方（优先后者，否则前者）；删空后回到引导态 */
export function removeSeal(ws: WorkshopState, id: string): WorkshopState {
  const index = ws.seals.findIndex((s) => s.id === id);
  if (index === -1) return ws;
  const seals = ws.seals.filter((s) => s.id !== id);
  let activeId = ws.activeId;
  if (activeId === id) {
    const neighbor = seals[index] ?? seals[index - 1] ?? null;
    activeId = neighbor ? neighbor.id : null;
  }
  if (activeId !== null && !seals.some((s) => s.id === activeId)) {
    activeId = seals.length > 0 ? seals[seals.length - 1].id : null;
  }
  return { seals, activeId };
}

export function selectSeal(ws: WorkshopState, id: string): WorkshopState {
  if (!ws.seals.some((s) => s.id === id)) return ws;
  return { ...ws, activeId: id };
}

export interface SealPatch {
  text?: string;
  font?: SealFont;
  size?: SealSize;
  style?: CarvingStyle;
  strokeOffsets?: Record<number, Position>;
}

function normalizeText(text: string): string {
  return Array.from(text.replace(/\s/g, '')).slice(0, MAX_CHARS).join('');
}

/** 修改当前印章参数：记录一条历史，清空 redo 栈；只作用于指定 id 的那一方 */
export function updateSeal(
  ws: WorkshopState,
  id: string,
  patch: SealPatch,
  now: number = Date.now(),
): WorkshopState {
  const seal = ws.seals.find((s) => s.id === id);
  if (!seal) return ws;
  const next: SealDocument = {
    ...seal,
    updatedAt: now,
    history: {
      past: [...seal.history.past, snapshotOf(seal)].slice(-HISTORY_LIMIT),
      future: [],
    },
  };
  if (patch.text !== undefined) next.text = normalizeText(patch.text);
  if (patch.font !== undefined) next.font = patch.font;
  if (patch.size !== undefined) next.size = patch.size;
  if (patch.style !== undefined) next.style = patch.style;
  if (patch.strokeOffsets !== undefined) next.strokeOffsets = { ...patch.strokeOffsets };
  return replaceSeal(ws, next);
}

/** 调整某一方印中某个字的笔画偏移 */
export function setStrokeOffset(
  ws: WorkshopState,
  id: string,
  charIndex: number,
  offset: Position,
  now: number = Date.now(),
): WorkshopState {
  const seal = ws.seals.find((s) => s.id === id);
  if (!seal) return ws;
  return updateSeal(ws, id, { strokeOffsets: { ...seal.strokeOffsets, [charIndex]: { ...offset } } }, now);
}

/** 撤销：只回退当前选中印章的历史，不波及其他印章 */
export function undo(ws: WorkshopState): WorkshopState {
  const seal = getActiveSeal(ws);
  if (!seal || seal.history.past.length === 0) return ws;
  const past = [...seal.history.past];
  const previous = past.pop()!;
  const next: SealDocument = {
    ...seal,
    ...previous,
    strokeOffsets: { ...previous.strokeOffsets },
    updatedAt: Date.now(),
    history: { past, future: [...seal.history.future, snapshotOf(seal)] },
  };
  return replaceSeal(ws, next);
}

/** 重做：只作用于当前选中印章 */
export function redo(ws: WorkshopState): WorkshopState {
  const seal = getActiveSeal(ws);
  if (!seal || seal.history.future.length === 0) return ws;
  const future = [...seal.history.future];
  const nextState = future.pop()!;
  const next: SealDocument = {
    ...seal,
    ...nextState,
    strokeOffsets: { ...nextState.strokeOffsets },
    updatedAt: Date.now(),
    history: { past: [...seal.history.past, snapshotOf(seal)], future },
  };
  return replaceSeal(ws, next);
}

export function canUndo(ws: WorkshopState): boolean {
  const seal = getActiveSeal(ws);
  return !!seal && seal.history.past.length > 0;
}

export function canRedo(ws: WorkshopState): boolean {
  const seal = getActiveSeal(ws);
  return !!seal && seal.history.future.length > 0;
}

/* ---------- 序列化 / 恢复 ---------- */

const VALID_FONTS: SealFont[] = ['xiaozhuan', 'miaozhuan', 'jiudiezhuan'];
const VALID_SIZES: SealSize[] = ['1cun', '1.5cun', '2cun'];
const VALID_STYLES: CarvingStyle[] = ['yinke', 'yangke'];

function isPosition(v: unknown): v is Position {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Position).x === 'number' &&
    typeof (v as Position).y === 'number' &&
    Number.isFinite((v as Position).x) &&
    Number.isFinite((v as Position).y)
  );
}

function sanitizeOffsets(v: unknown): Record<number, Position> {
  const out: Record<number, Position> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [key, value] of Object.entries(v)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < MAX_CHARS && isPosition(value)) {
      out[index] = { x: value.x, y: value.y };
    }
  }
  return out;
}

function sanitizeSnapshot(v: unknown): SealSnapshot | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.text !== 'string') return null;
  if (!VALID_FONTS.includes(s.font as SealFont)) return null;
  if (!VALID_SIZES.includes(s.size as SealSize)) return null;
  if (!VALID_STYLES.includes(s.style as CarvingStyle)) return null;
  return {
    text: normalizeText(s.text),
    font: s.font as SealFont,
    size: s.size as SealSize,
    style: s.style as CarvingStyle,
    strokeOffsets: sanitizeOffsets(s.strokeOffsets),
  };
}

function sanitizeSeal(v: unknown): SealDocument | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== 'string' || s.id.length === 0) return null;
  const base = sanitizeSnapshot(s);
  if (!base) return null;
  const history = (typeof s.history === 'object' && s.history !== null ? s.history : {}) as Record<
    string,
    unknown
  >;
  const past = Array.isArray(history.past) ? history.past.map(sanitizeSnapshot).filter(Boolean) : [];
  const future = Array.isArray(history.future)
    ? history.future.map(sanitizeSnapshot).filter(Boolean)
    : [];
  const now = Date.now();
  return {
    id: s.id,
    name: typeof s.name === 'string' && s.name ? s.name : '印章',
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : now,
    ...base,
    history: {
      past: (past as SealSnapshot[]).slice(-HISTORY_LIMIT),
      future: (future as SealSnapshot[]).slice(-HISTORY_LIMIT),
    },
  };
}

/** 序列化整个工坊：印章数量、顺序、各自参数、笔画偏移与历史全部保留 */
export function serializeWorkshop(ws: WorkshopState): string {
  return JSON.stringify({ version: 1, seals: ws.seals, activeId: ws.activeId });
}

/** 从序列化文本恢复工坊；数据损坏时安全回退到空白工坊，绝不抛异常 */
export function deserializeWorkshop(json: string | null | undefined): WorkshopState {
  if (!json) return createWorkshop();
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const sealsRaw = Array.isArray(raw?.seals) ? raw.seals : [];
    const seals = sealsRaw.map(sanitizeSeal).filter(Boolean) as SealDocument[];
    const seen = new Set<string>();
    const unique = seals.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    const activeId =
      typeof raw?.activeId === 'string' && unique.some((s) => s.id === raw.activeId)
        ? (raw.activeId as string)
        : unique.length > 0
          ? unique[unique.length - 1].id
          : null;
    return { seals: unique, activeId };
  } catch {
    return createWorkshop();
  }
}
