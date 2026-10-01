import { CrystalScene } from './scene';
import { CRYSTALS, getCrystalById } from './crystal';

class UIController {
  private scene: CrystalScene;
  private currentCrystalId: string = 'sc';
  private axesVisible: boolean = false;
  private gridVisible: boolean = false;
  private isExploded: boolean = false;

  private leftPanel: HTMLElement;
  private rightPanel: HTMLElement;
  private crystalButtonsContainer: HTMLElement;
  private crystalNameEl: HTMLElement;
  private spaceGroupEl: HTMLElement;
  private latticeSlider: HTMLInputElement;
  private latticeValueEl: HTMLElement;
  private radiusSlider: HTMLInputElement;
  private radiusValueEl: HTMLElement;
  private toggleAxes: HTMLElement;
  private switchAxes: HTMLElement;
  private toggleGrid: HTMLElement;
  private switchGrid: HTMLElement;
  private btnExplode: HTMLElement;
  private atomLabel: HTMLElement;
  private labelName: HTMLElement;
  private labelPos: HTMLElement;
  private menuToggle: HTMLElement;
  private panelOverlay: HTMLElement;

  constructor() {
    const container = document.getElementById('canvas-container')!;
    this.scene = new CrystalScene(container, {
      onAtomClick: this.handleAtomClick.bind(this),
      onBackgroundClick: this.handleBackgroundClick.bind(this)
    });

    this.leftPanel = document.getElementById('left-panel')!;
    this.rightPanel = document.getElementById('right-panel')!;
    this.crystalButtonsContainer = document.getElementById('crystal-buttons')!;
    this.crystalNameEl = document.getElementById('crystal-name')!;
    this.spaceGroupEl = document.getElementById('space-group')!;
    this.latticeSlider = document.getElementById('lattice-slider') as HTMLInputElement;
    this.latticeValueEl = document.getElementById('lattice-value')!;
    this.radiusSlider = document.getElementById('radius-slider') as HTMLInputElement;
    this.radiusValueEl = document.getElementById('radius-value')!;
    this.toggleAxes = document.getElementById('toggle-axes')!;
    this.switchAxes = document.getElementById('switch-axes')!;
    this.toggleGrid = document.getElementById('toggle-grid')!;
    this.switchGrid = document.getElementById('switch-grid')!;
    this.btnExplode = document.getElementById('btn-explode')!;
    this.atomLabel = document.getElementById('atom-label')!;
    this.labelName = document.getElementById('label-name')!;
    this.labelPos = document.getElementById('label-pos')!;
    this.menuToggle = document.getElementById('menu-toggle')!;
    this.panelOverlay = document.getElementById('panel-overlay')!;

    this.buildCrystalButtons();
    this.bindEvents();
    this.loadCrystal('sc');
  }

  private buildCrystalButtons(): void {
    this.crystalButtonsContainer.innerHTML = '';
    CRYSTALS.forEach(crystal => {
      const btn = document.createElement('button');
      btn.className = 'crystal-btn';
      btn.dataset.crystalId = crystal.id;
      btn.innerHTML = `
        <span class="abbr">${crystal.abbr}</span>
        <span class="full">${crystal.name}</span>
      `;
      btn.addEventListener('click', () => this.loadCrystal(crystal.id));
      this.crystalButtonsContainer.appendChild(btn);
    });
  }

  private bindEvents(): void {
    this.latticeSlider.addEventListener('input', () => {
      const val = parseFloat(this.latticeSlider.value);
      this.latticeValueEl.textContent = val.toFixed(2);
      this.scene.setLatticeConstant(val, true);
    });

    this.radiusSlider.addEventListener('input', () => {
      const val = parseFloat(this.radiusSlider.value);
      this.radiusValueEl.textContent = val.toFixed(2);
      this.scene.setAtomRadiusScale(val, true);
    });

    this.toggleAxes.addEventListener('click', () => {
      this.axesVisible = !this.axesVisible;
      this.switchAxes.classList.toggle('on', this.axesVisible);
      this.scene.setAxesVisible(this.axesVisible);
    });

    this.toggleGrid.addEventListener('click', () => {
      this.gridVisible = !this.gridVisible;
      this.switchGrid.classList.toggle('on', this.gridVisible);
      this.scene.setGridVisible(this.gridVisible);
    });

    this.btnExplode.addEventListener('click', () => {
      this.isExploded = !this.isExploded;
      this.btnExplode.classList.toggle('active', this.isExploded);
      this.btnExplode.textContent = this.isExploded ? '恢复视图' : '爆炸视图';
      this.scene.toggleExplodedView();
    });

    this.menuToggle.addEventListener('click', () => {
      this.leftPanel.classList.toggle('open');
      this.rightPanel.classList.toggle('open');
      this.panelOverlay.classList.toggle('show');
    });

    this.panelOverlay.addEventListener('click', () => {
      this.leftPanel.classList.remove('open');
      this.rightPanel.classList.remove('open');
      this.panelOverlay.classList.remove('show');
    });
  }

  private loadCrystal(id: string): void {
    const crystal = getCrystalById(id);
    if (!crystal) return;

    this.currentCrystalId = id;

    const buttons = this.crystalButtonsContainer.querySelectorAll('.crystal-btn');
    buttons.forEach(btn => {
      const el = btn as HTMLElement;
      el.classList.toggle('active', el.dataset.crystalId === id);
    });

    this.crystalNameEl.textContent = crystal.name;
    this.spaceGroupEl.textContent = `空间群: ${crystal.spaceGroup}`;

    this.latticeSlider.value = crystal.latticeConstant.toString();
    this.latticeValueEl.textContent = crystal.latticeConstant.toFixed(2);

    this.isExploded = false;
    this.btnExplode.classList.remove('active');
    this.btnExplode.textContent = '爆炸视图';

    this.hideAtomLabel();
    this.scene.clearAtomSelection();
    this.scene.loadCrystal(crystal);
  }

  private handleAtomClick(
    atomId: string,
    screenPos: { x: number; y: number },
    info: { name: string; position: [number, number, number] }
  ): void {
    this.labelName.textContent = this.getElementName(info.name);
    this.labelPos.textContent = `(${info.position[0]}, ${info.position[1]}, ${info.position[2]})`;

    this.atomLabel.style.display = 'block';
    const labelWidth = this.atomLabel.offsetWidth;
    const labelHeight = this.atomLabel.offsetHeight;

    let x = screenPos.x - labelWidth / 2;
    let y = screenPos.y - labelHeight - 18;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    x = Math.max(8, Math.min(vw - labelWidth - 8, x));
    y = Math.max(8, y);

    this.atomLabel.style.left = `${x}px`;
    this.atomLabel.style.top = `${y}px`;
  }

  private getElementName(elem: string): string {
    const names: Record<string, string> = {
      'metal': '金属原子',
      'Na': '钠 (Na)',
      'Cl': '氯 (Cl)',
      'C': '碳 (C)'
    };
    return names[elem] || elem;
  }

  private handleBackgroundClick(): void {
    this.hideAtomLabel();
  }

  private hideAtomLabel(): void {
    this.atomLabel.style.display = 'none';
  }

  dispose(): void {
    this.scene.dispose();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const ui = new UIController();
  (window as any).__ui = ui;
});
