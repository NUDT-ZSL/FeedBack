import type {
  TravelProject,
  Member,
  MemberRole,
  ItineraryItem,
  BudgetSplit,
  SplitType,
  PackingItem,
  PackingCategory,
  TravelData,
} from '../types';

export const STORAGE_KEY = 'travel_planner_data';

export const MEMBER_ROLES: readonly MemberRole[] = ['leader', 'finance', 'member'];
export const SPLIT_TYPES: readonly SplitType[] = ['equal', 'proportional'];
export const PACKING_CATEGORIES: readonly PackingCategory[] = [
  'documents',
  'clothing',
  'medicine',
  'electronics',
  'toiletries',
  'other',
];

export class TravelDataValidationError extends Error {
  readonly field: string;
  readonly value: unknown;

  constructor(field: string, value: unknown) {
    super(`Invalid value for ${field}: ${JSON.stringify(value)}`);
    this.name = 'TravelDataValidationError';
    this.field = field;
    this.value = value;
  }
}

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}

export function isSplitType(value: unknown): value is SplitType {
  return typeof value === 'string' && (SPLIT_TYPES as readonly string[]).includes(value);
}

export function isPackingCategory(value: unknown): value is PackingCategory {
  return typeof value === 'string' && (PACKING_CATEGORIES as readonly string[]).includes(value);
}

function assertMemberRole(value: unknown): asserts value is MemberRole {
  if (!isMemberRole(value)) {
    throw new TravelDataValidationError('member.role', value);
  }
}

function assertSplitType(value: unknown): asserts value is SplitType {
  if (!isSplitType(value)) {
    throw new TravelDataValidationError('budgetSplit.splitType', value);
  }
}

function assertPackingCategory(value: unknown): asserts value is PackingCategory {
  if (!isPackingCategory(value)) {
    throw new TravelDataValidationError('packingItem.category', value);
  }
}

export function createEmptyTravelData(): TravelData {
  return {
    projects: [],
    members: [],
    itineraryItems: [],
    budgetSplits: [],
    packingItems: [],
  };
}

const byOrderAsc = <T extends { order: number }>(a: T, b: T): number => a.order - b.order;

export function insertProject(data: TravelData, project: TravelProject): TravelData {
  return { ...data, projects: [...data.projects, project] };
}

export function updateProject(
  data: TravelData,
  id: string,
  updates: Partial<TravelProject>
): TravelData {
  return {
    ...data,
    projects: data.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
  };
}

export function removeProject(data: TravelData, id: string): TravelData {
  return {
    ...data,
    projects: data.projects.filter((p) => p.id !== id),
    members: data.members.filter((m) => m.projectId !== id),
    itineraryItems: data.itineraryItems.filter((i) => i.projectId !== id),
    budgetSplits: data.budgetSplits.filter((b) => b.projectId !== id),
    packingItems: data.packingItems.filter((p) => p.projectId !== id),
  };
}

export function insertMember(data: TravelData, member: Member): TravelData {
  assertMemberRole(member.role);
  return { ...data, members: [...data.members, member] };
}

export function updateMember(
  data: TravelData,
  id: string,
  updates: Partial<Member>
): TravelData {
  if (updates.role !== undefined) {
    assertMemberRole(updates.role);
  }
  return {
    ...data,
    members: data.members.map((m) => (m.id === id ? { ...m, ...updates } : m)),
  };
}

export function removeMember(data: TravelData, id: string): TravelData {
  const removed = data.members.find((m) => m.id === id);
  const next: TravelData = {
    ...data,
    members: data.members.filter((m) => m.id !== id),
  };
  if (!removed) {
    return next;
  }
  return {
    ...next,
    budgetSplits: next.budgetSplits.map((split) => {
      if (split.projectId !== removed.projectId) {
        return split;
      }
      if (!split.participantIds.includes(id) && !(id in split.proportions)) {
        return split;
      }
      const proportions = { ...split.proportions };
      delete proportions[id];
      return {
        ...split,
        participantIds: split.participantIds.filter((pid) => pid !== id),
        proportions,
      };
    }),
    packingItems: next.packingItems.map((item) =>
      item.projectId === removed.projectId && item.checkedBy === id
        ? { ...item, checkedBy: undefined }
        : item
    ),
  };
}

export function insertItineraryItem(data: TravelData, item: ItineraryItem): TravelData {
  return {
    ...data,
    itineraryItems: [...data.itineraryItems, item].sort(byOrderAsc),
  };
}

export function updateItineraryItem(
  data: TravelData,
  id: string,
  updates: Partial<ItineraryItem>
): TravelData {
  return {
    ...data,
    itineraryItems: data.itineraryItems
      .map((i) => (i.id === id ? { ...i, ...updates } : i))
      .sort(byOrderAsc),
  };
}

export function removeItineraryItem(data: TravelData, id: string): TravelData {
  return {
    ...data,
    itineraryItems: data.itineraryItems.filter((i) => i.id !== id),
  };
}

export function insertBudgetSplit(data: TravelData, split: BudgetSplit): TravelData {
  assertSplitType(split.splitType);
  return { ...data, budgetSplits: [...data.budgetSplits, split] };
}

export function updateBudgetSplit(
  data: TravelData,
  id: string,
  updates: Partial<BudgetSplit>
): TravelData {
  if (updates.splitType !== undefined) {
    assertSplitType(updates.splitType);
  }
  return {
    ...data,
    budgetSplits: data.budgetSplits.map((b) => (b.id === id ? { ...b, ...updates } : b)),
  };
}

export function removeBudgetSplit(data: TravelData, id: string): TravelData {
  return {
    ...data,
    budgetSplits: data.budgetSplits.filter((b) => b.id !== id),
  };
}

export function insertPackingItem(data: TravelData, item: PackingItem): TravelData {
  assertPackingCategory(item.category);
  return {
    ...data,
    packingItems: [...data.packingItems, item].sort(byOrderAsc),
  };
}

export function updatePackingItem(
  data: TravelData,
  id: string,
  updates: Partial<PackingItem>
): TravelData {
  if (updates.category !== undefined) {
    assertPackingCategory(updates.category);
  }
  return {
    ...data,
    packingItems: data.packingItems
      .map((p) => (p.id === id ? { ...p, ...updates } : p))
      .sort(byOrderAsc),
  };
}

export function removePackingItem(data: TravelData, id: string): TravelData {
  return {
    ...data,
    packingItems: data.packingItems.filter((p) => p.id !== id),
  };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadTravelData(
  storage: KeyValueStorage,
  key: string = STORAGE_KEY
): TravelData {
  try {
    const stored = storage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as TravelData;
    }
  } catch (error) {
    console.error('Failed to load data from storage:', error);
  }
  return createEmptyTravelData();
}

export function saveTravelData(
  storage: KeyValueStorage,
  data: TravelData,
  key: string = STORAGE_KEY
): void {
  storage.setItem(key, JSON.stringify(data));
}
