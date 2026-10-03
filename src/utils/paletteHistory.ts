import { ColorInfo } from './colorUtils';

export type SnapshotKind = 'init' | 'refresh' | 'preset' | 'color';

export interface PaletteSnapshot {
  palette: ColorInfo[];
  selectedIndex: number;
  kind: SnapshotKind;
  editIndex: number | null;
  time: number;
}

export interface HistoryState {
  snapshots: PaletteSnapshot[];
  index: number;
}

export const COLOR_EDIT_COALESCE_MS = 1000;

export function clonePalette(palette: ColorInfo[]): ColorInfo[] {
  return palette.map((c) => ({ ...c }));
}

export function createSnapshot(
  palette: ColorInfo[],
  selectedIndex: number,
  kind: SnapshotKind,
  editIndex: number | null = null,
  time: number = Date.now()
): PaletteSnapshot {
  return {
    palette: clonePalette(palette),
    selectedIndex,
    kind,
    editIndex,
    time,
  };
}

export function createInitialHistory(palette: ColorInfo[]): HistoryState {
  return {
    snapshots: [createSnapshot(palette, 0, 'init')],
    index: 0,
  };
}

export function canUndo(state: HistoryState): boolean {
  return state.index > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.index < state.snapshots.length - 1;
}

// 提交一条新状态：丢弃重做分支后入栈
export function commitHistory(
  state: HistoryState,
  palette: ColorInfo[],
  selectedIndex: number,
  kind: SnapshotKind,
  time: number = Date.now()
): HistoryState {
  return {
    snapshots: [
      ...state.snapshots.slice(0, state.index + 1),
      createSnapshot(palette, selectedIndex, kind, null, time),
    ],
    index: state.index + 1,
  };
}

export function undoHistory(state: HistoryState): HistoryState {
  if (!canUndo(state)) return state;
  return { ...state, index: state.index - 1 };
}

export function redoHistory(state: HistoryState): HistoryState {
  if (!canRedo(state)) return state;
  return { ...state, index: state.index + 1 };
}

export interface ColorEditResult {
  state: HistoryState;
  changed: boolean;
}

// 修改单个色块：颜色相同则不变更；连续微调同一色块合并为一条记录；
// 其余情况下丢弃重做分支并入栈
export function editColorHistory(
  state: HistoryState,
  index: number,
  newColor: string,
  selectedIndex: number,
  lastEdit: { index: number; time: number } | null,
  now: number = Date.now()
): ColorEditResult {
  const current = state.snapshots[state.index];
  const target = current.palette[index];
  if (!target) return { state, changed: false };

  const normalized = newColor.toUpperCase();
  if (target.hex.toUpperCase() === normalized) {
    return { state, changed: false };
  }

  const nextPalette = clonePalette(current.palette);
  nextPalette[index] = { ...target, hex: normalized };

  const canCoalesce =
    current.kind === 'color' &&
    current.editIndex === index &&
    lastEdit !== null &&
    lastEdit.index === index &&
    now - lastEdit.time < COLOR_EDIT_COALESCE_MS;

  if (canCoalesce) {
    const snapshots = state.snapshots.slice();
    snapshots[state.index] = {
      ...current,
      palette: nextPalette,
      selectedIndex,
      time: now,
    };
    return { state: { ...state, snapshots }, changed: true };
  }

  return {
    state: {
      snapshots: [
        ...state.snapshots.slice(0, state.index + 1),
        createSnapshot(nextPalette, selectedIndex, 'color', index, now),
      ],
      index: state.index + 1,
    },
    changed: true,
  };
}
