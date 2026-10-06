import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  canEditManifest,
  canEditSchedule,
  canInitiateInspection,
  markFindingConflict,
  unmarkFindingConflict,
} from '@/domain/inspection';
import { adjudicate, applyExternalManifestEdit, recomputeShip } from '@/domain/operations';
import { buildSeed } from '@/domain/seed';
import { DEFAULT_SCHEDULE } from '@/domain/tariff';
import type {
  CargoCategory,
  CargoEntry,
  Inspection,
  InspectionFinding,
  OpResult,
  Origin,
  RulingAction,
  Ship,
  TariffSchedule,
} from '@/domain/types';
import { fail, ok, uid } from '@/domain/types';

interface NewShipInput {
  name: string;
  captain: string;
  origin: Origin;
  tonnage: number;
}

interface NewEntryInput {
  name: string;
  category: CargoCategory;
  quantity: number;
  unitValue: number;
}

interface CustomsState {
  ships: Ship[];
  inspections: Inspection[];
  schedule: TariffSchedule;

  resetToSeed: () => void;
  addShip: (input: NewShipInput) => string;
  recompute: (shipId: string) => OpResult;
  addCargoEntry: (shipId: string, input: NewEntryInput) => OpResult;
  updateCargoEntry: (shipId: string, entryId: string, patch: Partial<NewEntryInput>) => OpResult;
  removeCargoEntry: (shipId: string, entryId: string) => OpResult;
  updateSchedule: (patch: TariffSchedule) => OpResult;
  initiateInspection: (shipId: string) => OpResult;
  addFinding: (inspectionId: string, finding: Omit<InspectionFinding, 'id'>) => void;
  removeFinding: (inspectionId: string, findingId: string) => void;
  adjudicateInspection: (
    inspectionId: string,
    decisions: Record<string, RulingAction>,
    note: string,
  ) => OpResult;
}

function getShip(state: CustomsState, shipId: string): Ship | undefined {
  return state.ships.find((s) => s.id === shipId);
}

const initialSeed = buildSeed();

