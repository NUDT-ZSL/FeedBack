export enum LightState {
  Green = 'green',
  Yellow = 'yellow',
  Red = 'red'
}

export interface TrafficLightStatus {
  ns: LightState;
  ew: LightState;
}

export class TrafficLight {
  private greenDuration: number = 30;
  private redDuration: number = 30;
  private yellowDuration: number = 3;
  private elapsed: number = 0;
  private phase: number = 0;
  private status: TrafficLightStatus = { ns: LightState.Green, ew: LightState.Red };

  private readonly phases: Array<{ ns: LightState; ew: LightState; duration: () => number }> = [
    { ns: LightState.Green, ew: LightState.Red, duration: () => this.greenDuration },
    { ns: LightState.Yellow, ew: LightState.Red, duration: () => this.yellowDuration },
    { ns: LightState.Red, ew: LightState.Green, duration: () => this.redDuration },
    { ns: LightState.Red, ew: LightState.Yellow, duration: () => this.yellowDuration },
  ];

  setGreenDuration(d: number): void {
    this.greenDuration = Math.max(10, Math.min(60, d));
  }

  setRedDuration(d: number): void {
    this.redDuration = Math.max(10, Math.min(60, d));
  }

  getGreenDuration(): number {
    return this.greenDuration;
  }

  getRedDuration(): number {
    return this.redDuration;
  }

  getStatus(): TrafficLightStatus {
    return { ...this.status };
  }

  update(dt: number): void {
    this.elapsed += dt;
    const currentPhase = this.phases[this.phase];
    if (this.elapsed >= currentPhase.duration()) {
      this.elapsed -= currentPhase.duration();
      this.phase = (this.phase + 1) % this.phases.length;
      const next = this.phases[this.phase];
      this.status = { ns: next.ns, ew: next.ew };
    }
  }

  reset(): void {
    this.elapsed = 0;
    this.phase = 0;
    this.status = { ns: LightState.Green, ew: LightState.Red };
  }
}
