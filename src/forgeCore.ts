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

export const PROGRESS_MAX = 100;
export const HAMMER_TARGET = 60;
export const INITIAL_TEMPERATURE = 1200;
export const QUENCHED_TEMPERATURE = 100;
export const HEATING_TEMPERATURE_DROP = 400;
export const HAMMER_TEMPERATURE_STEP = 10;
export const HAMMER_TEMPERATURE_FLOOR = 600;
export const HEATING_PROGRESS_RATE = 15;
export const SHARPENING_PROGRESS_RATE = 20;

export const FORGE_STAGE_ORDER: readonly ForgeState[] = [
  'idle',
  'heating',
  'hammering',
  'quenching',
  'grinding',
  'sharpening',
  'inscribing',
  'showing'
];

const VALID_TRANSITIONS: Record<ForgeState, readonly ForgeState[]> = {
  idle: ['heating'],
  heating: ['hammering'],
  hammering: ['quenching'],
  quenching: ['grinding'],
  grinding: ['sharpening'],
  sharpening: ['inscribing'],
  inscribing: ['showing'],
  showing: ['idle']
};

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

  private readonly timedStageTicks: Partial<Record<ForgeState, (delta: number) => void>> = {
    heating: (delta) => this.addHeatingProgress(delta * HEATING_PROGRESS_RATE),
    sharpening: (delta) => this.addSharpeningProgress(delta * SHARPENING_PROGRESS_RATE)
  };

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

  static canTransition(from: ForgeState, to: ForgeState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  canTransitionTo(to: ForgeState): boolean {
    return ForgeCore.canTransition(this.state.currentState, to);
  }

  enterState(newState: ForgeState): boolean {
    if (this.state.currentState === newState) return true;

    if (!this.canTransitionTo(newState)) {
      console.warn(`Invalid state transition: ${this.state.currentState} -> ${newState}`);
      return false;
    }

    this.state.currentState = newState;
    this.notifyStateChange();
    return true;
  }

  setMaterial(material: MaterialType): boolean {
    if (this.state.currentState !== 'idle') {
      console.warn(`Cannot set material while in state: ${this.state.currentState}`);
      return false;
    }
    this.state.materialType = material;
    this.state.heatingProgress = 0;
    this.notifyStateChange();
    return true;
  }

  addHeatingProgress(amount: number): void {
    if (this.state.currentState !== 'heating') return;
    this.state.heatingProgress = Math.min(PROGRESS_MAX, this.state.heatingProgress + amount);
    this.updateTemperature();
    this.notifyProgress();

    if (this.state.heatingProgress >= PROGRESS_MAX) {
      this.enterState('hammering');
    }
  }

  private updateTemperature(): void {
    const t = this.state.heatingProgress / PROGRESS_MAX;
    this.state.temperature = INITIAL_TEMPERATURE - t * HEATING_TEMPERATURE_DROP;
  }

  addHammerCount(): void {
    if (this.state.currentState !== 'hammering') return;
    this.state.hammerCount++;
    this.state.temperature = Math.max(HAMMER_TEMPERATURE_FLOOR, this.state.temperature - HAMMER_TEMPERATURE_STEP);
    this.notifyProgress();

    if (this.state.hammerCount >= HAMMER_TARGET) {
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

    this.state.grindingProgress = Math.min(PROGRESS_MAX, this.state.grindingProgress + amount);
    this.notifyProgress();

    if (this.state.grindingProgress >= PROGRESS_MAX) {
      this.enterState('sharpening');
    }
    return true;
  }

  addSharpeningProgress(amount: number): void {
    if (this.state.currentState !== 'sharpening') return;
    this.state.sharpeningProgress = Math.min(PROGRESS_MAX, this.state.sharpeningProgress + amount);
    this.notifyProgress();

    if (this.state.sharpeningProgress >= PROGRESS_MAX) {
      this.enterState('inscribing');
    }
  }

  setInscription(text: string): boolean {
    if (this.state.currentState !== 'inscribing') {
      console.warn(`Cannot set inscription while in state: ${this.state.currentState}`);
      return false;
    }
    this.state.inscription = text;
    return this.enterState('showing');
  }

  reset(): void {
    this.state = createInitialState();
    this.notifyStateChange();
  }

  update(delta: number): void {
    this.timedStageTicks[this.state.currentState]?.(delta);
  }

  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach(cb => cb({ ...this.state }));
  }

  private notifyProgress(): void {
    this.progressCallbacks.forEach(cb => cb({ ...this.state }));
  }
}
