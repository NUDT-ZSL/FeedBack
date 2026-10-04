import type { MoleculeData } from '../moleculeData';
import { buildMoleculeModel, type MoleculeModel } from './moleculeGeometry';
import {
  createViewTween,
  sampleViewTween,
  DEFAULT_TWEEN_DURATION_MS,
  type ViewTween,
  type ViewTweenSample
} from './tween';
import { createCameraState, type CameraState } from './camera';
import {
  ndcFromClientPoint,
  pickAtom,
  type Rect
} from './picking';
import { worldToScreen, type ScreenPoint } from './projection';
import type { Vec3 } from './math3';

export type ViewerMode = 'cards' | 'molecule';

export interface LabelState {
  atomIndex: number;
  screen: ScreenPoint;
}

export type ClickAction = 'select' | 'deselect' | 'none' | 'ignore';

export interface ClickResult {
  hitIndex: number;
  selectedIndex: number | null;
  action: ClickAction;
}

export class ViewerCore {
  readonly camera: CameraState;
  readonly viewport: Rect;
  readonly labelVerticalOffsetPx: number = 70;

  private _mode: ViewerMode = 'cards';
  private _moleculeData: MoleculeData | null = null;
  private _molecule: MoleculeModel | null = null;
  private _tweening: boolean = false;
  private _selectedAtomIndex: number | null = null;
  private _hoveredAtomIndex: number | null = null;
  private tween: ViewTween | null = null;
  private tweenElapsedMs: number = 0;

  constructor(viewportWidth: number, viewportHeight: number) {
    this.viewport = { left: 0, top: 0, width: viewportWidth, height: viewportHeight };
    this.camera = createCameraState(viewportWidth / viewportHeight);
  }

  get mode(): ViewerMode {
    return this._mode;
  }

  get moleculeData(): MoleculeData | null {
    return this._moleculeData;
  }

  get molecule(): MoleculeModel | null {
    return this._molecule;
  }

  get tweening(): boolean {
    return this._tweening;
  }

  get selectedAtomIndex(): number | null {
    return this._selectedAtomIndex;
  }

  get hoveredAtomIndex(): number | null {
    return this._hoveredAtomIndex;
  }

  get cursor(): string {
    return this._hoveredAtomIndex !== null && this._hoveredAtomIndex >= 0
      ? 'pointer'
      : 'default';
  }

  selectMolecule(data: MoleculeData): void {
    this._mode = 'molecule';
    this._moleculeData = data;
    this._molecule = buildMoleculeModel(data);
    this.resetCamera();
    this.cancelTween();
    this._selectedAtomIndex = null;
    this._hoveredAtomIndex = null;
  }

  back(): void {
    this._mode = 'cards';
    this._moleculeData = null;
    this._molecule = null;
    this.cancelTween();
    this._selectedAtomIndex = null;
    this._hoveredAtomIndex = null;
  }

  toggleBestView(durationMs: number = DEFAULT_TWEEN_DURATION_MS): boolean {
    if (this._mode !== 'molecule' || !this._moleculeData || this._tweening) {
      return false;
    }
    this.tween = createViewTween(
      this.camera.position,
      [...this._moleculeData.bestViewAngle],
      this.camera.target,
      [0, 0, 0],
      durationMs
    );
    this.tweenElapsedMs = 0;
    this._tweening = true;
    return true;
  }

  update(deltaTimeMs: number): ViewTweenSample | null {
    if (!this.tween) return null;
    this.tweenElapsedMs += deltaTimeMs;
    const sample = sampleViewTween(this.tween, this.tweenElapsedMs);
    this.camera.position = sample.position;
    this.camera.target = sample.target;
    if (sample.done) {
      this.cancelTween();
    }
    return sample;
  }

  syncCamera(position: Vec3, target: Vec3): void {
    this.camera.position = [...position];
    this.camera.target = [...target];
  }

  resize(width: number, height: number, left: number = 0, top: number = 0): void {
    this.viewport.width = width;
    this.viewport.height = height;
    this.viewport.left = left;
    this.viewport.top = top;
    this.camera.aspect = width / height;
  }

  setViewportRect(rect: Rect): void {
    this.viewport.left = rect.left;
    this.viewport.top = rect.top;
    this.viewport.width = rect.width;
    this.viewport.height = rect.height;
  }

  clickAt(clientX: number, clientY: number): ClickResult {
    if (this._mode !== 'molecule' || !this._molecule) {
      return { hitIndex: -1, selectedIndex: null, action: 'ignore' };
    }
    const hitIndex = this.pickAt(clientX, clientY);
    if (hitIndex < 0) {
      const hadSelection = this._selectedAtomIndex !== null;
      this._selectedAtomIndex = null;
      return { hitIndex: -1, selectedIndex: null, action: hadSelection ? 'deselect' : 'none' };
    }
    if (this._selectedAtomIndex === hitIndex) {
      this._selectedAtomIndex = null;
      return { hitIndex, selectedIndex: null, action: 'deselect' };
    }
    this._selectedAtomIndex = hitIndex;
    return { hitIndex, selectedIndex: hitIndex, action: 'select' };
  }

  pointerMove(clientX: number, clientY: number): number {
    if (this._mode !== 'molecule' || !this._molecule) {
      this._hoveredAtomIndex = null;
      return -1;
    }
    const hitIndex = this.pickAt(clientX, clientY);
    this._hoveredAtomIndex = hitIndex;
    return hitIndex;
  }

  getLabelState(worldPos?: Vec3): LabelState | null {
    if (this._selectedAtomIndex === null || !this._molecule) return null;
    const atom = this._molecule.atoms[this._selectedAtomIndex];
    const world: Vec3 = worldPos ?? atom.position;
    return {
      atomIndex: this._selectedAtomIndex,
      screen: worldToScreen(this.camera, this.viewport, world)
    };
  }

  private pickAt(clientX: number, clientY: number): number {
    if (!this._molecule) return -1;
    const ndc = ndcFromClientPoint(clientX, clientY, this.viewport);
    return pickAtom(this.camera, ndc, this._molecule.atoms);
  }

  private resetCamera(): void {
    const fresh = createCameraState(this.camera.aspect);
    this.camera.position = fresh.position;
    this.camera.target = fresh.target;
  }

  private cancelTween(): void {
    this.tween = null;
    this.tweenElapsedMs = 0;
    this._tweening = false;
  }
}
