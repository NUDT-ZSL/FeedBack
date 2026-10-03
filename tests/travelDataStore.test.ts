import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TravelDataStore,
  MemoryStorage,
  TravelDataValidationError,
  PACKING_CATEGORIES,
} from '../src/lib/travelDataStore.ts';
import type { TravelData } from '../src/types/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';

function createTestStore(storage?: MemoryStorage): TravelDataStore {
  let counter = 0;
  return new TravelDataStore({
    storage: storage ?? new MemoryStorage(),
    createId: () => `id-${String(++counter).padStart(4, '0')}`,
    now: () => FIXED_NOW,
  });
}

function seedTwoProjects(store: TravelDataStore) {
  const projectA = store.addProject({
    title: 'Trip A',
    destination: 'Kyoto',
    startDate: '2026-05-01',
    endDate: '2026-05-07',
    coverImage: 'a.png',
  });
  const projectB = store.addProject({
    title: 'Trip B',
    destination: 'Oslo',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    coverImage: 'b.png',
  });
  const memberA1 = store.addMember({
    projectId: projectA.id,
    name: 'Alice',
    avatar: 'alice.png',
    role: 'leader',
  });
  const memberA2 = store.addMember({
    projectId: projectA.id,
    name: 'Bob',
    avatar: 'bob.png',
    role: 'finance',
  });
  const memberB1 = store.addMember({
    projectId: projectB.id,
    name: 'Carol',
    avatar: 'carol.png',
    role: 'member',
  });
  store.addItineraryItem({
    projectId: projectA.id,
    date: '2026-05-02',
    time: '09:00',
    location: 'Kiyomizu',
    description: 'Temple visit',
    budget: 100,
    order: 2,
  });
  store.addItineraryItem({
    projectId: projectB.id,
    date: '2026-06-02',
    time: '10:00',
    location: 'Fjord',
    description: 'Boat tour',
    budget: 200,
    order: 1,
  });
  const splitA = store.addBudgetSplit({
    projectId: projectA.id,
    description: 'Hotel A',
    totalAmount: 300,
    splitType: 'proportional',
    proportions: { [memberA1.id]: 0.6, [memberA2.id]: 0.4 },
    participantIds: [memberA1.id, memberA2.id],
  });
  store.addBudgetSplit({
    projectId: projectB.id,
    description: 'Hotel B',
    totalAmount: 500,
    splitType: 'equal',
    proportions: {},
    participantIds: [memberB1.id],
  });
  store.addPackingItem({
    projectId: projectA.id,
    category: 'documents',
    name: 'Passport',
    isChecked: false,
    isCustom: false,
    order: 3,
  });
  store.addPackingItem({
    projectId: projectB.id,
    category: 'clothing',
    name: 'Jacket',
    isChecked: false,
    isCustom: true,
    order: 1,
  });
  return { projectA, projectB, memberA1, memberA2, memberB1, splitA };
}

test('deleting a project cascade-removes its members, itinerary, splits and packing items', () => {
  const storage = new MemoryStorage();
  const store = createTestStore(storage);
  const { projectA, projectB } = seedTwoProjects(store);

  store.deleteProject(projectA.id);

  const data = store.getData();
  assert.deepEqual(
    data.projects.map((p) => p.id),
    [projectB.id],
  );
  for (const key of [
    'members',
    'itineraryItems',
    'budgetSplits',
    'packingItems',
  ] as const) {
    const remaining = data[key] as Array<{ projectId: string }>;
    assert.ok(remaining.length > 0, `${key} should still hold project B records`);
    assert.ok(
      remaining.every((record) => record.projectId === projectB.id),
      `${key} must not contain records of the deleted project`,
    );
  }

  // A fresh store reading the same storage must observe the same result.
  const reloaded = createTestStore(storage);
  reloaded.load();
  assert.deepEqual(reloaded.getData(), data);
});

