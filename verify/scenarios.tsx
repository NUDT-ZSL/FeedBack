import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { __resetUuid } from './uuidMock';
import { useTravelData as newHook } from '../src/hooks/useTravelData';
import { useTravelData as oldHook } from './useTravelData.original';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mount(hookFn: () => any) {
  let latest: any;
  function Harness() {
    latest = hookFn();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  return {
    get api() {
      return latest;
    },
    async flush(ms = 40) {
      await act(async () => {
        await sleep(ms);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

function normalize(value: any): any {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, any>>((acc, key) => {
        acc[key] = key === 'createdAt' ? 'TS' : normalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

const projectA = {
  title: 'Trip A',
  destination: 'Tokyo',
  startDate: '2026-01-01',
  endDate: '2026-01-05',
  coverImage: 'a',
};
const projectB = {
  title: 'Trip B',
  destination: 'Kyoto',
  startDate: '2026-02-01',
  endDate: '2026-02-03',
  coverImage: 'b',
};

async function exercise(hookFn: () => any) {
  localStorage.clear();
  const m = mount(hookFn);
  await m.flush();
  __resetUuid();
  const a = m.api.addProject(projectA);
  const b = m.api.addProject(projectB);
  const memberB = m.api.addMember({ projectId: b.id, name: 'Bob', avatar: '', role: 'member' });
  const memberA1 = m.api.addMember({ projectId: a.id, name: 'Alice', avatar: '', role: 'leader' });
  const memberA2 = m.api.addMember({ projectId: a.id, name: 'Carol', avatar: '', role: 'finance' });
  const itinB = m.api.addItineraryItem({ projectId: b.id, date: '2026-02-01', time: '09:00', location: 'L2', description: 'd', budget: 10, order: 5 });
  const itinA2 = m.api.addItineraryItem({ projectId: a.id, date: '2026-01-02', time: '10:00', location: 'L1', description: 'd', budget: 20, order: 3 });
  const itinA1 = m.api.addItineraryItem({ projectId: a.id, date: '2026-01-01', time: '08:00', location: 'L0', description: 'd', budget: 5, order: 1 });
  m.api.addBudgetSplit({ projectId: a.id, description: 'split A', totalAmount: 90, splitType: 'equal', proportions: {}, participantIds: [memberA1.id] });
  const splitB = m.api.addBudgetSplit({ projectId: b.id, description: 'split B', totalAmount: 40, splitType: 'equal', proportions: {}, participantIds: [memberB.id] });
  const packB = m.api.addPackingItem({ projectId: b.id, category: 'other', name: 'charger', isChecked: false, isCustom: false, order: 2 });
  m.api.addPackingItem({ projectId: a.id, category: 'clothing', name: 'coat', isChecked: false, isCustom: true, order: 2 });
  const packA1 = m.api.addPackingItem({ projectId: a.id, category: 'documents', name: 'passport', isChecked: false, isCustom: false, order: 1 });

  // updates/updates against non-existent ids must be silent no-ops
  act(() => {
    m.api.updateProject('missing', { title: 'X' });
    m.api.deleteProject('missing');
    m.api.updateMember('missing', { name: 'X' });
    m.api.deleteMember('missing');
    m.api.updateItineraryItem('missing', { location: 'X' });
    m.api.deleteItineraryItem('missing');
    m.api.updateBudgetSplit('missing', { totalAmount: 1 });
    m.api.deleteBudgetSplit('missing');
    m.api.updatePackingItem('missing', { isChecked: true });
    m.api.deletePackingItem('missing');
  });

  const beforeDelete = normalize(m.api.data);
  // sorted itinerary for project A
  const aItin = m.api.data.itineraryItems.filter((i: any) => i.projectId === a.id).map((i: any) => i.order);
  const aPack = m.api.data.packingItems.filter((p: any) => p.projectId === a.id).map((p: any) => p.order);

  act(() => m.api.deleteProject(a.id));
  // operations on cascade-deleted entities: no throw, no side effects
  act(() => {
    m.api.updateMember(memberA1.id, { name: 'Ghost' });
    m.api.deleteMember(memberA2.id);
    m.api.updateItineraryItem(itinA1.id, { order: 99 });
    m.api.deleteItineraryItem(itinA2.id);
    m.api.deletePackingItem(packA1.id);
  });
  act(() => m.api.deleteProject(a.id)); // already deleted

  const afterDelete = normalize(m.api.data);
  const survivors = {
    projects: m.api.data.projects.map((p: any) => p.id),
    members: m.api.data.members.map((x: any) => x.id),
    itineraries: m.api.data.itineraryItems.map((x: any) => x.id),
    splits: m.api.data.budgetSplits.map((x: any) => x.id),
    packs: m.api.data.packingItems.map((x: any) => x.id),
  };

  await m.flush(400); // let debounced persistence run
  const storedRaw = localStorage.getItem('travel_planner_data')!;
  const stored = normalize(JSON.parse(storedRaw));

  // refresh: unmount and reload from storage
  m.unmount();
  const m2 = mount(hookFn);
  await m2.flush();
  const reloaded = normalize(m2.api.data);
  m2.unmount();

  return { beforeDelete, aItin, aPack, afterDelete, survivors, stored, reloaded, survivorIds: { itinB: itinB.id, splitB: splitB.id, packB: packB.id, memberB: memberB.id, b: b.id } };
}

async function malformedStorageCheck(): Promise<string[]> {
  const errs: string[] = [];
  localStorage.clear();
  localStorage.setItem(
    'travel_planner_data',
    JSON.stringify({
      projects: [{ id: 'p0', title: 'kept' }],
      members: 'not-an-array',
      itineraryItems: [{ id: 'i0', projectId: 'p0', order: 1 }],
      packingItems: null,
      // budgetSplits intentionally missing
    })
  );
  const m = mount(newHook);
  await m.flush();
  const d = m.api.data;
  if (d.projects.length !== 1 || d.projects[0].id !== 'p0') errs.push('valid projects lost when other fields malformed');
  if (!Array.isArray(d.members) || d.members.length !== 0) errs.push('malformed members not normalized to []');
  if (d.itineraryItems.length !== 1 || d.itineraryItems[0].id !== 'i0') errs.push('valid itinerary items lost');
  if (!Array.isArray(d.budgetSplits) || d.budgetSplits.length !== 0) errs.push('missing budgetSplits not normalized to []');
  if (!Array.isArray(d.packingItems) || d.packingItems.length !== 0) errs.push('null packingItems not normalized to []');

  // corrupt / non-JSON storage must not throw and must yield empty data
  localStorage.setItem('travel_planner_data', '{not json');
  m.unmount();
  const m2 = mount(newHook);
  await m2.flush();
  const d2 = m2.api.data;
  const allEmpty = Object.values(d2).every((v) => Array.isArray(v) && v.length === 0);
  if (!allEmpty) errs.push('corrupt storage did not fall back to empty initial data');
  m2.unmount();
  return errs;
}

export async function run(): Promise<boolean> {
  const malformedErrs = await malformedStorageCheck();

  __resetUuid();
  const oldResult = await exercise(oldHook);
  __resetUuid();
  const newResult = await exercise(newHook);

  const errs = [...malformedErrs];
  const check = (label: string, condition: boolean) => {
    if (!condition) errs.push(`${label} differs between original and refactored implementation`);
  };

  check('state before delete', JSON.stringify(oldResult.beforeDelete) === JSON.stringify(newResult.beforeDelete));
  check('itinerary ordering', JSON.stringify(oldResult.aItin) === JSON.stringify(newResult.aItin));
  check('packing ordering', JSON.stringify(oldResult.aPack) === JSON.stringify(newResult.aPack));
  check('state after cascade delete', JSON.stringify(oldResult.afterDelete) === JSON.stringify(newResult.afterDelete));
  check('survivor ids', JSON.stringify(oldResult.survivors) === JSON.stringify(newResult.survivors));
  check('persisted localStorage snapshot', JSON.stringify(oldResult.stored) === JSON.stringify(newResult.stored));
  check('reloaded after refresh', JSON.stringify(oldResult.reloaded) === JSON.stringify(newResult.reloaded));

  // cascade correctness for the new implementation
  const r = newResult;
  const cascadeOk =
    r.survivors.projects.length === 1 &&
    r.survivors.projects[0] === r.survivorIds.b &&
    r.survivors.members.includes(r.survivorIds.memberB) &&
    !r.survivors.members.includes(r.survivorIds.itinB) &&
    r.survivors.itineraries.join() === r.survivorIds.itinB &&
    r.survivors.splits.join() === r.survivorIds.splitB &&
    r.survivors.packs.join() === r.survivorIds.packB;
  check('cascade removes only project A entities', cascadeOk);
  check('reloaded data equals in-memory state', JSON.stringify(r.afterDelete) === JSON.stringify(r.reloaded));

  if (errs.length) {
    console.log('FAILURES:\n' + errs.map((e) => '- ' + e).join('\n'));
    return false;
  }
  console.log('Equivalence checks (original vs refactored):');
  console.log('- state after mixed add/update/delete ops is identical');
  console.log('- itinerary and packing item ordering is preserved');
  console.log('- cascade delete keeps only the other project entities');
  console.log('- persisted localStorage payload (key/format) is identical');
  console.log('- reload after refresh restores identical data');
  console.log('- malformed storage fields do not affect other entities');
  return true;
}
