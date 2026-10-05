import type { Document, Horse, LogEntry, MovingHorse, PostStation, Soldier } from './types.ts';
import { getEffectiveDuration, getStationIndex, generateDocumentCode } from './utils.ts';

export interface SimState {
  stations: PostStation[];
  horses: Horse[];
  soldier: Soldier;
  movingHorses: MovingHorse[];
  logs: LogEntry[];
  documentCounter: number;
  alertMessage: string | null;
}

export interface SimConfig {
  staminaCostPerDispatch: number;
  staminaRestorePerRest: number;
  maxStamina: number;
  restDurationMs: number;
  maxLogs: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  staminaCostPerDispatch: 20,
  staminaRestorePerRest: 30,
  maxStamina: 100,
  restDurationMs: 5000,
  maxLogs: 20,
};

export interface SimContext {
  now: () => number;
  nextId: (prefix: string) => string;
  config: SimConfig;
}

export const createSimContext = (
  options: { now?: () => number; config?: Partial<SimConfig> } = {}
): SimContext => {
  let counter = 0;
  return {
    now: options.now ?? (() => Date.now()),
    nextId: (prefix: string) => `${prefix}-${++counter}`,
    config: { ...DEFAULT_SIM_CONFIG, ...options.config },
  };
};

export const dispatchDocument = <S extends SimState>(
  state: S,
  ctx: SimContext,
  stationId: string | null,
  horseId: string | null,
  documentId: string | null
): S => {
  if (!stationId || !horseId || !documentId) return state;

  const { soldier } = state;
  if (soldier.isResting || soldier.stamina <= 0) return state;

  const horse = state.horses.find(h => h.id === horseId);
  if (!horse || !horse.available) return state;

  const station = state.stations.find(s => s.id === stationId);
  const doc = station?.documents.find(d => d.id === documentId);
  if (!station || !doc || doc.status !== 'pending') return state;

  const now = ctx.now();
  const stationCount = Math.abs(getStationIndex(doc.toStation) - getStationIndex(stationId));
  const duration = getEffectiveDuration(doc.urgency, soldier.stamina, stationCount) * 1000;
  const newDocCode = generateDocumentCode(state.documentCounter);

  const updatedDoc: Document = {
    ...doc,
    status: 'in-transit',
    dispatchTime: now,
    code: newDocCode,
  };

  const movingHorse: MovingHorse = {
    id: ctx.nextId('moving'),
    horseId,
    documentId: doc.id,
    fromStation: stationId,
    toStation: doc.toStation,
    startTime: now,
    duration,
    progress: 0,
  };

  const logEntry: LogEntry = {
    id: ctx.nextId('log'),
    documentId: doc.id,
    documentCode: newDocCode,
    fromStation: station.name,
    toStation: state.stations.find(s => s.id === doc.toStation)?.name || '',
    dispatchTime: now,
    status: 'in-transit',
  };

  const newStamina = Math.max(0, soldier.stamina - ctx.config.staminaCostPerDispatch);

  return {
    ...state,
    stations: state.stations.map(s =>
      s.id === stationId
        ? { ...s, documents: s.documents.map(d => (d.id === doc.id ? updatedDoc : d)) }
        : s
    ),
    horses: state.horses.map(h => (h.id === horseId ? { ...h, available: false } : h)),
    soldier: { ...state.soldier, stamina: newStamina },
    movingHorses: [...state.movingHorses, movingHorse],
    logs: [logEntry, ...state.logs].slice(0, ctx.config.maxLogs),
    documentCounter: state.documentCounter + 1,
  };
};

export const restSoldier = <S extends SimState>(state: S, ctx: SimContext): S => {
  const { soldier } = state;
  if (soldier.isResting || soldier.stamina >= ctx.config.maxStamina) return state;

  return {
    ...state,
    soldier: {
      ...soldier,
      isResting: true,
      restEndTime: ctx.now() + ctx.config.restDurationMs,
    },
  };
};