test('itinerary and packing items are always read back ordered by the order field', () => {
  const storage = new MemoryStorage();
  const store = createTestStore(storage);
  const project = store.addProject({
    title: 'Sorted',
    destination: 'Rome',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    coverImage: 'c.png',
  });

  // Insert in scrambled order.
  const orders = [5, 1, 3, 2, 4];
  const itineraryIds: string[] = [];
  for (const order of orders) {
    const item = store.addItineraryItem({
      projectId: project.id,
      date: '2026-07-01',
      time: '08:00',
      location: `Stop ${order}`,
      description: '',
      budget: 0,
      order,
    });
    itineraryIds.push(item.id);
  }
  const packingIds: string[] = [];
  for (const order of orders) {
    const item = store.addPackingItem({
      projectId: project.id,
      category: 'other',
      name: `Item ${order}`,
      isChecked: false,
      isCustom: true,
      order,
    });
    packingIds.push(item.id);
  }

  const ascending = [1, 2, 3, 4, 5];
  assert.deepEqual(
    store.getData().itineraryItems.map((i) => i.order),
    ascending,
  );
  assert.deepEqual(
    store.getData().packingItems.map((i) => i.order),
    ascending,
  );

  // Updating the order field re-sorts immediately.
  store.updateItineraryItem(itineraryIds[1], { order: 10 });
  store.updatePackingItem(packingIds[1], { order: 0 });
  assert.deepEqual(
    store.getData().itineraryItems.map((i) => i.order),
    [2, 3, 4, 5, 10],
  );
  assert.deepEqual(
    store.getData().packingItems.map((i) => i.order),
    [0, 2, 3, 4, 5],
  );

  // Order survives a storage round-trip even if the stored payload is scrambled.
  const scrambled = store.getData();
  scrambled.itineraryItems.reverse();
  scrambled.packingItems.reverse();
  storage.setItem('travel_planner_data', JSON.stringify(scrambled));
  const reloaded = createTestStore(storage);
  reloaded.load();
  assert.deepEqual(
    reloaded.getData().itineraryItems.map((i) => i.order),
    [2, 3, 4, 5, 10],
  );
  assert.deepEqual(
    reloaded.getData().packingItems.map((i) => i.order),
    [0, 2, 3, 4, 5],
  );
});

test('deleting a member removes dangling references from budget splits', () => {
  const storage = new MemoryStorage();
  const store = createTestStore(storage);
  const { memberA1, memberA2, splitA } = seedTwoProjects(store);

  store.deleteMember(memberA1.id);

  const split = store.getData().budgetSplits.find((s) => s.id === splitA.id)!;
  assert.deepEqual(split.participantIds, [memberA2.id]);
  assert.deepEqual(split.proportions, { [memberA2.id]: 0.4 });
  assert.ok(
    !JSON.stringify(split).includes(memberA1.id),
    'split must not retain the deleted member id',
  );

  // Persisted state reflects the cleanup as well.
  const reloaded = createTestStore(storage);
  reloaded.load();
  const persistedSplit = reloaded
    .getData()
    .budgetSplits.find((s) => s.id === splitA.id)!;
  assert.deepEqual(persistedSplit.participantIds, [memberA2.id]);
  assert.deepEqual(persistedSplit.proportions, { [memberA2.id]: 0.4 });
});

