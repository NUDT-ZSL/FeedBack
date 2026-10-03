import type {
  TravelData,
  TravelProject,
  Member,
  ItineraryItem,
  BudgetSplit,
  PackingItem,
  MemberRole,
  SplitType,
  PackingCategory,
} from '../types';

export const DEFAULT_STORAGE_KEY = 'travel_planner_data';

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

export function createEmptyTravelData(): TravelData {
  return {
    projects: [],
    members: [],
    itineraryItems: [],
    budgetSplits: [],
    packingItems: [],
  };
}

/** Minimal key-value storage surface shared by localStorage and test doubles. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory KeyValueStorage implementation for offline tests. */
export class MemoryStorage implements KeyValueStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}

/** Thrown when a write attempts an out-of-domain value for a constrained field. */
export class TravelDataValidationError extends Error {
  readonly field: string;
  readonly value: unknown;
  readonly allowed: readonly unknown[];

  constructor(field: string, value: unknown, allowed: readonly unknown[]) {
    super(
      `Invalid value for "${field}": ${String(value)} (allowed: ${allowed.join(', ')})`,
    );
    this.name = 'TravelDataValidationError';
    this.field = field;
    this.value = value;
    this.allowed = allowed;
  }
}

function assertEnum<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TravelDataValidationError(field, value, allowed);
  }
}

export interface TravelDataStoreOptions {
  storage?: KeyValueStorage;
  storageKey?: string;
  createId?: () => string;
  now?: () => string;
}

type Orderable = { order: number };

export class TravelDataStore {
  private data: TravelData;
  private readonly storage: KeyValueStorage | null;
  private readonly storageKey: string;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(options: TravelDataStoreOptions = {}) {
    this.storage = options.storage ?? null;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.data = createEmptyTravelData();
  }

