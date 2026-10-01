import GUI from 'lil-gui';
import { Molecule, MoleculeSettings } from './molecule';
import * as THREE from 'three';

export interface ControlSettings extends MoleculeSettings {
  autoRotateSpeed: number;
  backgroundColor: { r: number; g: number; b: number };
}

const DEFAULT_SETTINGS: ControlSettings = {
  globalScale: 1.0,
  showHydrogen: true,
  autoRotateSpeed: 0,
  backgroundColor: { r: 0.039, g: 0.039, b: 0.165 },
  atomOpacity: 1.0
};

const HASH_KEY = 'molecule-settings';

export class Controls {
  public gui: GUI;
  public settings: ControlSettings;
  private molecule: Molecule;
  private scene: THREE.Scene;
  private onChangeCallback?: () => void;

  constructor(molecule: Molecule, scene: THREE.Scene) {
    this.molecule = molecule;
    this.scene = scene;
    this.settings = { ...DEFAULT_SETTINGS };
    this.loadFromHash();
    
    this.gui = new GUI({ title: '控制面板' });
    this.gui.domElement.style.position = 'fixed';
    this.gui.domElement.style.top = '20px';
    this.gui.domElement.style.left = '20px';
    
    this.buildGUI();
    this.applySettings();
    this.setupSliderEffects();
  }

  private buildGUI(): void {
    this.gui.add(this.settings, 'globalScale', 0.5, 3.0, 0.01)
      .name('全局缩放')
      .onChange(() => this.applyChange());

    this.gui.add(this.settings, 'showHydrogen')
      .name('显示氢原子')
      .onChange(() => this.applyChange());

    this.gui.add(this.settings, 'autoRotateSpeed', 0, 0.5, 0.01)
      .name('自动旋转速度')
      .onChange(() => this.applyChange());

    this.gui.add(this.settings, 'atomOpacity', 0.2, 1.0, 0.01)
      .name('原子透明度')
      .onChange(() => this.applyChange());

    const bgFolder = this.gui.addFolder('背景色');
    bgFolder.add(this.settings.backgroundColor, 'r', 0, 1, 0.01)
      .name('R')
      .onChange(() => this.applyBackgroundChange());
    bgFolder.add(this.settings.backgroundColor, 'g', 0, 1, 0.01)
      .name('G')
      .onChange(() => this.applyBackgroundChange());
    bgFolder.add(this.settings.backgroundColor, 'b', 0, 1, 0.01)
      .name('B')
      .onChange(() => this.applyBackgroundChange());
  }

  private setupSliderEffects(): void {
    const sliders = this.gui.domElement.querySelectorAll('.slider');
    sliders.forEach(slider => {
      slider.addEventListener('mousedown', () => {
        slider.classList.add('active');
      });
      slider.addEventListener('mouseup', () => {
        slider.classList.remove('active');
      });
      slider.addEventListener('mouseleave', () => {
        slider.classList.remove('active');
      });
    });
  }

  private applyChange(): void {
    this.molecule.settings.globalScale = this.settings.globalScale;
    this.molecule.settings.showHydrogen = this.settings.showHydrogen;
    this.molecule.settings.atomOpacity = this.settings.atomOpacity;
    this.molecule.update();
    this.saveToHash();
    this.onChangeCallback?.();
  }

  private applyBackgroundChange(): void {
    const color = new THREE.Color(
      this.settings.backgroundColor.r,
      this.settings.backgroundColor.g,
      this.settings.backgroundColor.b
    );
    this.scene.background = color;
    this.saveToHash();
  }

  private applySettings(): void {
    this.molecule.settings.globalScale = this.settings.globalScale;
    this.molecule.settings.showHydrogen = this.settings.showHydrogen;
    this.molecule.settings.atomOpacity = this.settings.atomOpacity;
    this.applyBackgroundChange();
    this.molecule.update();
  }

  private loadFromHash(): void {
    try {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      
      const params = new URLSearchParams(hash);
      const saved = params.get(HASH_KEY);
      if (saved) {
        const parsed = JSON.parse(decodeURIComponent(saved));
        this.settings = { ...this.settings, ...parsed };
      }
    } catch {
      // Ignore parse errors
    }
  }

  private saveToHash(): void {
    try {
      const params = new URLSearchParams(window.location.hash.slice(1));
      params.set(HASH_KEY, encodeURIComponent(JSON.stringify(this.settings)));
      window.location.hash = params.toString();
    } catch {
      // Ignore save errors
    }
  }

  public onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  public destroy(): void {
    this.gui.destroy();
  }
}
