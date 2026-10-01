import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Molecule, ELEMENT_NUMBERS, ELEMENT_NAMES, ElementType } from './molecule';
import { Controls } from './controls';

class App {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private molecule: Molecule;
  private gui: Controls;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  private hudEl: HTMLElement;
  private fpsEl: HTMLElement;
  private selectionInfoEl: HTMLElement;
  private selectionValueEl: HTMLElement;
  private atomLabelEl: HTMLElement;
  private radialMenuEl: HTMLElement;
  private menuTitleEl: HTMLElement;
  private deleteBtnEl: HTMLElement;

  private lastTime: number = performance.now();
  private frameCount: number = 0;
  private fps: number = 0;
  private hudFadeTimer: number | null = null;

  private hoveredAtomId: number | null = null;
  private rightClickPosition: THREE.Vector3 | null = null;
  private rightClickAtomId: number | null = null;
  private pendingBondAtomId: number | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a2a);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 2, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 50;

    this.setupLighting();
    this.setupPostProcessing();

    this.molecule = new Molecule(this.scene);
    this.gui = new Controls(this.molecule, this.scene);

    this.hudEl = document.getElementById('hud') as HTMLElement;
    this.fpsEl = document.getElementById('fps') as HTMLElement;
    this.selectionInfoEl = document.getElementById('selection-info') as HTMLElement;
    this.selectionValueEl = document.getElementById('selection-value') as HTMLElement;
    this.atomLabelEl = document.getElementById('atom-label') as HTMLElement;
    this.radialMenuEl = document.getElementById('radial-menu') as HTMLElement;
    this.menuTitleEl = document.getElementById('menu-title') as HTMLElement;
    this.deleteBtnEl = document.getElementById('delete-btn') as HTMLElement;

    this.setupEventListeners();
    this.animate();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(-5, 5, 3);
    this.scene.add(directionalLight);
  }

  private setupPostProcessing(): void {
    this.composer = new EffectComposer(this.renderer);
    
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3,
      0.4,
      0.85
    );
    this.composer.addPass(this.bloomPass);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.onWindowResize());

    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));
    this.renderer.domElement.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.renderer.domElement.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('click', (e) => this.onDocumentClick(e));

    const menuItems = this.radialMenuEl.querySelectorAll('#menu-items button');
    menuItems.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const element = (e.target as HTMLElement).dataset.element as ElementType;
        if (element && this.rightClickPosition) {
          this.molecule.addAtom(this.rightClickPosition, element, true);
        }
        this.hideRadialMenu();
      });
    });

    this.deleteBtnEl.addEventListener('click', () => {
      if (this.rightClickAtomId !== null) {
        this.molecule.removeAtom(this.rightClickAtomId);
      }
      this.hideRadialMenu();
    });
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private onMouseMove(e: MouseEvent): void {
    const atom = this.molecule.getAtomAtScreenPosition(
      e.clientX,
      e.clientY,
      this.camera,
      this.renderer
    );

    if (atom) {
      if (this.hoveredAtomId !== atom.id) {
        this.hoveredAtomId = atom.id;
        this.molecule.setHoveredAtom(atom.id);
        this.showHUD(atom);
        this.showAtomLabel(atom, e.clientX, e.clientY);
      } else {
        this.updateAtomLabelPosition(atom);
      }
    } else {
      if (this.hoveredAtomId !== null) {
        this.hoveredAtomId = null;
        this.molecule.setHoveredAtom(null);
        this.hideHUD();
        this.hideAtomLabel();
      }
    }
  }

  private onClick(e: MouseEvent): void {
    if (e.button !== 0) return;

    const atom = this.molecule.getAtomAtScreenPosition(
      e.clientX,
      e.clientY,
      this.camera,
      this.renderer
    );
    
    if (atom) {
      if (this.pendingBondAtomId !== null && this.pendingBondAtomId !== atom.id) {
        this.molecule.addBond(this.pendingBondAtomId, atom.id, 1, true);
        this.pendingBondAtomId = null;
      } else {
        const selectedAtom = this.molecule.getSelectedAtom();
        if (selectedAtom && selectedAtom.id === atom.id) {
          this.molecule.selectAtom(null);
          this.hideSelectionInfo();
        } else {
          this.molecule.selectAtom(atom.id);
          this.showSelectionInfo(atom);
        }
      }
    } else {
      this.molecule.selectAtom(null);
      this.pendingBondAtomId = null;
      this.hideSelectionInfo();
    }
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();

    const atom = this.molecule.getAtomAtScreenPosition(
      e.clientX,
      e.clientY,
      this.camera,
      this.renderer
    );

    this.radialMenuEl.style.display = 'block';
    this.radialMenuEl.style.left = `${e.clientX}px`;
    this.radialMenuEl.style.top = `${e.clientY}px`;

    if (atom) {
      this.rightClickAtomId = atom.id;
      this.rightClickPosition = null;
      this.menuTitleEl.textContent = `操作: ${atom.element}${ELEMENT_NUMBERS[atom.element]}`;
      this.deleteBtnEl.style.display = 'block';
    } else {
      this.rightClickAtomId = null;
      this.rightClickPosition = this.molecule.worldPositionFromScreen(
        e.clientX,
        e.clientY,
        this.camera,
        this.renderer,
        5
      );
      this.menuTitleEl.textContent = '添加原子';
      this.deleteBtnEl.style.display = 'none';
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    const bond = this.molecule.getBondAtScreenPosition(
      e.clientX,
      e.clientY,
      this.camera,
      this.renderer
    );

    if (bond) {
      this.molecule.toggleBondType(bond.id);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selectedAtom = this.molecule.getSelectedAtom();
      if (selectedAtom) {
        this.molecule.removeAtom(selectedAtom.id);
        this.hideSelectionInfo();
      }
    }

    if (e.key === 'b' || e.key === 'B') {
      const selectedAtom = this.molecule.getSelectedAtom();
      if (selectedAtom) {
        if (this.pendingBondAtomId === null) {
          this.pendingBondAtomId = selectedAtom.id;
        } else {
          this.pendingBondAtomId = null;
        }
      }
    }

    if (e.key === 'Escape') {
      this.pendingBondAtomId = null;
      this.molecule.selectAtom(null);
      this.hideSelectionInfo();
      this.hideRadialMenu();
    }
  }

  private onDocumentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!this.radialMenuEl.contains(target) && target !== this.renderer.domElement) {
      this.hideRadialMenu();
    }
  }

  private showHUD(atom: { element: ElementType; position: THREE.Vector3; id: number }): void {
    if (this.hudFadeTimer !== null) {
      clearTimeout(this.hudFadeTimer);
      this.hudFadeTimer = null;
    }
    
    const number = ELEMENT_NUMBERS[atom.element];
    this.hudEl.innerHTML = `
      <div style="margin-bottom:5px;font-weight:bold;">
        ${atom.element}<span style="color:#4fc3f7;">${number}</span> 
        <span style="color:#aaa;font-size:12px;">(${ELEMENT_NAMES[atom.element]})</span>
      </div>
      <div style="font-size:12px;color:#ccc;">
        x: ${atom.position.x.toFixed(2)} 
        y: ${atom.position.y.toFixed(2)} 
        z: ${atom.position.z.toFixed(2)}
      </div>
    `;
    this.hudEl.classList.add('visible');
  }

  private hideHUD(): void {
    if (this.hudFadeTimer !== null) {
      clearTimeout(this.hudFadeTimer);
    }
    this.hudFadeTimer = window.setTimeout(() => {
      this.hudEl.classList.remove('visible');
      this.hudFadeTimer = null;
    }, 200);
  }

  private showAtomLabel(atom: { element: ElementType; position: THREE.Vector3 }, _screenX: number, _screenY: number): void {
    const number = ELEMENT_NUMBERS[atom.element];
    this.atomLabelEl.textContent = `${atom.element}${number}`;
    this.atomLabelEl.style.display = 'block';
    this.updateAtomLabelPosition(atom);
  }

  private updateAtomLabelPosition(atom: { position: THREE.Vector3; element: ElementType }): void {
    const screenPos = this.molecule.screenPositionFromWorld(
      atom.position,
      this.camera,
      this.renderer
    );

    if (screenPos.visible) {
      const dist = this.camera.position.distanceTo(atom.position);
      const fontSize = Math.max(10, Math.min(24, 200 / dist));
      this.atomLabelEl.style.fontSize = `${fontSize}px`;
      this.atomLabelEl.style.left = `${screenPos.x + 15}px`;
      this.atomLabelEl.style.top = `${screenPos.y - 10}px`;
      this.atomLabelEl.style.display = 'block';
    } else {
      this.atomLabelEl.style.display = 'none';
    }
  }

  private hideAtomLabel(): void {
    this.atomLabelEl.style.display = 'none';
  }

  private showSelectionInfo(atom: { element: ElementType; position: THREE.Vector3 }): void {
    const number = ELEMENT_NUMBERS[atom.element];
    this.selectionValueEl.innerHTML = `
      <div style="margin-bottom:8px;">
        <span style="font-size:20px;font-weight:bold;">${atom.element}</span>
        <span style="color:#4fc3f7;">${number}</span>
        <span style="color:#aaa;margin-left:8px;">${ELEMENT_NAMES[atom.element]}</span>
      </div>
      <div style="font-size:12px;color:#ccc;">
        x: ${atom.position.x.toFixed(2)}<br>
        y: ${atom.position.y.toFixed(2)}<br>
        z: ${atom.position.z.toFixed(2)}
      </div>
    `;
    this.selectionInfoEl.classList.add('visible');
  }

  private hideSelectionInfo(): void {
    this.selectionInfoEl.classList.remove('visible');
  }

  private hideRadialMenu(): void {
    this.radialMenuEl.style.display = 'none';
    this.rightClickPosition = null;
    this.rightClickAtomId = null;
  }

  private updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastTime;

    if (elapsed >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastTime = now;
      this.fpsEl.textContent = `FPS: ${this.fps}`;
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    const autoRotateSpeed = this.gui.settings.autoRotateSpeed;
    if (autoRotateSpeed > 0) {
      this.molecule.group.rotation.y += autoRotateSpeed * 0.01;
    }

    this.controls.update();
    this.molecule.update();

    this.updateFPS();
    this.updateSelectionInfoPosition();

    this.composer.render();
  }

  private updateSelectionInfoPosition(): void {
    const selectedAtom = this.molecule.getSelectedAtom();
    const hoveredAtom = this.molecule.getHoveredAtom();

    if (hoveredAtom) {
      this.updateAtomLabelPosition(hoveredAtom);
    }

    if (selectedAtom) {
      this.showSelectionInfo(selectedAtom);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
