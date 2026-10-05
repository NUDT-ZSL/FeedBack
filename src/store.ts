import { create } from 'zustand';
import type { StoreType, Document, LogEntry, MovingHorse } from './types';
import { generateStations, generateHorses, getEffectiveDuration, getStationIndex, generateDocumentCode } from './utils';
import { now } from './clock';

const useStore = create<StoreType>((set, get) => ({
  stations: generateStations(),
  horses: generateHorses(),
  soldier: {
    id: 'soldier-1',
    stamina: 100,
    isResting: false,
  },
  movingHorses: [],
  particles: [],
  logs: [],
  selectedStation: null,
  selectedHorse: null,
  selectedDocument: null,
  alertMessage: null,
  documentCounter: 100,

  selectStation: (id: string | null) => {
    set({ selectedStation: id, selectedDocument: null });
  },

  selectHorse: (id: string | null) => {
    set({ selectedHorse: id });
  },

  selectDocument: (id: string | null) => {
    set({ selectedDocument: id });
  },

  dispatchDocument: () => {
    const state = get();
    const { selectedStation, selectedHorse, selectedDocument, soldier, stations, documentCounter } = state;
    
    if (!selectedStation || !selectedHorse || !selectedDocument || soldier.isResting) return;
    if (soldier.stamina <= 0) return;

    const station = stations.find(s => s.id === selectedStation);
    const horse = state.horses.find(h => h.id === selectedHorse);
    if (!horse || !horse.available) return;
    const doc = station?.documents.find(d => d.id === selectedDocument);
    if (!station || !doc || doc.status !== 'pending') return;

    const fromIdx = getStationIndex(selectedStation);
    const toIdx = getStationIndex(doc.toStation);
    const stationCount = Math.abs(toIdx - fromIdx);
    const duration = getEffectiveDuration(doc.urgency, soldier.stamina, stationCount) * 1000;

    const currentNow = now();
    const newDocCode = generateDocumentCode(documentCounter);

    const updatedDoc: Document = {
      ...doc,
      status: 'in-transit',
      dispatchTime: currentNow,
      code: newDocCode,
    };

    const movingHorse: MovingHorse = {
      id: `moving-${doc.id}`,
      horseId: selectedHorse,
      documentId: doc.id,
      fromStation: selectedStation,
      toStation: doc.toStation,
      startTime: currentNow,
      duration,
      progress: 0,
    };

    const logEntry: LogEntry = {
      id: `log-${doc.id}`,
      documentId: doc.id,
      documentCode: newDocCode,
      fromStation: station.name,
      toStation: stations.find(s => s.id === doc.toStation)?.name || '',
      dispatchTime: currentNow,
      status: 'in-transit',
    };

    const newStamina = Math.max(0, soldier.stamina - 20);

    set(state => ({
      stations: state.stations.map(s =>
        s.id === selectedStation
          ? { ...s, documents: s.documents.map(d => d.id === doc.id ? updatedDoc : d) }
          : s
      ),
      horses: state.horses.map(h => h.id === selectedHorse ? { ...h, available: false } : h),
      soldier: { ...state.soldier, stamina: newStamina },
      movingHorses: [...state.movingHorses, movingHorse],
      logs: [logEntry, ...state.logs].slice(0, 20),
      selectedHorse: null,
      selectedDocument: null,
      documentCounter: state.documentCounter + 1,
    }));
  },

  restSoldier: () => {
    const state = get();
    if (state.soldier.isResting || state.soldier.stamina >= 100) return;
    
    set({
      soldier: {
        ...state.soldier,
        isResting: true,
        restEndTime: now() + 5000,
      },
    });
  },

  updateSoldierRest: (currentTime: number) => {
    const state = get();
    if (!state.soldier.isResting || !state.soldier.restEndTime) return;

    if (currentTime >= state.soldier.restEndTime) {
      set({
        soldier: {
          ...state.soldier,
          stamina: Math.min(100, state.soldier.stamina + 30),
          isResting: false,
          restEndTime: undefined,
        },
      });
    }
  },

  updateMovingHorses: (currentTime: number) => {
    const state = get();
    const { movingHorses, stations, logs } = state;

    const updatedMovingHorses: MovingHorse[] = [];
    const releasedHorseIds: string[] = [];
    let stationUpdates = [...stations];
    let logUpdates = [...logs];

    for (const mh of movingHorses) {
      const elapsed = currentTime - mh.startTime;
      const progress = Math.min(1, elapsed / mh.duration);

      if (progress >= 1) {
        stationUpdates = stationUpdates.map(s => {
          if (s.id === mh.fromStation) {
            return {
              ...s,
              documents: s.documents.map(d =>
                d.id === mh.documentId
                  ? { ...d, status: 'delivered' as const, arrivalTime: currentTime }
                  : d
              ),
            };
          }
          return s;
        });

        logUpdates = logUpdates.map(l =>
          l.documentId === mh.documentId
            ? {
                ...l,
                arrivalTime: currentTime,
                duration: (currentTime - l.dispatchTime) / 1000,
                status: 'delivered' as const,
              }
            : l
        );

        releasedHorseIds.push(mh.horseId);
      } else {
        updatedMovingHorses.push({ ...mh, progress });
      }
    }

    set(state => ({
      movingHorses: updatedMovingHorses,
      stations: stationUpdates,
      logs: logUpdates,
      horses: releasedHorseIds.length > 0
        ? state.horses.map(h =>
            releasedHorseIds.includes(h.id) ? { ...h, available: true } : h
          )
        : state.horses,
    }));
  },

  addParticle: (x: number, y: number, currentTime: number) => {
    const state = get();
    if (state.particles.length >= 10) {
      set({
        particles: [
          ...state.particles.slice(1),
          { id: `p-${Date.now()}-${Math.random()}`, x, y, createdAt: currentTime, duration: 800 },
        ],
      });
    } else {
      set({
        particles: [...state.particles, { id: `p-${Date.now()}-${Math.random()}`, x, y, createdAt: currentTime, duration: 800 }],
      });
    }
  },

  cleanupParticles: (currentTime: number) => {
    set(state => ({
      particles: state.particles.filter(p => currentTime - p.createdAt < p.duration),
    }));
  },

  checkTimeouts: (currentTime: number) => {
    const state = get();
    const { stations, logs, movingHorses } = state;
    let hasTimeout = false;
    let timeoutDocCode = '';

    const updatedStations = stations.map(s => ({
      ...s,
      documents: s.documents.map(d => {
        if (d.status === 'in-transit' && d.dispatchTime) {
          const elapsed = (currentTime - d.dispatchTime) / 1000;
          if (elapsed > d.timeLimit) {
            hasTimeout = true;
            timeoutDocCode = d.code;
            return { ...d, status: 'delayed' as const };
          }
        }
        return d;
      }),
    }));

    const updatedLogs = logs.map(l => {
      if (l.status === 'in-transit') {
        const mh = movingHorses.find(m => m.documentId === l.documentId);
        if (mh) {
          const doc = stations
            .flatMap(s => s.documents)
            .find(d => d.id === l.documentId);
          if (doc && doc.dispatchTime) {
            const elapsed = (currentTime - doc.dispatchTime) / 1000;
            if (elapsed > doc.timeLimit) {
              return { ...l, status: 'delayed' as const };
            }
          }
        }
      }
      return l;
    });

    const delayedDocIds = new Set(
      updatedStations.flatMap(s => s.documents)
        .filter(d => d.status === 'delayed')
        .map(d => d.id)
    );

    const updatedMovingHorses = movingHorses.filter(
      mh => !delayedDocIds.has(mh.documentId)
    );

    const timeoutHorseIds = movingHorses
      .filter(mh => delayedDocIds.has(mh.documentId))
      .map(mh => mh.horseId);

    const updatedHorses = timeoutHorseIds.length > 0
      ? state.horses.map(h =>
          timeoutHorseIds.includes(h.id) ? { ...h, available: true } : h
        )
      : state.horses;

    if (hasTimeout) {
      set({
        stations: updatedStations,
        logs: updatedLogs,
        movingHorses: updatedMovingHorses,
        horses: updatedHorses,
        alertMessage: `警告：文书 ${timeoutDocCode} 已延误！`,
      });
    } else {
      set({
        stations: updatedStations,
        logs: updatedLogs,
        movingHorses: updatedMovingHorses,
        horses: updatedHorses,
      });
    }
  },

  dismissAlert: () => {
    set({ alertMessage: null });
  },
}));

export default useStore;
