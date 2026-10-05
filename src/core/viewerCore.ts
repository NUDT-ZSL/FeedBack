import * as THREE from 'three';
import type { MoleculeData } from '../moleculeData';
import { CameraTween, VIEW_TWEEN_DURATION_MS, type CameraTweenSample } from './cameraTween';
import { buildMoleculeSpec, type MoleculeSpec } from './moleculeGeometry';
import {
  screenToNdc,
  worldToScreen,
  labelAnchor,
  type ScreenPoint,
  type Viewport
} from './projection';
import { pickAtom } from './picking';

export type ViewerMode = 'selection' | 'viewing';

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 0, 8];
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 0, 0];

export type ClickOutcome =
  | { kind: 'select'; atomIndex: number }
  | { kind: 'deselect'; atomIndex: number }
  | { kind: 'clear' }
  | { kind: 'none' };

export class ViewerCore {
  mode: ViewerMode = 'selection';
  molecule: MoleculeData | null = null;
  spec: MoleculeSpec | null = null;
  selectedAtomIndex: number | null = null;
  hoveredAtomIndex: number | null = null;
  tween: CameraTween | null = null;
  viewport: Viewport;

  constructor(viewport: Viewport = { left: 0, top: 0, width: 0, height: 0 }) {
    this.viewport = { ...viewport };
  }

  get isTweening(): boolean {
    return this.tween !== null;
  }

  selectMolecule(molecule: MoleculeData): void {
    this.molecule = molecule;
    this.spec = buildMoleculeSpec(molecule);
    this.mode = 'viewing';
    this.selectedAtomIndex = null;
    this.hoveredAtomIndex = null;
    this.tween = null;
  }

  back(): void {
    this.mode = 'selection';
    this.molecule = null;
    this.spec = null;
    this.selectedAtomIndex = null;
    this.hoveredAtomIndex = null;
    this.tween = null;
  }

  toggleView(
    currentPosition: THREE.Vector3,
    currentTarget: THREE.Vector3,
    durationMs: number = VIEW_TWEEN_DURATION_MS
  ): CameraTween | null {
    if (!this.molecule || this.tween) return null;

    const bestAngle = this.molecule.bestViewAngle;
    this.tween = new CameraTween(
      currentPosition,
      new THREE.Vector3(bestAngle[0], bestAngle[1], bestAngle[2]),
      currentTarget,
      new THREE.Vector3(...DEFAULT_CAMERA_TARGET),
      durationMs
    );
    return this.tween;
  }

  tick(deltaMs: number): CameraTweenSample | null {
    if (!this.tween) return null;
    const sample = this.tween.advance(deltaMs);
    if (sample.done) {
      this.tween = null;
    }
    return sample;
  }

  clickAt(clientX: number, clientY: number, camera: THREE.Camera): ClickOutcome {
    if (!this.modeIsViewing()) return { kind: 'none' };
    const atomIndex = this.pick(clientX, clientY, camera);

    if (atomIndex >= 0) {
      if (this.selectedAtomIndex === atomIndex) {
        this.selectedAtomIndex = null;
        return { kind: 'deselect', atomIndex };
      }
      this.selectedAtomIndex = atomIndex;
      return { kind: 'select', atomIndex };
    }

    if (this.selectedAtomIndex !== null) {
      this.selectedAtomIndex = null;
      return { kind: 'clear' };
    }
    return { kind: 'none' };
  }

  hoverAt(clientX: number, clientY: number, camera: THREE.Camera): number | null {
    if (!this.modeIsViewing()) return null;
    const atomIndex = this.pick(clientX, clientY, camera);
    this.hoveredAtomIndex = atomIndex >= 0 ? atomIndex : null;
    return this.hoveredAtomIndex;
  }

  selectedLabelAnchor(camera: THREE.Camera): ScreenPoint | null {
    if (this.selectedAtomIndex === null || !this.spec) return null;
    const atom = this.spec.atoms[this.selectedAtomIndex];
    const worldPos = new THREE.Vector3(...atom.position);
    return labelAnchor(worldToScreen(worldPos, camera, this.viewport));
  }

  atomScreenPosition(atomIndex: number, camera: THREE.Camera): ScreenPoint | null {
    if (!this.spec || atomIndex < 0 || atomIndex >= this.spec.atoms.length) return null;
    const atom = this.spec.atoms[atomIndex];
    return worldToScreen(new THREE.Vector3(...atom.position), camera, this.viewport);
  }

  selectedAtomScreenPosition(camera: THREE.Camera): ScreenPoint | null {
    if (this.selectedAtomIndex === null) return null;
    return this.atomScreenPosition(this.selectedAtomIndex, camera);
  }

  setViewport(viewport: Viewport): void {
    this.viewport = { ...viewport };
  }

  private modeIsViewing(): boolean {
    return this.mode === 'viewing' && this.spec !== null;
  }

  private pick(clientX: number, clientY: number, camera: THREE.Camera): number {
    if (!this.spec) return -1;
    const ndc = screenToNdc(clientX, clientY, this.viewport);
    return pickAtom(
      ndc,
      camera,
      this.spec.atoms.map(atom => ({ position: atom.position, radius: atom.radius }))
    );
  }
}
