/**
 * 编排台全局状态：包装核心引擎，所有修改经由引擎入口，
 * 自动持久化到 localStorage（离线可用）。
 */
import { create } from 'zustand';
import type { Workspace } from '@/core/types';
import {
  activeBanquet,
  addBanquet,
  addConstraint,
  addDish,
  addGuest,
  addTable,
  arrangeAll,
  arrangeBanquet,
  auditWorkspace,
  clearGuests,
  confirmArrangement,
  createDefaultWorkspace,
  removeBanquet,
  removeConstraint,
  removeDish,
  removeGuest,
  removeTable,
  renameBanquet,
  setTableDishes,
  switchBanquet,
  unconfirmArrangement,
  updateDishTags,
  updateGuest,
  updateTable,
} from '@/core/engine';
import type { BanquetAudit } from '@/core/engine';
import { loadWorkspace, saveWorkspace } from '@/core/storage';
import type { Guest, Rank } from '@/core/types';

interface WorkspaceStore {
  workspace: Workspace;
  dispatch: (fn: (ws: Workspace) => Workspace) => void;
}

export const useWorkspace = create<WorkspaceStore>((set) => ({
  workspace: loadWorkspace() ?? createDefaultWorkspace(),
  dispatch: (fn) =>
    set((state) => {
      const workspace = fn(state.workspace);
      saveWorkspace(workspace);
      return { workspace };
    }),
}));

export const useActiveBanquet = () =>
  useWorkspace((s) => activeBanquet(s.workspace));

export const actions = {
  addBanquet: (name: string) => (ws: Workspace) => addBanquet(ws, name),
  removeBanquet: (id: string) => (ws: Workspace) => removeBanquet(ws, id),
  renameBanquet: (id: string, name: string) => (ws: Workspace) =>
    renameBanquet(ws, id, name),
  switchBanquet: (id: string) => (ws: Workspace) => switchBanquet(ws, id),
  addGuest: (id: string, input: { name: string; dietary?: string[]; rank?: Rank; entourage?: number }) =>
    (ws: Workspace) => addGuest(ws, id, input),
  removeGuest: (id: string, guestId: string) => (ws: Workspace) =>
    removeGuest(ws, id, guestId),
  updateGuest: (id: string, guestId: string, patch: Partial<Pick<Guest, 'name' | 'dietary' | 'rank' | 'entourage'>>) =>
    (ws: Workspace) => updateGuest(ws, id, guestId, patch),
  clearGuests: (id: string) => (ws: Workspace) => clearGuests(ws, id),
  addTable: (id: string, input: { name: string; capacity: number; isMain?: boolean; minRank?: Rank }) =>
    (ws: Workspace) => addTable(ws, id, input),
  removeTable: (id: string, tableId: string) => (ws: Workspace) =>
    removeTable(ws, id, tableId),
  updateTable: (id: string, tableId: string, patch: Partial<{ name: string; capacity: number; isMain: boolean; minRank: Rank }>) =>
    (ws: Workspace) => updateTable(ws, id, tableId, patch),
  addDish: (id: string, input: { name: string; tags?: string[] }) => (ws: Workspace) =>
    addDish(ws, id, input),
  removeDish: (id: string, dishId: string) => (ws: Workspace) =>
    removeDish(ws, id, dishId),
  updateDishTags: (id: string, dishId: string, tags: string[]) => (ws: Workspace) =>
    updateDishTags(ws, id, dishId, tags),
  setTableDishes: (id: string, tableId: string, dishIds: string[]) => (ws: Workspace) =>
    setTableDishes(ws, id, tableId, dishIds),
  addConstraint: (id: string, a: string, b: string, note?: string) => (ws: Workspace) =>
    addConstraint(ws, id, a, b, note),
  removeConstraint: (id: string, constraintId: string) => (ws: Workspace) =>
    removeConstraint(ws, id, constraintId),
  arrangeBanquet: (id: string) => (ws: Workspace) => arrangeBanquet(ws, id),
  arrangeAll: () => (ws: Workspace) => arrangeAll(ws),
  confirm: (id: string) => (ws: Workspace) => confirmArrangement(ws, id),
  unconfirm: (id: string) => (ws: Workspace) => unconfirmArrangement(ws, id),
};

export const auditOf = (ws: Workspace): BanquetAudit[] => auditWorkspace(ws);