  /**
   * Loads data from backing storage. Throws TravelDataValidationError when the
   * stored payload contains illegal constrained values instead of silently
   * accepting them; resets to an empty dataset on unrecoverable parse errors.
   */
  load(): TravelData {
    if (!this.storage) {
      return this.getData();
    }
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) {
      return this.getData();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('Failed to parse stored travel data:', error);
      this.data = createEmptyTravelData();
      return this.getData();
    }
    this.data = this.normalize(this.validateShape(parsed));
    return this.getData();
  }

  /** Replaces the whole dataset (validated + normalized + persisted). */
  replaceData(candidate: unknown): TravelData {
    this.data = this.normalize(this.validateShape(candidate));
    this.persist();
    return this.getData();
  }

  /** Returns a detached snapshot of the current dataset. */
  getData(): TravelData {
    return this.cloneData(this.data);
  }

  // ---- projects ---------------------------------------------------------

  addProject(project: Omit<TravelProject, 'id' | 'createdAt'>): TravelProject {
    const newProject: TravelProject = {
      ...project,
      id: this.createId(),
      createdAt: this.now(),
    };
    this.commit((draft) => {
      draft.projects = [...draft.projects, newProject];
    });
    return newProject;
  }

  updateProject(id: string, updates: Partial<TravelProject>): void {
    this.commit((draft) => {
      draft.projects = draft.projects.map((project) =>
        project.id === id
          ? { ...project, ...stripIdentity(updates), id }
          : project,
      );
    });
  }

  /** Cascade-deletes every record belonging to the project. */
  deleteProject(id: string): void {
    this.commit((draft) => {
      draft.projects = draft.projects.filter((project) => project.id !== id);
      draft.members = draft.members.filter((member) => member.projectId !== id);
      draft.itineraryItems = draft.itineraryItems.filter(
        (item) => item.projectId !== id,
      );
      draft.budgetSplits = draft.budgetSplits.filter(
        (split) => split.projectId !== id,
      );
      draft.packingItems = draft.packingItems.filter(
        (item) => item.projectId !== id,
      );
    });
  }

  // ---- members ----------------------------------------------------------

  addMember(member: Omit<Member, 'id'>): Member {
    assertEnum('role', member.role, MEMBER_ROLES);
    const newMember: Member = { ...member, id: this.createId() };
    this.commit((draft) => {
      draft.members = [...draft.members, newMember];
    });
    return newMember;
  }

  updateMember(id: string, updates: Partial<Member>): void {
    if (updates.role !== undefined) {
      assertEnum('role', updates.role, MEMBER_ROLES);
    }
    this.commit((draft) => {
      draft.members = draft.members.map((member) =>
        member.id === id
          ? { ...member, ...stripIdentity(updates), id }
          : member,
      );
    });
  }

  /**
   * Deletes the member and removes every dangling reference:
   * the id disappears from split participantIds/proportions and
   * packing items checked by that member are un-checked.
   */
  deleteMember(id: string): void {
    this.commit((draft) => {
      draft.members = draft.members.filter((member) => member.id !== id);
      draft.budgetSplits = draft.budgetSplits.map((split) => {
        if (
          !split.participantIds.includes(id) &&
          !Object.prototype.hasOwnProperty.call(split.proportions, id)
        ) {
          return split;
        }
        const proportions: Record<string, number> = {};
        for (const key of Object.keys(split.proportions)) {
          if (key !== id) {
            proportions[key] = split.proportions[key];
          }
        }
        return {
          ...split,
          participantIds: split.participantIds.filter((pid) => pid !== id),
          proportions,
        };
      });
      draft.packingItems = draft.packingItems.map((item) =>
        item.checkedBy === id
          ? { ...item, isChecked: false, checkedBy: undefined }
          : item,
      );
    });
  }

  // ---- itinerary --------------------------------------------------------

  addItineraryItem(item: Omit<ItineraryItem, 'id'>): ItineraryItem {
    const newItem: ItineraryItem = { ...item, id: this.createId() };
    this.commit((draft) => {
      draft.itineraryItems = [...draft.itineraryItems, newItem];
    });
    return newItem;
  }

  updateItineraryItem(id: string, updates: Partial<ItineraryItem>): void {
    this.commit((draft) => {
      draft.itineraryItems = draft.itineraryItems.map((item) =>
        item.id === id ? { ...item, ...stripIdentity(updates), id } : item,
      );
    });
  }

  deleteItineraryItem(id: string): void {
    this.commit((draft) => {
      draft.itineraryItems = draft.itineraryItems.filter((item) => item.id !== id);
    });
  }

  // ---- budget splits ----------------------------------------------------

  addBudgetSplit(split: Omit<BudgetSplit, 'id' | 'createdAt'>): BudgetSplit {
    assertEnum('splitType', split.splitType, SPLIT_TYPES);
    const newSplit: BudgetSplit = {
      ...split,
      id: this.createId(),
      createdAt: this.now(),
    };
    this.commit((draft) => {
      draft.budgetSplits = [...draft.budgetSplits, newSplit];
    });
    return newSplit;
  }

  updateBudgetSplit(id: string, updates: Partial<BudgetSplit>): void {
    if (updates.splitType !== undefined) {
      assertEnum('splitType', updates.splitType, SPLIT_TYPES);
    }
    this.commit((draft) => {
      draft.budgetSplits = draft.budgetSplits.map((split) =>
        split.id === id ? { ...split, ...stripIdentity(updates), id } : split,
      );
    });
  }

  deleteBudgetSplit(id: string): void {
    this.commit((draft) => {
      draft.budgetSplits = draft.budgetSplits.filter((split) => split.id !== id);
    });
  }

  // ---- packing items ----------------------------------------------------

  addPackingItem(item: Omit<PackingItem, 'id'>): PackingItem {
    assertEnum('category', item.category, PACKING_CATEGORIES);
    const newItem: PackingItem = { ...item, id: this.createId() };
    this.commit((draft) => {
      draft.packingItems = [...draft.packingItems, newItem];
    });
    return newItem;
  }

  updatePackingItem(id: string, updates: Partial<PackingItem>): void {
    if (updates.category !== undefined) {
      assertEnum('category', updates.category, PACKING_CATEGORIES);
    }
    this.commit((draft) => {
      draft.packingItems = draft.packingItems.map((item) =>
        item.id === id ? { ...item, ...stripIdentity(updates), id } : item,
      );
    });
  }

  deletePackingItem(id: string): void {
    this.commit((draft) => {
      draft.packingItems = draft.packingItems.filter((item) => item.id !== id);
    });
  }

  // ---- internals --------------------------------------------------------

  private commit(mutate: (draft: TravelData) => void): void {
    const next = this.cloneData(this.data);
    mutate(next);
    this.data = this.normalize(next);
    this.persist();
  }

  private persist(): void {
    if (this.storage) {
      this.storage.setItem(this.storageKey, JSON.stringify(this.data));
    }
  }

  private normalize(data: TravelData): TravelData {
    data.itineraryItems = sortByOrder(data.itineraryItems);
    data.packingItems = sortByOrder(data.packingItems);
    return data;
  }

  private cloneData(data: TravelData): TravelData {
    return {
      projects: data.projects.map((project) => ({ ...project })),
      members: data.members.map((member) => ({ ...member })),
      itineraryItems: data.itineraryItems.map((item) => ({ ...item })),
      budgetSplits: data.budgetSplits.map((split) => ({
        ...split,
        participantIds: [...split.participantIds],
        proportions: { ...split.proportions },
      })),
      packingItems: data.packingItems.map((item) => ({ ...item })),
    };
  }

  private validateShape(candidate: unknown): TravelData {
    if (candidate === null || typeof candidate !== 'object') {
      throw new TravelDataValidationError('data', candidate, ['TravelData object']);
    }
    const value = candidate as Partial<Record<keyof TravelData, unknown>>;
    const collections: Array<keyof TravelData> = [
      'projects',
      'members',
      'itineraryItems',
      'budgetSplits',
      'packingItems',
    ];
    for (const key of collections) {
      const list = value[key];
      if (!Array.isArray(list)) {
        throw new TravelDataValidationError(key, list, ['array']);
      }
    }
    for (const member of value.members as Array<Record<string, unknown>>) {
      assertEnum('role', member.role, MEMBER_ROLES);
    }
    for (const split of value.budgetSplits as Array<Record<string, unknown>>) {
      assertEnum('splitType', split.splitType, SPLIT_TYPES);
    }
    for (const item of value.packingItems as Array<Record<string, unknown>>) {
      assertEnum('category', item.category, PACKING_CATEGORIES);
    }
    return {
      projects: value.projects as TravelProject[],
      members: value.members as Member[],
      itineraryItems: value.itineraryItems as ItineraryItem[],
      budgetSplits: value.budgetSplits as BudgetSplit[],
      packingItems: value.packingItems as PackingItem[],
    };
  }
}

function sortByOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

function stripIdentity<T extends { id?: string }>(updates: Partial<T>): Partial<T> {
  const rest = { ...updates };
  delete rest.id;
  return rest;
}
