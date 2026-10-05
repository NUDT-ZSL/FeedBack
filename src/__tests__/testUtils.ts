import useStore from '../store';
import { setTimeProvider, resetTimeProvider } from '../clock';
import type { Document, Horse, LogEntry, PostStation } from '../types';

export class ManualClock {
  private current: number;

  constructor(start = 1_000_000) {
    this.current = start;
  }

  now = (): number => this.current;

  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }
}

export const installClock = (clock: ManualClock): void => setTimeProvider(clock.now);
export const uninstallClock = (): void => resetTimeProvider();

export const makeDocument = (overrides: Partial<Document> = {}): Document => ({
  id: 'doc-0-0',
  code: 'TEST-000',
  urgency: 'normal',
  fromStation: 'station-0',
  toStation: 'station-1',
  status: 'pending',
  timeLimit: 15,
  ...overrides,
});

export const makeStation = (id: string, documents: Document[]): PostStation => ({
  id,
  name: `驿站-${id}`,
  position: { x: 0, y: 0 },
  horses: 5,
  soldiers: 3,
  documents,
});

export const makeHorse = (id: string, available = true): Horse => ({
  id,
  name: `马-${id}`,
  available,
});

export interface ResetOptions {
  stations?: PostStation[];
  horses?: Horse[];
  stamina?: number;
}

export const resetStore = (options: ResetOptions = {}): void => {
  useStore.setState({
    stations: options.stations ?? [
      makeStation('station-0', [makeDocument()]),
      makeStation('station-1', []),
    ],
    horses: options.horses ?? [makeHorse('horse-0'), makeHorse('horse-1')],
    soldier: { id: 'soldier-1', stamina: options.stamina ?? 100, isResting: false },
    movingHorses: [],
    particles: [],
    logs: [],
    selectedStation: null,
    selectedHorse: null,
    selectedDocument: null,
    alertMessage: null,
    documentCounter: 100,
  });
};

export const dispatch = (stationId: string, horseId: string, docId: string): void => {
  const store = useStore.getState();
  store.selectStation(stationId);
  store.selectHorse(horseId);
  store.selectDocument(docId);
  store.dispatchDocument();
};

export const getDoc = (docId: string): Document | undefined =>
  useStore.getState().stations.flatMap(s => s.documents).find(d => d.id === docId);

export const getLog = (docId: string): LogEntry | undefined =>
  useStore.getState().logs.find(l => l.documentId === docId);

export const getHorse = (horseId: string): Horse | undefined =>
  useStore.getState().horses.find(h => h.id === horseId);

export const getMoving = (docId: string) =>
  useStore.getState().movingHorses.find(m => m.documentId === docId);

export const stamina = (): number => useStore.getState().soldier.stamina;
