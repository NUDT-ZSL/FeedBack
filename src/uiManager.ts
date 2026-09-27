import * as THREE from 'three';
import type { MoleculeData, AtomData } from './moleculeData';

export interface UIManagerCallbacks {
  onMoleculeSelect: (moleculeId: string) => void;
  onBack: () => void;
  onToggleView: () => void;
}

export class UIManager {
  private moleculeCards: HTMLElement;
  private infoPanel: HTMLElement;
  private panelTitle: HTMLElement;
  private bondList: HTMLElement;
  private toggleViewBtn: HTMLElement;
  private backBtn: HTMLElement;
  private mobileTab: HTMLElement;
  private fpsCounter: HTMLElement;
  private atomLabel: HTMLElement | null = null;
  private callbacks: UIManagerCallbacks;
  private isMobile: boolean;
  private panelCollapsed: boolean = false;

  constructor(callbacks: UIManagerCallbacks) {
    this.callbacks = callbacks;
    this.isMobile = window.innerWidth < 768;

    this.moleculeCards = document.getElementById('molecule-cards')!;
    this.infoPanel = document.getElementById('info-panel')!;
    this.panelTitle = document.getElementById('panel-title')!;
    this.bondList = document.getElementById('bond-list')!;
    this.toggleViewBtn = document.getElementById('toggle-view-btn')!;
    this.backBtn = document.getElementById('back-btn')!;
    this.mobileTab = document.getElementById('mobile-tab')!;
    this.fpsCounter = document.getElementById('fps-counter')!;

    this.bindEvents();
    window.addEventListener('resize', () => this.handleResize());
  }

  private bindEvents(): void {
    const cards = this.moleculeCards.querySelectorAll('.molecule-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const moleculeId = card.getAttribute('data-molecule');
        if (moleculeId) {
          this.callbacks.onMoleculeSelect(moleculeId);
        }
      });
    });

    this.backBtn.addEventListener('click', () => {
      this.callbacks.onBack();
    });

    this.toggleViewBtn.addEventListener('click', () => {
      this.callbacks.onToggleView();
    });

    this.mobileTab.addEventListener('click', () => {
      this.toggleMobilePanel();
    });
  }

  private handleResize(): void {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth < 768;

    if (wasMobile !== this.isMobile && this.infoPanel.classList.contains('visible')) {
      if (this.isMobile) {
        this.mobileTab.classList.add('visible');
        this.infoPanel.classList.remove('mobile-collapsed');
      } else {
        this.mobileTab.classList.remove('visible');
        this.infoPanel.classList.remove('mobile-collapsed');
      }
    }
  }

  private toggleMobilePanel(): void {
    this.panelCollapsed = !this.panelCollapsed;
    if (this.panelCollapsed) {
      this.infoPanel.classList.add('mobile-collapsed');
      this.mobileTab.querySelector('#mobile-tab-text')!.textContent = '▲ 分子信息';
    } else {
      this.infoPanel.classList.remove('mobile-collapsed');
      this.mobileTab.querySelector('#mobile-tab-text')!.textContent = '▼ 分子信息';
    }
  }

  showMoleculeView(moleculeData: MoleculeData): void {
    this.moleculeCards.classList.add('hidden');
    this.infoPanel.classList.add('visible');
    this.backBtn.classList.add('visible');

    if (this.isMobile) {
      this.mobileTab.classList.add('visible');
      this.panelCollapsed = false;
      this.infoPanel.classList.remove('mobile-collapsed');
    }

    this.updatePanelContent(moleculeData);
  }

  hideMoleculeView(): void {
    this.moleculeCards.classList.remove('hidden');
    this.infoPanel.classList.remove('visible');
    this.backBtn.classList.remove('visible');
    this.mobileTab.classList.remove('visible');
    this.hideAtomLabel();
  }

  updatePanelContent(moleculeData: MoleculeData): void {
    this.panelTitle.textContent = moleculeData.displayName;

    this.bondList.innerHTML = '';
    moleculeData.bonds.forEach(bond => {
      const item = document.createElement('div');
      item.className = 'bond-item';
      item.innerHTML = `
        <span class="bond-label">${bond.label}</span>
        <span>
          <span class="bond-length">${bond.length.toFixed(3)}</span>
          <span class="bond-unit">Å</span>
        </span>
      `;
      this.bondList.appendChild(item);
    });
  }

  showAtomLabel(
    atomData: AtomData,
    screenX: number,
    screenY: number,
    atomIndex: number
  ): void {
    this.hideAtomLabel();

    this.atomLabel = document.createElement('div');
    this.atomLabel.className = 'atom-label';

    const posStr = `(${atomData.position[0].toFixed(2)}, ${atomData.position[1].toFixed(2)}, ${atomData.position[2].toFixed(2)})`;

    this.atomLabel.innerHTML = `
      <div class="atom-label-element">${atomData.symbol}</div>
      <div class="atom-label-info">
        原子序号: ${atomData.atomicNumber}<br>
        分子内位置: 第 ${atomIndex + 1} 位<br>
        坐标: ${posStr}
      </div>
    `;

    this.atomLabel.style.left = `${screenX}px`;
    this.atomLabel.style.top = `${screenY - 70}px`;

    document.getElementById('app')!.appendChild(this.atomLabel);

    requestAnimationFrame(() => {
      this.atomLabel?.classList.add('visible');
    });
  }

  hideAtomLabel(): void {
    if (this.atomLabel) {
      this.atomLabel.classList.remove('visible');
      this.atomLabel.classList.add('hiding');
      const label = this.atomLabel;
      setTimeout(() => {
        label.remove();
      }, 200);
      this.atomLabel = null;
    }
  }

  updateAtomLabelPosition(screenX: number, screenY: number): void {
    if (this.atomLabel && this.atomLabel.classList.contains('visible')) {
      this.atomLabel.style.left = `${screenX}px`;
      this.atomLabel.style.top = `${screenY - 70}px`;
    }
  }

  updateFPS(fps: number): void {
    this.fpsCounter.textContent = `${fps.toFixed(0)} FPS`;
  }

  getScreenPosition(
    worldPos: THREE.Vector3,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): { x: number; y: number } {
    const vector = worldPos.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top
    };
  }
}
