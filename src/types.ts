export type UrgencyLevel = 'normal' | 'urgent' | 'extreme';

export interface Point {
  x: number;
  y: number;
}

export interface PostStation {
  id: string;
  name: string;
  position: Point;
  horses: number;
  soldiers: number;
  documents: Document[];
}

export interface Document {
  id: string;
  code: string;
  urgency: UrgencyLevel;
  fromStation: string;
  toStation: string;
  status: 'pending' | 'in-transit' | 'delivered' | 'delayed';
  dispatchTime?: number;
  arrivalTime?: number;
  timeLimit: number;
}

export interface Horse {
  id: string;
  name: string;
  available: boolean;
}

export interface Soldier {
  id: string;
  stamina: number;
  isResting: boolean;
  restEndTime?: number;
}

export interface MovingHorse {
  id: string;
  documentId: string;
  fromStation: string;
  toStation: string;
  startTime: number;
  duration: number;
  progress: number;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  createdAt: number;
  duration: number;
}

export interface LogEntry {
  id: string;
  documentId: string;
  documentCode: string;
  fromStation: string;
  toStation: string;
  dispatchTime: number;
  arrivalTime?: number;
  duration?: number;
  status: 'delivered' | 'in-transit' | 'delayed';
}

export interface AppState {
  stations: PostStation[];
  horses: Horse[];
  soldier: Soldier;
  movingHorses: MovingHorse[];
  particles: Particle[];
  logs: LogEntry[];
  selectedStation: string | null;
  selectedHorse: string | null;
  selectedDocument: string | null;
  alertMessage: string | null;
  documentCounter: number;
}

export interface AppActions {
  selectStation: (id: string | null) => void;
  selectHorse: (id: string | null) => void;
  selectDocument: (id: string | null) => void;
  dispatchDocument: () => void;
  restSoldier: () => void;
  updateMovingHorses: (currentTime: number) => void;
  addParticle: (x: number, y: number, currentTime: number) => void;
  cleanupParticles: (currentTime: number) => void;
  checkTimeouts: (currentTime: number) => void;
  dismissAlert: () => void;
  updateSoldierRest: (currentTime: number) => void;
}

export type StoreType = AppState & AppActions;
