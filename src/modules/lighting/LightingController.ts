import { sceneManager } from '../../core/SceneManager';
import { buildingSystem, BuildingData } from '../building/BuildingSystem';
import * as THREE from 'three';

export type DayNightMode = 'day' | 'night';

export class LightingController {
  private static _instance: LightingController;
  private _currentMode: DayNightMode = 'day';
  private _isAnimating: boolean = false;
  private _animationCancelled: boolean = false;
  private _animationProgress: number = 0;

  private constructor() {}

  public static get instance(): LightingController {
    if (!LightingController._instance) {
      LightingController._instance = new LightingController();
    }
    return LightingController._instance;
  }

  public get currentMode(): DayNightMode {
    return this._currentMode;
  }

  public get isAnimating(): boolean {
    return this._isAnimating;
  }

  public switchMode(mode: DayNightMode): void {
    if (this._isAnimating) {
      this._animationCancelled = true;
    }

    if (mode === this._currentMode) return;

    this._currentMode = mode;
    buildingSystem.setNightMode(mode === 'night');

    const ambientLight = sceneManager.getAmbientLight();

    if (ambientLight) {
      if (mode === 'day') {
        this._animateAmbientLight(ambientLight, 0.1, 0.8, 500);
        this._animateSwitch('day');
      } else {
        this._animateAmbientLight(ambientLight, 0.8, 0.1, 500);
        this._animateSwitch('night');
      }
    }
  }

  public toggleMode(): DayNightMode {
    const nextMode = this._currentMode === 'day' ? 'night' : 'day';
    this.switchMode(nextMode);
    return nextMode;
  }

  private _animateAmbientLight(
    light: THREE.AmbientLight,
    from: number,
    to: number,
    duration: number
  ): void {
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeOut = 1 - Math.pow(1 - progress, 3);
      light.intensity = from + (to - from) * easeOut;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }

  private _animateSwitch(mode: DayNightMode): void {
    this._isAnimating = true;
    this._animationCancelled = false;

    const buildings = buildingSystem.getBuildings();
    
    const sortedBuildings = this._sortBuildingsByDistanceFromCenter(buildings);

    const interval = 100;
    let index = 0;

    const processNext = () => {
      if (this._animationCancelled) {
        this._isAnimating = false;
        return;
      }

      if (index >= sortedBuildings.length) {
        this._isAnimating = false;
        return;
      }

      const building = sortedBuildings[index];
      this._setBuildingLight(building, mode === 'night');

      index++;
      setTimeout(processNext, interval);
    };

    if (mode === 'night') {
      for (const building of sortedBuildings) {
        if (building.topLight) {
          building.topLight.intensity = 0;
          building.topLight.visible = true;
        }
      }
    }

    processNext();
  }

  private _sortBuildingsByDistanceFromCenter(buildings: BuildingData[]): BuildingData[] {
    return [...buildings].sort((a, b) => {
      const distA = Math.sqrt(a.position.x ** 2 + a.position.z ** 2);
      const distB = Math.sqrt(b.position.x ** 2 + b.position.z ** 2);
      return distA - distB;
    });
  }

  private _setBuildingLight(building: BuildingData, on: boolean): void {
    if (!building.topLight) return;

    const targetIntensity = on ? 2 : 0;
    const startIntensity = building.topLight.intensity;
    const duration = 300;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeOut = 1 - Math.pow(1 - progress, 3);
      building.topLight.intensity = startIntensity + (targetIntensity - startIntensity) * easeOut;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (!on) {
          building.topLight.visible = false;
        }
      }
    };

    requestAnimationFrame(animate);
  }

  public setAllLightsImmediate(mode: DayNightMode): void {
    const buildings = buildingSystem.getBuildings();
    
    for (const building of buildings) {
      if (building.topLight) {
        building.topLight.visible = mode === 'night';
        building.topLight.intensity = mode === 'night' ? 2 : 0;
      }
    }

    const ambientLight = sceneManager.getAmbientLight();
    if (ambientLight) {
      ambientLight.intensity = mode === 'day' ? 0.8 : 0.1;
    }
  }

  public pauseAnimation(): void {
    this._animationCancelled = true;
  }

  public resumeAnimation(): void {
    if (this._animationCancelled) {
      this._animationCancelled = false;
      this._animateSwitch(this._currentMode);
    }
  }

  public updateBuildingLight(building: BuildingData): void {
    if (!building.topLight) return;

    if (this._currentMode === 'night') {
      building.topLight.visible = true;
      building.topLight.intensity = 2;
    } else {
      building.topLight.visible = false;
      building.topLight.intensity = 0;
    }
  }

  public getAnimationProgress(): number {
    return this._animationProgress;
  }
}

export const lightingController = LightingController.instance;
