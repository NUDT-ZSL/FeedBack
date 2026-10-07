export type ForgeState = 'idle' | 'heating' | 'hammering' | 'quenching' | 'grinding' | 'sharpening' | 'inscribing' | 'showing';
export type MaterialType = 'mystery' | 'meteorite' | 'cold';

export interface ForgeStateData {
  currentState: ForgeState;
  hammerCount: number;
  temperature: number;
  materialType: MaterialType | null;
  heatingProgress: number;
  grindingProgress: number;
  sharpeningProgress: number;
  inscription: string;
}

type ProgressField = 'heatingProgress' | 'grindingProgress' | 'sharpeningProgress';

interface StageDefinition {
  progressField: ProgressField | null;
  progressCap: number;
  autoAdvanceRate: number;
  next: ForgeState | null;
}

const STAGE_DEFINITIONS: Record<ForgeState, StageDefinition> = {
  idle:       { progressField: null,                 progressCap: 0,   autoAdvanceRate: 0,  next: null },
  heating:    { progressField: 'heatingProgress',    progressCap: 100, autoAdvanceRate: 15, next: 'hammering' },
  hammering:  { progressField: null,                 progressCap: 60,  autoAdvanceRate: 0,  next: 'quenching' },
  quenching:  { progressField: null,                 progressCap: 0,   autoAdvanceRate: 0,  next: 'grinding' },
  grinding:   { progressField: 'grindingProgress',   progressCap: 100, autoAdvanceRate: 0,  next: 'sharpening' },
  sharpening: { progressField: 'sharpeningProgress', progressCap: 100, autoAdvanceRate: 20, next: 'inscribing' },
  inscribing: { progressField: null,                 progressCap: 0,   autoAdvanceRate: 0,  next: 'showing' },
  showing:    { progressField: null,                 progressCap: 0,   autoAdvanceRate: 0,  next: 'idle' }
};

const VALID_TRANSITIONS: Record<ForgeState, ForgeState[]> = {
  idle: ['heating'],
  heating: ['hammering'],
  hammering: ['quenching'],
  quenching: ['grinding'],
  grinding: ['sharpening'],
  sharpening: ['inscribing'],
  inscribing: ['showing'],
  showing: ['idle']
};

const INITIAL_TEMPERATURE = 1200;
const HAMMER_TEMPERATURE_FLOOR = 600;
const HAMMER_TEMPERATURE_STEP = 10;
const HAMMER_COUNT_TARGET = 60;
const QUENCHED_TEMPERATURE = 100;

function createInitialState(): ForgeStateData {
  return {
    currentState: 'idle',
    hammerCount: 0,
    temperature: INITIAL_TEMPERATURE,
    materialType: null,
    heatingProgress: 0,
    grindingProgress: 0,
    sharpeningProgress: 0,
    inscription: ''
  };
}

export class ForgeCore {
  private state: ForgeStateData;
  private stateChangeCallbacks: Array<(state: ForgeStateData) => void> = [];
  private progressCallbacks: Array<(state: ForgeStateData) => void> = [];

  constructor() {
    this.state = createInitialState();
  }

  getState(): ForgeStateData {
    return { ...this.state };
  }

  onStateChange(callback: (state: ForgeStateData) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  onProgress(callback: (state: ForgeStateData) => void): void {
    this.progressCallbacks.push(callback);
  }

  canTransition(from: ForgeState, to: ForgeState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  enterState(newState: ForgeState): void {
    if (this.state.currentState === newState) return;

    if (!this.canTransition(this.state.currentState, newState)) {
      console.warn(`Invalid state transition: ${this.state.currentState} -> ${newState}`);
      return;
    }

    this.state.currentState = newState;
    this.notifyStateChange();
  }

  setMaterial(material: MaterialType): void {
    this.state.materialType = material;
    this.state.heatingProgress = 0;
    this.notifyStateChange();
  }

  addHeatingProgress(amount: number): void {
    this.advanceStageProgress('heatingProgress', amount);
  }

  addHammerCount(): void {
    if (this.state.currentState !== 'hammering') return;
    this.state.hammerCount++;
    this.state.temperature = Math.max(HAMMER_TEMPERATURE_FLOOR, this.state.temperature - HAMMER_TEMPERATURE_STEP);
    this.notifyProgress();

    if (this.state.hammerCount >= HAMMER_COUNT_TARGET) {
      this.enterState('quenching');
    }
  }

  setQuenchingComplete(): void {
    if (this.state.currentState !== 'quenching') return;
    this.state.temperature = QUENCHED_TEMPERATURE;
    this.enterState('grinding');
  }

  addGrindingProgress(amount: number, correctDirection: boolean): boolean {
    if (this.state.currentState !== 'grinding') return false;

    if (!correctDirection) {
      return false;
    }

    this.advanceStageProgress('grindingProgress', amount);
    return true;
  }

  addSharpeningProgress(amount: number): void {
    this.advanceStageProgress('sharpeningProgress', amount);
  }

  setInscription(text: string): void {
    if (!this.canTransition(this.state.currentState, 'showing')) {
      console.warn(`Cannot set inscription in state: ${this.state.currentState}`);
      return;
    }
    this.state.inscription = text;
    this.enterState('showing');
  }

  reset(): void {
    this.state = createInitialState();
    this.notifyStateChange();
  }

  update(delta: number): void {
    const stage = STAGE_DEFINITIONS[this.state.currentState];
    if (!stage.progressField || stage.autoAdvanceRate <= 0) return;
    this.advanceStageProgress(stage.progressField, delta * stage.autoAdvanceRate);
  }

  private advanceStageProgress(field: ProgressField, amount: number): void {
    const stage = STAGE_DEFINITIONS[this.state.currentState];
    if (stage.progressField !== field) return;

    this.state[field] = Math.min(stage.progressCap, this.state[field] + amount);

    if (field === 'heatingProgress') {
      this.updateTemperature();
    }

    this.notifyProgress();

    if (this.state[field] >= stage.progressCap && stage.next) {
      this.enterState(stage.next);
    }
  }

  private updateTemperature(): void {
    const t = this.state.heatingProgress / 100;
    this.state.temperature = INITIAL_TEMPERATURE - t * 400;
  }

  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach(cb => cb({ ...this.state }));
  }

  private notifyProgress(): void {
    this.progressCallbacks.forEach(cb => cb({ ...this.state }));
  }
}