export const updateSoldierRest = <S extends SimState>(
  state: S,
  currentTime: number,
  config: SimConfig = DEFAULT_SIM_CONFIG
): S => {
  const { soldier } = state;
  if (!soldier.isResting || soldier.restEndTime === undefined) return state;
  if (currentTime < soldier.restEndTime) return state;

  return {
    ...state,
    soldier: {
      ...soldier,
      stamina: Math.min(soldier.stamina + config.staminaRestorePerRest, config.maxStamina),
      isResting: false,
      restEndTime: undefined,
    },
  };
};

export const updateMovingHorses = <S extends SimState>(state: S, currentTime: number): S => {
  if (state.movingHorses.length === 0) return state;

  const arrived: MovingHorse[] = [];
  const stillMoving: MovingHorse[] = [];

  for (const mh of state.movingHorses) {
    const progress = Math.min(1, (currentTime - mh.startTime) / mh.duration);
    if (progress >= 1) {
      arrived.push(mh);
    } else {
      stillMoving.push({ ...mh, progress });
    }
  }

  if (arrived.length === 0) {
    return { ...state, movingHorses: stillMoving };
  }

  const arrivedDocIds = new Set(arrived.map(mh => mh.documentId));
  const releasedHorseIds = new Set(arrived.map(mh => mh.horseId));

  const stations = state.stations.map(s => ({
    ...s,
    documents: s.documents.map(d =>
      arrivedDocIds.has(d.id) && d.status === 'in-transit'
        ? { ...d, status: 'delivered' as const, arrivalTime: currentTime }
        : d
    ),
  }));

  const logs = state.logs.map(l =>
    arrivedDocIds.has(l.documentId) && l.status === 'in-transit'
      ? {
          ...l,
          arrivalTime: currentTime,
          duration: (currentTime - l.dispatchTime) / 1000,
          status: 'delivered' as const,
        }
      : l
  );

  const horses = state.horses.map(h =>
    releasedHorseIds.has(h.id) ? { ...h, available: true } : h
  );

  return { ...state, stations, logs, horses, movingHorses: stillMoving };
};

export const checkTimeouts = <S extends SimState>(state: S, currentTime: number): S => {
  const delayedDocIds = new Set<string>();
  let timeoutDocCode = '';

  const stations = state.stations.map(s => ({
    ...s,
    documents: s.documents.map(d => {
      if (d.status === 'in-transit' && d.dispatchTime !== undefined) {
        const elapsed = (currentTime - d.dispatchTime) / 1000;
        if (elapsed > d.timeLimit) {
          delayedDocIds.add(d.id);
          timeoutDocCode = d.code;
          return { ...d, status: 'delayed' as const };
        }
      }
      return d;
    }),
  }));

  if (delayedDocIds.size === 0) return state;

  const logs = state.logs.map(l =>
    l.status === 'in-transit' && delayedDocIds.has(l.documentId)
      ? { ...l, status: 'delayed' as const }
      : l
  );

  const releasedHorseIds = new Set(
    state.movingHorses
      .filter(mh => delayedDocIds.has(mh.documentId))
      .map(mh => mh.horseId)
  );

  const movingHorses = state.movingHorses.filter(mh => !delayedDocIds.has(mh.documentId));

  const horses = state.horses.map(h =>
    releasedHorseIds.has(h.id) ? { ...h, available: true } : h
  );

  return {
    ...state,
    stations,
    logs,
    movingHorses,
    horses,
    alertMessage: `警告：文书 ${timeoutDocCode} 已延误！`,
  };
};

export const advance = <S extends SimState>(
  state: S,
  currentTime: number,
  config: SimConfig = DEFAULT_SIM_CONFIG
): S => {
  return checkTimeouts(
    updateSoldierRest(updateMovingHorses(state, currentTime), currentTime, config),
    currentTime
  );
};
