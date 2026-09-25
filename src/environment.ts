export interface EnvironmentState {
  temperature: number;
  humidity: number;
  light: number;
  targetTemperature: number;
  targetHumidity: number;
  targetLight: number;
}

import { calculateEnvironmentFitness } from './fitness.js';

export interface OptimalEnvironment {
  temperature: { min: number; max: number };
  humidity: { min: number; max: number };
  light: { min: number; max: number };
}

export class EnvironmentSystem {
  state: EnvironmentState;
  changeInterval: number = 10000;
  lastChangeTime: number;

  constructor() {
    this.state = {
      temperature: 25,
      humidity: 50,
      light: 60,
      targetTemperature: 25,
      targetHumidity: 50,
      targetLight: 60,
    };
    this.lastChangeTime = 0;
  }

  update(deltaTime: number, currentTime: number): void {
    const lerpFactor = 0.05;

    this.state.temperature += (this.state.targetTemperature - this.state.temperature) * lerpFactor;
    this.state.humidity += (this.state.targetHumidity - this.state.humidity) * lerpFactor;
    this.state.light += (this.state.targetLight - this.state.light) * lerpFactor;

    if (currentTime - this.lastChangeTime >= this.changeInterval) {
      this.state.targetTemperature = this.generateNewTarget(
        this.state.targetTemperature,
        10,
        40,
        10
      );
      this.state.targetHumidity = this.generateNewTarget(
        this.state.targetHumidity,
        0,
        100,
        10
      );
      this.state.targetLight = this.generateNewTarget(
        this.state.targetLight,
        0,
        100,
        10
      );
      this.lastChangeTime = currentTime;
    }
  }

  private generateNewTarget(
    currentValue: number,
    min: number,
    max: number,
    maxChange: number
  ): number {
    const change = (Math.random() * 2 - 1) * maxChange;
    let newValue = currentValue + change;
    newValue = Math.max(min, Math.min(max, newValue));
    return newValue;
  }

  calculateFitness(optimalEnv: OptimalEnvironment): number {
    return calculateEnvironmentFitness(
      {
        temperature: this.state.temperature,
        humidity: this.state.humidity,
        light: this.state.light,
      },
      optimalEnv
    );
  }

  getDisplayValues(): { temp: number; humidity: number; light: number } {
    return {
      temp: Math.round(this.state.temperature),
      humidity: Math.round(this.state.humidity),
      light: Math.round(this.state.light),
    };
  }
}
