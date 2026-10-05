import { create } from 'zustand';
import {
  DEFAULT_PARAMS,
  SAMPLES,
  adjudicate,
  createEventSet,
  derivationsEqual,
  fullDerive,
  incrementalDerive,
} from '@/engine';
import type {
  AdjudicationAction,
  Derivation,
  EngineParams,
  EventSet,
  SampleKey,
  StreamEvent,
} from '@/engine';

interface ConsistencyCheck {
  equal: boolean;
  reason?: string;
}

interface BackpressureState {
  eventSet: EventSet;
  params: EngineParams;
  derivation: Derivation;
  /** 逐区间重推 vs 整体重推 的实时一致性校验 */
  check: ConsistencyCheck;
  sample: SampleKey;
  setParams: (patch: Partial<Omit<EngineParams, 'version'>>) => void;
  adjudicateConflict: (key: string, action: AdjudicationAction) => void;
  injectPair: (kind: 'duplicate' | 'conflict') => void;
  loadSample: (key: SampleKey) => void;
}

function recompute(
  prevSet: EventSet,
  prevParams: EngineParams,
  prevDerivation: Derivation,
  eventSet: EventSet,
  params: EngineParams,
): { derivation: Derivation; check: ConsistencyCheck } {
  const derivation = incrementalDerive(prevSet, prevParams, prevDerivation, eventSet, params);
  const check = derivationsEqual(fullDerive(eventSet, params), derivation);
  return { derivation, check };
}

const initialEvents = createEventSet(SAMPLES.burst.build());
const initialDerivation = fullDerive(initialEvents, DEFAULT_PARAMS);

export const useBackpressureStore = create<BackpressureState>((set, get) => ({
  eventSet: initialEvents,
  params: DEFAULT_PARAMS,
  derivation: initialDerivation,
  check: { equal: true },
  sample: 'burst',

  setParams: (patch) => {
    const { eventSet, params, derivation } = get();
    const nextParams = { ...params, ...patch, version: params.version + 1 };
    set({ params: nextParams, ...recompute(eventSet, params, derivation, eventSet, nextParams) });
  },

  adjudicateConflict: (key, action) => {
    const { eventSet, params, derivation } = get();
    const nextSet = adjudicate(eventSet, key, action);
    set({ eventSet: nextSet, ...recompute(eventSet, params, derivation, nextSet, params) });
  },

  injectPair: (kind) => {
    const { eventSet, params, derivation } = get();
    const base = Math.max(...eventSet.events.map((e) => e.timestamp), 0);
    const at = Math.floor((base + 5000) / params.tickMs) * params.tickMs;
    const suffix = `${eventSet.version}-${eventSet.events.length}`;
    const pair: StreamEvent[] =
      kind === 'duplicate'
        ? [
            { id: `inj-a-${suffix}`, source: 'inject', timestamp: at, size: 15, payload: 'v=1' },
            { id: `inj-b-${suffix}`, source: 'inject', timestamp: at, size: 15, payload: 'v=1' },
          ]
        : [
            { id: `inj-a-${suffix}`, source: 'inject', timestamp: at, size: 15, payload: 'v=1' },
            { id: `inj-b-${suffix}`, source: 'inject', timestamp: at, size: 25, payload: 'v=2' },
          ];
    const nextSet = createEventSet([...eventSet.events, ...pair], eventSet);
    set({ eventSet: nextSet, ...recompute(eventSet, params, derivation, nextSet, params) });
  },

  loadSample: (key) => {
    const { eventSet, params, derivation } = get();
    const nextSet = createEventSet(SAMPLES[key].build());
    set({ sample: key, eventSet: nextSet, ...recompute(eventSet, params, derivation, nextSet, params) });
  },
}));
