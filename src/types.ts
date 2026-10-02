export enum ComponentType {
  CapBlock = 'CapBlock',
  CorbelBracket = 'CorbelBracket',
  ArchBracket = 'ArchBracket',
  Cantilever = 'Cantilever',
  SubstituteWood = 'SubstituteWood',
  Rafter = 'Rafter'
}

export enum AssemblyMode {
  Disassemble = 'Disassemble',
  Assemble = 'Assemble'
}

export enum InteractionType {
  DragStart = 'DragStart',
  DragEnd = 'DragEnd',
  Snap = 'Snap',
  Disassemble = 'Disassemble'
}

export interface Transform {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  x: number;
  y: number;
  z: number;
}

export interface DougongComponent {
  id: string;
  name: string;
  type: ComponentType;
  position: Transform;
  rotation: Rotation;
  correctPosition: Transform;
  correctRotation: Rotation;
  color: string;
  isAssembled: boolean;
  isSnapped: boolean;
  assemblyOrder: number;
  material: string;
  tenonType: string;
  mortiseType: string;
  dimensions: {
    width: number;
    height: number;
    depth: number;
  };
  isAnimating?: boolean;
  animationPhase?: 'idle' | 'disassembling' | 'flyingIn' | 'snapping' | 'error';
}

export interface SoundQueueItem {
  id: string;
  type: 'friction' | 'snap' | 'error' | 'drag';
  volume: number;
  pitch: number;
}

export interface AppState {
  components: DougongComponent[];
  selectedComponentId: string | null;
  hoveredComponentId: string | null;
  draggingComponentId: string | null;
  progress: number;
  mode: AssemblyMode;
  isModeTransitioning: boolean;
  soundQueue: SoundQueueItem[];
  showFullAssembly: boolean;
  backgroundTransition: number;
}

export interface AppActions {
  selectComponent: (id: string | null) => void;
  hoverComponent: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  moveComponent: (id: string, position: Partial<Transform>) => void;
  rotateComponent: (id: string, rotation: Partial<Rotation>) => void;
  snapToTarget: (id: string) => void;
  errorSnap: (id: string) => void;
  toggleMode: () => void;
  completeModeTransition: () => void;
  playSound: (type: SoundQueueItem['type'], volume?: number, pitch?: number) => void;
  calculateProgress: () => void;
  triggerFullAssembly: () => void;
  resetComponents: () => void;
  disassembleAll: () => void;
  flyInAll: () => void;
  setComponentAnimation: (id: string, phase: DougongComponent['animationPhase']) => void;
  updateBackgroundTransition: (value: number) => void;
}