test('invalid constrained values are rejected instead of silently accepted', () => {
  const store = createTestStore();
  const { memberA2, splitA } = seedTwoProjects(store);
  const packingItem = store.getData().packingItems[0];
  const before = store.getData();

  const expectRejected = (field: string, fn: () => void) => {
    assert.throws(fn, (error: unknown) => {
      assert.ok(error instanceof TravelDataValidationError);
      assert.equal((error as TravelDataValidationError).field, field);
      return true;
    });
  };

  expectRejected('role', () =>
    store.addMember({
      projectId: 'p',
      name: 'Eve',
      avatar: '',
      role: 'boss' as never,
    }),
  );
  expectRejected('role', () => store.updateMember(memberA2.id, { role: 'boss' as never }));
  expectRejected('splitType', () =>
    store.addBudgetSplit({
      projectId: 'p',
      description: 'x',
      totalAmount: 1,
      splitType: 'random' as never,
      proportions: {},
      participantIds: [],
    }),
  );
  expectRejected('splitType', () =>
    store.updateBudgetSplit(splitA.id, { splitType: 'random' as never }),
  );
  expectRejected('category', () =>
    store.addPackingItem({
      projectId: 'p',
      category: 'furniture' as never,
      name: 'Sofa',
      isChecked: false,
      isCustom: true,
      order: 9,
    }),
  );
  expectRejected('category', () =>
    store.updatePackingItem(packingItem.id, { category: 'furniture' as never }),
  );

  // Failed writes must not corrupt the dataset.
  assert.deepEqual(store.getData(), before);

  // Loading a stored payload containing illegal values must fail loudly.
  const corruptedStorage = new MemoryStorage();
  corruptedStorage.setItem(
    'travel_planner_data',
    JSON.stringify({
      ...before,
      members: [{ ...before.members[0], role: 'overlord' }],
    }),
  );
  const corruptedStore = createTestStore(corruptedStorage);
  assert.throws(() => corruptedStore.load(), TravelDataValidationError);

  // Every legal enum value round-trips without rejection.
  const legalStore = createTestStore();
  const legalProject = legalStore.addProject({
    title: 'Legal',
    destination: 'Lima',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    coverImage: '',
  });
  for (const role of ['leader', 'finance', 'member'] as const) {
    legalStore.addMember({ projectId: legalProject.id, name: role, avatar: '', role });
  }
  for (const splitType of ['equal', 'proportional'] as const) {
    legalStore.addBudgetSplit({
      projectId: legalProject.id,
      description: splitType,
      totalAmount: 10,
      splitType,
      proportions: {},
      participantIds: [],
    });
  }
  PACKING_CATEGORIES.forEach((category, index) => {
    legalStore.addPackingItem({
      projectId: legalProject.id,
      category,
      name: category,
      isChecked: false,
      isCustom: true,
      order: index,
    });
  });
  assert.equal(legalStore.getData().packingItems.length, PACKING_CATEGORIES.length);
});

test('repeating the same operation batch yields identical results', () => {
  const runBatch = (): TravelData => {
    const store = createTestStore();
    const { projectA, projectB, memberA1, memberA2, memberB1, splitA } =
      seedTwoProjects(store);
    store.updateItineraryItem(
      store.getData().itineraryItems.find((i) => i.projectId === projectA.id)!.id,
      { order: 0 },
    );
    store.deleteMember(memberA1.id);
    store.updateBudgetSplit(splitA.id, { totalAmount: 350 });
    store.deleteProject(projectB.id);
    store.addMember({
      projectId: projectA.id,
      name: 'Dave',
      avatar: 'dave.png',
      role: 'member',
    });
    void memberA2;
    void memberB1;
    return store.getData();
  };

  const first = runBatch();
  const second = runBatch();
  assert.deepEqual(first, second);

  // Interleaving writes across collections does not break invariants.
  const store = createTestStore();
  const { projectA, memberA2 } = seedTwoProjects(store);
  const extraMember = store.addMember({
    projectId: projectA.id,
    name: 'Frank',
    avatar: '',
    role: 'member',
  });
  const extraSplit = store.addBudgetSplit({
    projectId: projectA.id,
    description: 'Dinner',
    totalAmount: 90,
    splitType: 'equal',
    proportions: {},
    participantIds: [memberA2.id, extraMember.id],
  });
  store.addItineraryItem({
    projectId: projectA.id,
    date: '2026-05-03',
    time: '07:00',
    location: 'Market',
    description: '',
    budget: 20,
    order: 1,
  });
  store.deleteMember(extraMember.id);

  const data = store.getData();
  const orders = data.itineraryItems.map((i) => i.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  const split = data.budgetSplits.find((s) => s.id === extraSplit.id)!;
  assert.deepEqual(split.participantIds, [memberA2.id]);
  const memberIds = new Set(data.members.map((m) => m.id));
  for (const s of data.budgetSplits) {
    for (const pid of s.participantIds) {
      assert.ok(memberIds.has(pid), `dangling participant ${pid}`);
    }
  }
});
