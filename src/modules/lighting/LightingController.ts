import { sceneManager } from '../../core/SceneManager';
import { buildingSystem, BuildingData } from '../building/BuildingSystem';
import * as THREE from 'three';

export type DayNightMode = 'day' | 'night';

const AMBIENT_INTENSITY: Record<DayNightMode, number> = {
  day: 0.8,
  night: 0.1,
};

const TOP_LIGHT_ON_INTENSITY = 2;
const TOP_LIGHT_OFF_INTENSITY = 0;

export class LightingController {
  private static _instance: LightingController;
  private _currentMode: DayNightMode = 'day';
  private _isAnimating: boolean = false;
  private _animationProgress: number = 0;
  private _animationGeneration: number = 0;

  private constructor() {
    buildingSystem.onChange((event) => {
      if (event.type === 'add') {
        // 新增建筑（含切换动画进行中）立即收敛到目标模式的灯光状态
        this.updateBuildingLight(event.building);
      }
    });
  }

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
    if (mode === this._currentMode) return;

    this._currentMode = mode;
    buildingSystem.setNightMode(mode === 'night');

    const generation = ++this._animationGeneration;

    const ambientLight = sceneManager.getAmbientLight();
    if (ambientLight) {
      this._animateAmbientLight(
        ambientLight,
        ambientLight.intensity,
        AMBIENT_INTENSITY[mode],
        500,
        generation
      );
    }

    this._animateSwitch(mode, generation);
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
    duration: number,
    generation: number
  ): void {
    const startTime = performance.now();

    const animate = () => {
      if (generation !== this._animationGeneration) return;

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

  private _animateSwitch(mode: DayNightMode, generation: number): void {
    this._isAnimating = true;
    this._animationProgress = 0;

    const buildings = buildingSystem.getBuildings();
    
    const sortedBuildings = this._sortBuildingsByDistanceFromCenter(buildings);
    const total = sortedBuildings.length;

    const interval = 100;
    let index = 0;

    const processNext = () => {
      if (generation !== this._animationGeneration) {
        return;
      }

      if (index >= total) {
        this._isAnimating = false;
        this._animationProgress = 1;
        return;
      }

      const building = sortedBuildings[index];
      // 动画进行中建筑可能已被删除，跳过不存在的建筑
      if (buildingSystem.getBuildingById(building.id)) {
        this._setBuildingLight(building, mode === 'night', generation);
      }

      index++;
      this._animationProgress = total === 0 ? 1 : index / total;
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

  private _setBuildingLight(building: BuildingData, on: boolean, generation: number): void {
    if (!building.topLight) return;

    const targetIntensity = on ? TOP_LIGHT_ON_INTENSITY : TOP_LIGHT_OFF_INTENSITY;
    const startIntensity = building.topLight.intensity;
    const duration = 300;
    const startTime = performance.now();

    const animate = () => {
      if (generation !== this._animationGeneration) return;
      // 建筑在动画期间被删除时停止对其顶灯的写操作
      if (!buildingSystem.getBuildingById(building.id)) return;
      if (!building.topLight) return;

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
    this._currentMode = mode;
    this._animationGeneration++;
    this._isAnimating = false;
    this._animationProgress = 1;

    buildingSystem.setNightMode(mode === 'night');

    const buildings = buildingSystem.getBuildings();
    
    for (const building of buildings) {
      if (building.topLight) {
        building.topLight.visible = mode === 'night';
        building.topLight.intensity = mode === 'night' ? TOP_LIGHT_ON_INTENSITY : TOP_LIGHT_OFF_INTENSITY;
      }
    }

    const ambientLight = sceneManager.getAmbientLight();
    if (ambientLight) {
      ambientLight.intensity = AMBIENT_INTENSITY[mode];
    }
  }

  public pauseAnimation(): void {
    this._animationGeneration++;
    this._isAnimating = false;
  }

  public resumeAnimation(): void {
    if (this._isAnimating) return;
    const generation = ++this._animationGeneration;
    this._animateSwitch(this._currentMode, generation);
  }

  public updateBuildingLight(building: BuildingData): void {
    if (!building.topLight) return;

    if (this._currentMode === 'night') {
      building.topLight.visible = true;
      building.topLight.intensity = TOP_LIGHT_ON_INTENSITY;
    } else {
      building.topLight.visible = false;
      building.topLight.intensity = TOP_LIGHT_OFF_INTENSITY;
    }
  }

  public getBuildingLightState(buildingId: string): boolean | null {
    const building = buildingSystem.getBuildingById(buildingId);
    if (!building) return null;
    // 返回目标模式下的最终灯光状态，而非切换动画的中间态
    return this._currentMode === 'night';
  }

  public getAnimationProgress(): number {
    return this._animationProgress;
  }
}

export const lightingController = LightingController.instance;
