import { describe, it, expect } from 'vitest';
import type {
  TravelProject,
  Member,
  ItineraryItem,
  BudgetSplit,
  PackingItem,
  TravelData,
} from '../types';
import {
  TravelDataValidationError,
  createEmptyTravelData,
  insertProject,
  removeProject,
  insertMember,
  updateMember,
  removeMember,
  insertItineraryItem,
  updateItineraryItem,
  insertBudgetSplit,
  updateBudgetSplit,
  insertPackingItem,
  updatePackingItem,
  loadTravelData,
  saveTravelData,
  type KeyValueStorage,
} from './travelData';

function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function makeProject(id: string): TravelProject {
  return {
    id,
    title: `Trip ${id}`,
    destination: 'Tokyo',
    startDate: '2026-05-01',
    endDate: '2026-05-07',
    coverImage: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeMember(id: string, projectId: string, role: Member['role'] = 'member'): Member {
  return { id, projectId, name: `Member ${id}`, avatar: '', role };
}

function makeItineraryItem(id: string, projectId: string, order: number): ItineraryItem {
  return {
    id,
    projectId,
    date: '2026-05-01',
    time: '09:00',
    location: `Spot ${id}`,
    description: '',
    budget: 100,
    order,
  };
}

function makeBudgetSplit(
  id: string,
  projectId: string,
  participantIds: string[],
  splitType: BudgetSplit['splitType'] = 'equal'
): BudgetSplit {
  return {
    id,
    projectId,
    description: `Expense ${id}`,
    totalAmount: 300,
    splitType,
    proportions: Object.fromEntries(participantIds.map((pid) => [pid, 1])),
    participantIds,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePackingItem(
  id: string,
  projectId: string,
  order: number,
  category: PackingItem['category'] = 'other'
): PackingItem {
  return {
    id,
    projectId,
    category,
    name: `Item ${id}`,
    isChecked: false,
    isCustom: true,
    order,
  };
}

function seedTwoProjects(): TravelData {
  let data = createEmptyTravelData();
  data = insertProject(data, makeProject('p1'));
  data = insertProject(data, makeProject('p2'));
  data = insertMember(data, makeMember('m1', 'p1', 'leader'));
  data = insertMember(data, makeMember('m2', 'p1'));
  data = insertMember(data, makeMember('m3', 'p2'));
  data = insertItineraryItem(data, makeItineraryItem('i1', 'p1', 1));
  data = insertItineraryItem(data, makeItineraryItem('i2', 'p2', 1));
  data = insertBudgetSplit(data, makeBudgetSplit('b1', 'p1', ['m1', 'm2']));
  data = insertBudgetSplit(data, makeBudgetSplit('b2', 'p2', ['m3']));
  data = insertPackingItem(data, makePackingItem('k1', 'p1', 1));
  data = insertPackingItem(data, makePackingItem('k2', 'p2', 1));
  return data;
}

describe('project deletion cascade', () => {
  it('removes members, itinerary, budget splits and packing items of the deleted project only', () => {
    const before = seedTwoProjects();
    const after = removeProject(before, 'p1');

    expect(after.projects.map((p) => p.id)).toEqual(['p2']);
    expect(after.members.map((m) => m.id)).toEqual(['m3']);
    expect(after.itineraryItems.map((i) => i.id)).toEqual(['i2']);
    expect(after.budgetSplits.map((b) => b.id)).toEqual(['b2']);
    expect(after.packingItems.map((k) => k.id)).toEqual(['k2']);

    for (const collection of [
      after.members,
      after.itineraryItems,
      after.budgetSplits,
      after.packingItems,
    ]) {
      expect(collection.every((record) => record.projectId === 'p2')).toBe(true);
    }
  });

  it('is a no-op for an unknown project id', () => {
    const before = seedTwoProjects();
    expect(removeProject(before, 'missing')).toEqual(before);
  });
});

describe('order field sorting', () => {
  it('keeps itinerary items sorted by order ascending regardless of insertion order', () => {
    let data = createEmptyTravelData();
    for (const order of [5, 1, 3, 2, 4]) {
      data = insertItineraryItem(data, makeItineraryItem(`i${order}`, 'p1', order));
    }
    expect(data.itineraryItems.map((i) => i.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('re-sorts itinerary items after an order update', () => {
    let data = createEmptyTravelData();
    data = insertItineraryItem(data, makeItineraryItem('a', 'p1', 1));
    data = insertItineraryItem(data, makeItineraryItem('b', 'p1', 2));
    data = insertItineraryItem(data, makeItineraryItem('c', 'p1', 3));
    data = updateItineraryItem(data, 'c', { order: 0 });
    expect(data.itineraryItems.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps packing items sorted by order ascending regardless of insertion order', () => {
    let data = createEmptyTravelData();
    for (const order of [4, 2, 5, 1, 3]) {
      data = insertPackingItem(data, makePackingItem(`k${order}`, 'p1', order));
    }
    expect(data.packingItems.map((k) => k.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('re-sorts packing items after an order update', () => {
    let data = createEmptyTravelData();
    data = insertPackingItem(data, makePackingItem('a', 'p1', 1));
    data = insertPackingItem(data, makePackingItem('b', 'p1', 2));
    data = updatePackingItem(data, 'a', { order: 10 });
    expect(data.packingItems.map((k) => k.id)).toEqual(['b', 'a']);
  });
});

describe('budget split participant references', () => {
  it('drops deleted members from participantIds and proportions', () => {
    let data = createEmptyTravelData();
    data = insertProject(data, makeProject('p1'));
    data = insertMember(data, makeMember('m1', 'p1', 'leader'));
    data = insertMember(data, makeMember('m2', 'p1'));
    data = insertBudgetSplit(data, makeBudgetSplit('b1', 'p1', ['m1', 'm2'], 'proportional'));

    const after = removeMember(data, 'm2');
    const split = after.budgetSplits.find((b) => b.id === 'b1')!;
    expect(split.participantIds).toEqual(['m1']);
    expect(Object.keys(split.proportions)).toEqual(['m1']);
  });

  it('does not touch splits of other projects', () => {
    let data = seedTwoProjects();
    data = removeMember(data, 'm2');
    const other = data.budgetSplits.find((b) => b.id === 'b2')!;
    expect(other.participantIds).toEqual(['m3']);
    expect(Object.keys(other.proportions)).toEqual(['m3']);
  });

  it('clears packing checkedBy when the checking member is deleted', () => {
    let data = createEmptyTravelData();
    data = insertProject(data, makeProject('p1'));
    data = insertMember(data, makeMember('m1', 'p1'));
    data = insertPackingItem(data, { ...makePackingItem('k1', 'p1', 1), checkedBy: 'm1' });
    const after = removeMember(data, 'm1');
    expect(after.packingItems[0].checkedBy).toBeUndefined();
  });
});

describe('constrained field validation', () => {
  it('rejects an invalid member role on insert and update', () => {
    const data = insertMember(createEmptyTravelData(), makeMember('m1', 'p1'));
    expect(() => insertMember(data, makeMember('m2', 'p1', 'boss' as Member['role']))).toThrow(
      TravelDataValidationError
    );
    expect(() => updateMember(data, 'm1', { role: 'boss' as Member['role'] })).toThrow(
      TravelDataValidationError
    );
    expect(data.members).toHaveLength(1);
    expect(data.members[0].role).toBe('member');
  });

  it('rejects an invalid split type on insert and update', () => {
    const data = insertBudgetSplit(
      createEmptyTravelData(),
      makeBudgetSplit('b1', 'p1', ['m1'])
    );
    expect(() =>
      insertBudgetSplit(data, makeBudgetSplit('b2', 'p1', ['m1'], 'random' as BudgetSplit['splitType']))
    ).toThrow(TravelDataValidationError);
    expect(() =>
      updateBudgetSplit(data, 'b1', { splitType: 'random' as BudgetSplit['splitType'] })
    ).toThrow(TravelDataValidationError);
    expect(data.budgetSplits).toHaveLength(1);
    expect(data.budgetSplits[0].splitType).toBe('equal');
  });

  it('rejects an invalid packing category on insert and update', () => {
    const data = insertPackingItem(createEmptyTravelData(), makePackingItem('k1', 'p1', 1));
    expect(() =>
      insertPackingItem(data, makePackingItem('k2', 'p1', 2, 'toys' as PackingItem['category']))
    ).toThrow(TravelDataValidationError);
    expect(() =>
      updatePackingItem(data, 'k1', { category: 'toys' as PackingItem['category'] })
    ).toThrow(TravelDataValidationError);
    expect(data.packingItems).toHaveLength(1);
    expect(data.packingItems[0].category).toBe('other');
  });
});

describe('determinism and storage round-trip', () => {
  function runScenario(): TravelData {
    let data = seedTwoProjects();
    data = updateItineraryItem(data, 'i1', { order: 7 });
    data = removeMember(data, 'm2');
    data = removeProject(data, 'p1');
    return data;
  }

  it('produces identical results when the same operations run repeatedly', () => {
    const first = runScenario();
    const second = runScenario();
    expect(second).toEqual(first);
  });

  it('round-trips data through an in-memory storage substitute', () => {
    const storage = createMemoryStorage();
    const data = runScenario();
    saveTravelData(storage, data);
    expect(loadTravelData(storage)).toEqual(data);
  });

  it('falls back to empty data when storage holds corrupt JSON', () => {
    const storage = createMemoryStorage();
    storage.setItem('travel_planner_data', '{not-json');
    expect(loadTravelData(storage)).toEqual(createEmptyTravelData());
  });
});
