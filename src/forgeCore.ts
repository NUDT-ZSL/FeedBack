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

export class ForgeCore {
  private state: ForgeStateData;
  private stateChangeCallbacks: Array<(state: ForgeStateData) => void> = [];
  private progressCallbacks: Array<(state: ForgeStateData) => void> = [];

  constructor() {
    this.state = {
      currentState: 'idle',
      hammerCount: 0,
      temperature: 1200,
      materialType: null,
      heatingProgress: 0,
      grindingProgress: 0,
      sharpeningProgress: 0,
      inscription: ''
    };
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

  enterState(newState: ForgeState): void {
    if (this.state.currentState === newState) return;

    if (!this.isValidTransition(this.state.currentState, newState)) {
      console.warn(`Invalid state transition: ${this.state.currentState} -> ${newState}`);
      return;
    }

    this.state.currentState = newState;
    this.notifyStateChange();
  }

  private isValidTransition(from: ForgeState, to: ForgeState): boolean {
    const validTransitions: Record<ForgeState, ForgeState[]> = {
      'idle': ['heating'],
      'heating': ['hammering'],
      'hammering': ['quenching'],
      'quenching': ['grinding'],
      'grinding': ['sharpening'],
      'sharpening': ['inscribing'],
      'inscribing': ['showing'],
      'showing': ['idle']
    };
    return validTransitions[from]?.includes(to) || false;
  }

  setMaterial(material: MaterialType): void {
    this.state.materialType = material;
    this.state.heatingProgress = 0;
    this.notifyStateChange();
  }

  addHeatingProgress(amount: number): void {
    if (this.state.currentState !== 'heating') return;
    this.state.heatingProgress = Math.min(100, this.state.heatingProgress + amount);
    this.updateTemperature();
    this.notifyProgress();
    
    if (this.state.heatingProgress >= 100) {
      this.enterState('hammering');
    }
  }

  private updateTemperature(): void {
    const t = this.state.heatingProgress / 100;
    this.state.temperature = 1200 - t * 400;
  }

  addHammerCount(): void {
    if (this.state.currentState !== 'hammering') return;
    this.state.hammerCount++;
    this.state.temperature = Math.max(600, this.state.temperature - 10);
    this.notifyProgress();
    
    if (this.state.hammerCount >= 60) {
      this.enterState('quenching');
    }
  }

  setQuenchingComplete(): void {
    if (this.state.currentState !== 'quenching') return;
    this.state.temperature = 100;
    this.enterState('grinding');
  }

  addGrindingProgress(amount: number, correctDirection: boolean): boolean {
    if (this.state.currentState !== 'grinding') return false;
    
    if (!correctDirection) {
      return false;
    }
    
    this.state.grindingProgress = Math.min(100, this.state.grindingProgress + amount);
    this.notifyProgress();
    
    if (this.state.grindingProgress >= 100) {
      this.enterState('sharpening');
    }
    return true;
  }

  addSharpeningProgress(amount: number): void {
    if (this.state.currentState !== 'sharpening') return;
    this.state.sharpeningProgress = Math.min(100, this.state.sharpeningProgress + amount);
    this.notifyProgress();
    
    if (this.state.sharpeningProgress >= 100) {
      this.enterState('inscribing');
    }
  }

  setInscription(text: string): void {
    this.state.inscription = text;
    this.enterState('showing');
  }

  reset(): void {
    this.state = {
      currentState: 'idle',
      hammerCount: 0,
      temperature: 1200,
      materialType: null,
      heatingProgress: 0,
      grindingProgress: 0,
      sharpeningProgress: 0,
      inscription: ''
    };
    this.notifyStateChange();
  }

  update(delta: number): void {
    switch (this.state.currentState) {
      case 'heating':
        this.addHeatingProgress(delta * 15);
        break;
      case 'sharpening':
        this.addSharpeningProgress(delta * 20);
        break;
    }
  }

  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach(cb => cb({ ...this.state }));
  }

  private notifyProgress(): void {
    this.progressCallbacks.forEach(cb => cb({ ...this.state }));
  }
}