export const useCustomsStore = create<CustomsState>()(
  persist(
    (set, get) => ({
      ...initialSeed,

      resetToSeed: () => set({ ...buildSeed() }),

      addShip: (input) => {
        const id = uid('ship');
        const now = Date.now();
        const ship: Ship = {
          id,
          name: input.name,
          captain: input.captain,
          origin: input.origin,
          tonnage: input.tonnage,
          arrivedAt: now,
          manifest: [],
          manifestVersion: 1,
          conclusion: null,
        };
        set((state) => ({ ships: [...state.ships, ship] }));
        return id;
      },

      recompute: (shipId) => {
        const state = get();
        const ship = getShip(state, shipId);
        if (!ship) return fail('商船不存在');
        const guard = canEditManifest(state.inspections, shipId);
        if (!guard.ok) return guard;
        set({
          ships: state.ships.map((s) => (s.id === shipId ? recomputeShip(s, state.schedule, Date.now()) : s)),
        });
        return ok;
      },

      addCargoEntry: (shipId, input) => {
        const state = get();
        const ship = getShip(state, shipId);
        if (!ship) return fail('商船不存在');
        const guard = canEditManifest(state.inspections, shipId);
        if (!guard.ok) return guard;
        const entry: CargoEntry = { id: uid('cargo'), ...input, source: 'manifest', status: 'active' };
        const result = applyExternalManifestEdit(
          ship,
          state.inspections,
          (m) => [...m, entry],
          state.schedule,
          Date.now(),
        );
        set({
          ships: state.ships.map((s) => (s.id === shipId ? result.ship : s)),
          inspections: result.inspections,
        });
        return ok;
      },

      updateCargoEntry: (shipId, entryId, patch) => {
        const state = get();
        const ship = getShip(state, shipId);
        if (!ship) return fail('商船不存在');
        const guard = canEditManifest(state.inspections, shipId);
        if (!guard.ok) return guard;
        const target = ship.manifest.find((e) => e.id === entryId);
        if (!target) return fail('货单条目不存在');
        if (target.status !== 'active') return fail('该条目已被裁定取代，不可再修，只能新增更正条目');
        const result = applyExternalManifestEdit(
          ship,
          state.inspections,
          (m) => m.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
          state.schedule,
          Date.now(),
        );
        set({
          ships: state.ships.map((s) => (s.id === shipId ? result.ship : s)),
          inspections: result.inspections,
        });
        return ok;
      },

      removeCargoEntry: (shipId, entryId) => {
        const state = get();
        const ship = getShip(state, shipId);
        if (!ship) return fail('商船不存在');
        const guard = canEditManifest(state.inspections, shipId);
        if (!guard.ok) return guard;
        const target = ship.manifest.find((e) => e.id === entryId);
        if (!target) return fail('货单条目不存在');
        if (target.status !== 'active') return fail('被取代的条目须留档，不可删除');
        const result = applyExternalManifestEdit(
          ship,
          state.inspections,
          (m) => m.filter((e) => e.id !== entryId),
          state.schedule,
          Date.now(),
        );
        set({
          ships: state.ships.map((s) => (s.id === shipId ? result.ship : s)),
          inspections: result.inspections,
        });
        return ok;
      },

      updateSchedule: (patch) => {
        const state = get();
        const guard = canEditSchedule(state.inspections);
        if (!guard.ok) return guard;
        const schedule: TariffSchedule = { ...patch, version: state.schedule.version + 1 };
        const now = Date.now();
        set({
          schedule,
          // 口径变更：所有已验讫商船整船从头重算；未验讫的维持原状
          ships: state.ships.map((s) => (s.conclusion ? recomputeShip(s, schedule, now) : s)),
        });
        return ok;
      },

      initiateInspection: (shipId) => {
        const state = get();
        const guard = canInitiateInspection(state.inspections, shipId);
        if (!guard.ok) return guard;
        const round = state.inspections.filter((i) => i.shipId === shipId).length + 1;
        const inspection: Inspection = {
          id: uid('insp'),
          shipId,
          round,
          initiatedAt: Date.now(),
          status: 'pending',
          findings: [],
          ruling: null,
        };
        set({ inspections: [...state.inspections, inspection] });
        return ok;
      },

      addFinding: (inspectionId, input) => {
        const state = get();
        const inspection = state.inspections.find((i) => i.id === inspectionId);
        if (!inspection || inspection.status !== 'pending') return;
        const finding: InspectionFinding = { id: uid('f'), ...input };
        const ship = getShip(state, inspection.shipId);
        set({
          inspections: state.inspections.map((i) =>
            i.id === inspectionId ? { ...i, findings: [...i.findings, finding] } : i,
          ),
          ships: ship
            ? state.ships.map((s) =>
                s.id === ship.id
                  ? { ...s, manifest: markFindingConflict(s.manifest, finding.targetEntryId) }
                  : s,
              )
            : state.ships,
        });
      },

      removeFinding: (inspectionId, findingId) => {
        const state = get();
        const inspection = state.inspections.find((i) => i.id === inspectionId);
        if (!inspection || inspection.status !== 'pending') return;
        const ship = getShip(state, inspection.shipId);
        if (!ship) return;
        const manifest = unmarkFindingConflict(ship.manifest, inspection, findingId);
        set({
          inspections: state.inspections.map((i) =>
            i.id === inspectionId ? { ...i, findings: i.findings.filter((f) => f.id !== findingId) } : i,
          ),
          ships: state.ships.map((s) => (s.id === ship.id ? { ...s, manifest } : s)),
        });
      },

      adjudicateInspection: (inspectionId, decisions, note) => {
        const state = get();
        const inspection = state.inspections.find((i) => i.id === inspectionId);
        if (!inspection) return fail('抽检不存在');
        if (inspection.status !== 'pending') return fail('该抽检已经裁定');
        if (inspection.findings.length === 0) return fail('无抽检记录，无从裁定');
        const missing = inspection.findings.filter((f) => !decisions[f.id]);
        if (missing.length > 0) return fail(`尚有 ${missing.length} 条抽检记录未作裁定`);
        const ship = getShip(state, inspection.shipId);
        if (!ship) return fail('商船不存在');
        const result = adjudicate(ship, inspection, decisions, state.schedule, note, Date.now());
        set({
          ships: state.ships.map((s) => (s.id === ship.id ? result.ship : s)),
          inspections: state.inspections.map((i) => (i.id === inspectionId ? result.inspection : i)),
        });
        return ok;
      },
    }),
    {
      name: 'quanzhou-shibosi-v1',
      version: 1,
    },
  ),
);

export { DEFAULT_SCHEDULE };
