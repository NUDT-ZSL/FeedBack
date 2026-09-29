import type { BuildingParams, ComponentInfo, ComponentType, CollisionResult } from '@/types/bim';
import { ComponentTypeName, ComponentTypeColor, DefaultParams } from '@/types/bim';
import { SceneManager } from '@/core/SceneManager';
import type { InteractionMode } from '@/core/SceneManager';
import { BuildingGenerator } from '@/modules/BuildingGenerator';
import { CollisionDetector } from '@/modules/CollisionDetector';
import { AnimationHelper } from '@/utils/AnimationHelper';
import * as THREE from 'three';
import type { BIMMeshUserData } from '@/types/bim';

type GenerateCb = (p: BuildingParams) => void;
type SimpleCb = () => void;
type CollisionToggleCb = (active: boolean) => void;

export class InfoPanel {
  private container: HTMLElement;
  private sceneManager: SceneManager;
  private generator: BuildingGenerator;
  private detector: CollisionDetector;
  private animHelper: AnimationHelper;

  private el!: {
    loadingOverlay: HTMLDivElement;
    progressFill: HTMLDivElement;
    progressText: HTMLSpanElement;
    toolbar: HTMLElement;
    leftPanel: HTMLElement;
    componentList: HTMLElement;
    totalCount: HTMLSpanElement;
    rightPanel: HTMLElement;
    detailEmpty: HTMLElement;
    detailContent: HTMLElement;
    collisionEmpty: HTMLElement;
    collisionList: HTMLElement;
    infoPopup: HTMLElement;
    popupType: HTMLElement;
    popupId: HTMLElement;
    infoType: HTMLElement;
    infoSize: HTMLElement;
    infoMaterial: HTMLElement;
    infoPos: HTMLElement;
    selectionBox: HTMLElement;
    modeBanner: HTMLElement;
    bannerText: HTMLSpanElement;
    paramsModal: HTMLElement;
    fpsInfo: HTMLSpanElement;
    cursorInfo: HTMLSpanElement;
    componentsInfo: HTMLSpanElement;
  };

  private activeComponentMesh: THREE.Mesh | null = null;
  private activeComponentInfo: ComponentInfo | null = null;
  private toolBtnActive: string = 'rotate';
  private collisionModeActive: boolean = false;
  private collisionPhase: 0 | 1 | 2 = 0;
  private collisionMeshA: THREE.Mesh | null = null;
  private dragging: boolean = false;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };

  private generateCb: GenerateCb | null = null;
  private resetCb: SimpleCb | null = null;
  private collisionToggleCb: CollisionToggleCb | null = null;

  private collapsedGroups: Record<ComponentType, boolean> = {
    column: false, beam: false, slab: false, wall: false
  };

  constructor(
    container: HTMLElement,
    sceneManager: SceneManager,
    generator: BuildingGenerator,
    detector: CollisionDetector,
    animHelper: AnimationHelper
  ) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.generator = generator;
    this.detector = detector;
    this.animHelper = animHelper;
  }

  build(): void {
    this.el = {
      loadingOverlay: document.getElementById('loading-overlay') as HTMLDivElement,
      progressFill: document.getElementById('progress-fill') as HTMLDivElement,
      progressText: document.getElementById('progress-text') as HTMLSpanElement,
      toolbar: document.getElementById('toolbar') as HTMLElement,
      leftPanel: document.getElementById('left-panel') as HTMLElement,
      componentList: document.getElementById('component-list') as HTMLElement,
      totalCount: document.getElementById('total-count') as HTMLSpanElement,
      rightPanel: document.getElementById('right-panel') as HTMLElement,
      detailEmpty: document.getElementById('detail-empty') as HTMLElement,
      detailContent: document.getElementById('detail-content') as HTMLElement,
      collisionEmpty: document.getElementById('collision-empty') as HTMLElement,
      collisionList: document.getElementById('collision-list') as HTMLElement,
      infoPopup: document.getElementById('info-popup') as HTMLElement,
      popupType: document.getElementById('popup-type') as HTMLElement,
      popupId: document.getElementById('popup-id') as HTMLElement,
      infoType: document.getElementById('info-type') as HTMLElement,
      infoSize: document.getElementById('info-size') as HTMLElement,
      infoMaterial: document.getElementById('info-material') as HTMLElement,
      infoPos: document.getElementById('info-pos') as HTMLElement,
      selectionBox: document.getElementById('selection-box') as HTMLElement,
      modeBanner: document.getElementById('mode-banner') as HTMLElement,
      bannerText: this._qs('#mode-banner > span:nth-child(2)') as HTMLSpanElement,
      paramsModal: document.getElementById('params-modal') as HTMLElement,
      fpsInfo: document.getElementById('fps-info') as HTMLSpanElement,
      cursorInfo: document.getElementById('cursor-info') as HTMLSpanElement,
      componentsInfo: document.getElementById('components-info') as HTMLSpanElement
    };

    this._bindToolbar();
    this._bindTabs();
    this._bindPopup();
    this._bindModal();
    this._bindBanner();
    this._bindSelection();
    this._setStatusDefaults();
    this._setToolActive('rotate');
  }

  private _qs(sel: string): HTMLElement {
    return document.querySelector(sel) as HTMLElement;
  }

  private _bindToolbar(): void {
    const btns = this.el.toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn');
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (!action) return;
        switch (action) {
          case 'rotate': case 'pan': case 'zoom':
            this._setToolActive(action);
            const mode: InteractionMode = action === 'rotate' ? 'orbit' : action;
            this.sceneManager.setInteractionMode(mode);
            break;
          case 'reset':
            this.resetCb?.();
            break;
          case 'generate':
            this._openParamsModal();
            break;
          case 'collision':
            this._toggleCollisionMode(!this.collisionModeActive);
            break;
        }
      });
    });
  }

  private _setToolActive(action: string): void {
    this.toolBtnActive = action;
    const btns = this.el.toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn');
    btns.forEach((b) => {
      const a = b.dataset.action;
      if (a === 'rotate' || a === 'pan' || a === 'zoom') {
        b.classList.toggle('active', a === action);
      }
    });
  }

  private _toggleCollisionMode(active: boolean): void {
    this.collisionModeActive = active;
    const collisionBtn = this.el.toolbar.querySelector<HTMLButtonElement>('[data-action="collision"]');
    collisionBtn?.classList.toggle('active', active);
    this.el.modeBanner.classList.toggle('hidden', !active);
    this.collisionPhase = 0;
    this.collisionMeshA = null;
    this._updateBannerText();
    this.sceneManager.controls.enabled = !active;
    if (active) {
      this.switchTab('collision');
    }
    this.collisionToggleCb?.(active);
  }

  private _updateBannerText(): void {
    const spans = this.el.modeBanner.querySelectorAll('span');
    if (spans.length >= 2) {
      if (this.collisionPhase === 0) {
        spans[1].textContent = '碰撞检测模式：框选第一个构件';
      } else if (this.collisionPhase === 1) {
        spans[1].textContent = '碰撞检测模式：框选第二个构件';
      }
    }
  }

  private _bindTabs(): void {
    const tabBtns = this.el.rightPanel.querySelectorAll<HTMLButtonElement>('.tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as 'detail' | 'collision';
        this.switchTab(tab);
      });
    });
  }

  switchTab(tab: 'detail' | 'collision'): void {
    const btns = this.el.rightPanel.querySelectorAll<HTMLButtonElement>('.tab-btn');
    btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const panes = this.el.rightPanel.querySelectorAll<HTMLElement>('.tab-pane');
    panes.forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
  }

  private _bindPopup(): void {
    document.getElementById('popup-close')?.addEventListener('click', () => {
      this.hideComponentInfo();
    });
  }

  private _bindModal(): void {
    document.getElementById('params-close')?.addEventListener('click', () => this._closeParamsModal());
    document.getElementById('params-cancel')?.addEventListener('click', () => this._closeParamsModal());
    document.getElementById('params-confirm')?.addEventListener('click', () => {
      const p = this._collectParams();
      this._closeParamsModal();
      this.generateCb?.(p);
    });
    this.el.paramsModal.addEventListener('click', (e) => {
      if (e.target === this.el.paramsModal) this._closeParamsModal();
    });
  }

  private _bindBanner(): void {
    document.getElementById('banner-close')?.addEventListener('click', () => {
      this._toggleCollisionMode(false);
    });
  }

  private _bindSelection(): void {
    const canvas = this.sceneManager.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.collisionModeActive) return;
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.el.selectionBox.style.left = `${e.clientX}px`;
      this.el.selectionBox.style.top = `${e.clientY}px`;
      this.el.selectionBox.style.width = '0px';
      this.el.selectionBox.style.height = '0px';
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const minX = Math.min(this.dragStart.x, e.clientX);
      const minY = Math.min(this.dragStart.y, e.clientY);
      const w = Math.abs(e.clientX - this.dragStart.x);
      const h = Math.abs(e.clientY - this.dragStart.y);
      this.showSelectionBox(minX, minY, w, h);
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      const minX = Math.min(this.dragStart.x, e.clientX);
      const minY = Math.min(this.dragStart.y, e.clientY);
      const maxX = Math.max(this.dragStart.x, e.clientX);
      const maxY = Math.max(this.dragStart.y, e.clientY);
      const w = maxX - minX;
      const h = maxY - minY;

      this.hideSelectionBox();

      if (!this.collisionModeActive) return;
      if (w < 3 && h < 3) return;

      const meshes = this.sceneManager.getBuildingMeshesInRect(minX, minY, maxX, maxY)
        .filter((m) => {
          const ud = m.userData as BIMMeshUserData;
          return ud?.componentInfo && !ud.componentInfo.id.startsWith('LBL-');
        });
      if (meshes.length === 0) return;

      const picked = meshes[0];

      if (this.collisionPhase === 0) {
        this.collisionMeshA = picked;
        this.animHelper.highlightPulse(picked, 0x4FC3F7, 0.4, 200);
        this.collisionPhase = 1;
        this._updateBannerText();
      } else if (this.collisionPhase === 1 && this.collisionMeshA) {
        if (this.collisionMeshA === picked) return;
        const res = this.detector.detect(this.collisionMeshA, picked);
        this.addCollisionResult(res);
        this.animHelper.removeHighlight(this.collisionMeshA);
        this.collisionMeshA = null;
        this.collisionPhase = 0;
        this._updateBannerText();
      }
    });
  }

  private _setStatusDefaults(): void {
    this.el.componentsInfo.textContent = '构件数: 0';
  }

  showLoadingProgress(progress: number): void {
    const p = Math.max(0, Math.min(100, progress));
    this.el.progressFill.style.width = `${p}%`;
    this.el.progressText.textContent = `${Math.round(p)}%`;
  }

  hideLoading(): void {
    this.el.loadingOverlay.classList.add('fade-out');
    window.setTimeout(() => {
      this.el.loadingOverlay.classList.add('hidden');
    }, 550);
  }

  showComponentInfo(info: ComponentInfo, screenX: number, screenY: number): void {
    this.activeComponentInfo = info;
    this.el.popupType.textContent = ComponentTypeName[info.type];
    this.el.popupId.textContent = info.id;
    this.el.infoType.textContent = ComponentTypeName[info.type];
    this.el.infoSize.textContent = `${info.width.toFixed(2)} × ${info.height.toFixed(2)} × ${info.length.toFixed(2)} m`;
    this.el.infoMaterial.textContent = info.material;
    this.el.infoPos.textContent = `(${info.position.x.toFixed(2)}, ${info.position.y.toFixed(2)}, ${info.position.z.toFixed(2)})`;

    const popupW = 260;
    const popupH = 200;
    const padding = 16;
    let px = screenX + 18;
    let py = screenY + 18;
    if (px + popupW > window.innerWidth - padding) px = screenX - popupW - 18;
    if (py + popupH > window.innerHeight - padding) py = Math.max(padding, screenY - popupH - 18);
    px = Math.max(padding, px);
    py = Math.max(padding, py);

    this.el.infoPopup.style.left = `${px}px`;
    this.el.infoPopup.style.top = `${py}px`;
    this.el.infoPopup.style.bottom = 'auto';
    this.el.infoPopup.style.right = 'auto';
    this.animHelper.scaleIn(this.el.infoPopup, 200);

    this._renderDetailPane(info);
    this.switchTab('detail');
  }

  hideComponentInfo(): void {
    this.el.infoPopup.classList.remove('show');
    this.el.infoPopup.style.opacity = '';
    this.el.infoPopup.style.transform = '';
    this.activeComponentInfo = null;
    this.el.detailEmpty.style.display = '';
    this.el.detailContent.innerHTML = '';
  }

  private _renderDetailPane(info: ComponentInfo): void {
    this.el.detailEmpty.style.display = 'none';
    const typeColor = '#' + ComponentTypeColor[info.type].toString(16).padStart(6, '0');
    const html = `
      <div class="detail-block">
        <div class="detail-block-title">基础信息</div>
        <div class="detail-row"><span class="k">构件编号</span><span class="v">${info.id}</span></div>
        <div class="detail-row"><span class="k">构件类型</span><span class="v">${ComponentTypeName[info.type]}</span></div>
        <div class="detail-row">
          <span class="k">类型色块</span>
          <span class="v" style="display:inline-block;width:20px;height:14px;border-radius:3px;background:${typeColor};vertical-align:middle;"></span>
        </div>
      </div>
      <div class="detail-block">
        <div class="detail-block-title">几何参数</div>
        <div class="detail-row"><span class="k">宽度</span><span class="v">${info.width.toFixed(2)} m</span></div>
        <div class="detail-row"><span class="k">高度</span><span class="v">${info.height.toFixed(2)} m</span></div>
        <div class="detail-row"><span class="k">长度</span><span class="v">${info.length.toFixed(2)} m</span></div>
      </div>
      <div class="detail-block">
        <div class="detail-block-title">材料与坐标</div>
        <div class="detail-row"><span class="k">材料</span><span class="v" style="text-align:right;max-width:140px;">${info.material}</span></div>
        <div class="detail-row"><span class="k">位置 X</span><span class="v">${info.position.x.toFixed(3)} m</span></div>
        <div class="detail-row"><span class="k">位置 Y</span><span class="v">${info.position.y.toFixed(3)} m</span></div>
        <div class="detail-row"><span class="k">位置 Z</span><span class="v">${info.position.z.toFixed(3)} m</span></div>
      </div>
    `;
    this.el.detailContent.innerHTML = html;
  }

  addCollisionResult(result: CollisionResult): void {
    this.el.collisionEmpty.style.display = 'none';

    const date = new Date(result.timestamp);
    const tStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    const badgeClass = result.isColliding ? 'hit' : 'safe';
    const badgeText = result.isColliding
      ? `✕ 碰撞 ${result.overlapVolumePercent}%`
      : '✓ 无碰撞';
    const thumbA = result.thumbnailA || '';
    const thumbB = result.thumbnailB || '';

    const item = document.createElement('div');
    item.className = 'collision-item';
    item.dataset.id = result.id;
    item.innerHTML = `
      <div class="collision-item-head">
        <span class="collision-badge ${badgeClass}">${badgeText}</span>
        <span class="collision-time">${tStr}</span>
      </div>
      <div class="collision-thumbs">
        <div class="collision-thumb">
          ${thumbA ? `<img src="${thumbA}" style="width:100%;height:100%;object-fit:cover;" />` : ''}
          <span class="collision-thumb-label">A</span>
        </div>
        <div class="collision-thumb">
          ${thumbB ? `<img src="${thumbB}" style="width:100%;height:100%;object-fit:cover;" />` : ''}
          <span class="collision-thumb-label">B</span>
        </div>
      </div>
      <div class="collision-pair">
        <span>构件 A: <span class="mono">${result.componentA.id}</span> （${ComponentTypeName[result.componentA.type]}）</span>
        <span>构件 B: <span class="mono">${result.componentB.id}</span> （${ComponentTypeName[result.componentB.type]}）</span>
        ${result.isColliding ? `<span style="color:#FF5252;margin-top:2px;">重叠体积占比: ${result.overlapVolumePercent.toFixed(2)}%</span>` : ''}
      </div>
    `;

    item.addEventListener('click', () => {
      this.detector.focusComponent(result.componentA);
    });

    this.el.collisionList.insertBefore(item, this.el.collisionList.firstChild);
  }

  clearCollisionResults(): void {
    this.el.collisionList.innerHTML = '';
    this.el.collisionEmpty.style.display = '';
    this.detector.clearResults();
  }

  updateComponentList(components: ComponentInfo[]): void {
    this.el.totalCount.textContent = String(components.length);
    this.el.componentsInfo.textContent = `构件数: ${components.length}`;

    const groups: Record<ComponentType, ComponentInfo[]> = {
      column: [], beam: [], slab: [], wall: []
    };
    components.forEach((c) => {
      if (groups[c.type]) groups[c.type].push(c);
    });

    const order: ComponentType[] = ['column', 'beam', 'slab', 'wall'];

    this.el.componentList.innerHTML = '';
    order.forEach((type) => {
      const list = groups[type];
      const collapsed = this.collapsedGroups[type];
      const color = '#' + ComponentTypeColor[type].toString(16).padStart(6, '0');

      const group = document.createElement('div');
      group.className = 'comp-group';
      group.innerHTML = `
        <div class="group-header ${collapsed ? 'collapsed' : ''}" data-type="${type}">
          <span class="group-color" style="background:${color};"></span>
          <span class="group-name">${ComponentTypeName[type]}</span>
          <span class="group-num">${list.length}</span>
          <svg class="group-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="group-items" style="${collapsed ? 'max-height:0;' : ''}">
          <div class="group-items-inner"></div>
        </div>
      `;
      const header = group.querySelector<HTMLElement>('.group-header')!;
      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        this.collapsedGroups[type] = header.classList.contains('collapsed');
      });

      const inner = group.querySelector<HTMLElement>('.group-items-inner')!;
      list.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'comp-item';
        item.dataset.id = c.id;
        item.innerHTML = `
          <span class="comp-id">${c.id}</span>
          <span class="comp-tag">${c.width.toFixed(1)}×${c.height.toFixed(1)}×${c.length.toFixed(1)}</span>
        `;
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.el.componentList.querySelectorAll('.comp-item').forEach((el) => el.classList.remove('active'));
          item.classList.add('active');
          const mesh = this.generator.getMeshByComponentId(c.id);
          if (mesh) {
            this.animHelper.highlightPulse(mesh);
            this.detector.focusComponent(c);
            const rect = item.getBoundingClientRect();
            this.showComponentInfo(c, rect.right + 10, rect.top);
            if (this.activeComponentMesh && this.activeComponentMesh !== mesh) {
              this.animHelper.removeHighlight(this.activeComponentMesh);
            }
            this.activeComponentMesh = mesh;
          }
        });
        inner.appendChild(item);
      });

      this.el.componentList.appendChild(group);
    });
  }

  showSelectionBox(x: number, y: number, w: number, h: number): void {
    this.el.selectionBox.classList.add('show');
    this.el.selectionBox.style.left = `${x}px`;
    this.el.selectionBox.style.top = `${y}px`;
    this.el.selectionBox.style.width = `${w}px`;
    this.el.selectionBox.style.height = `${h}px`;
  }

  hideSelectionBox(): void {
    this.el.selectionBox.classList.remove('show');
  }

  updateFps(fps: number): void {
    this.el.fpsInfo.textContent = `FPS: ${fps}`;
  }

  updateCursor(v: THREE.Vector3 | null): void {
    if (!v) { this.el.cursorInfo.textContent = '坐标: -, -, -'; return; }
    this.el.cursorInfo.textContent = `坐标: ${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
  }

  onGenerateRequest(cb: GenerateCb): void { this.generateCb = cb; }
  onResetView(cb: SimpleCb): void { this.resetCb = cb; }
  onCollisionModeToggle(cb: CollisionToggleCb): void { this.collisionToggleCb = cb; }

  private _openParamsModal(): void {
    const last = this._lastUsedParams();
    (document.getElementById('param-floors') as HTMLInputElement).value = String(last.floors);
    (document.getElementById('param-floorHeight') as HTMLInputElement).value = String(last.floorHeight);
    (document.getElementById('param-columnsX') as HTMLInputElement).value = String(last.columnsX);
    (document.getElementById('param-columnsZ') as HTMLInputElement).value = String(last.columnsZ);
    (document.getElementById('param-spacingX') as HTMLInputElement).value = String(last.columnSpacingX);
    (document.getElementById('param-spacingZ') as HTMLInputElement).value = String(last.columnSpacingZ);
    (document.getElementById('param-wallMaterial') as HTMLSelectElement).value = last.wallMaterial;
    this.el.paramsModal.classList.remove('hidden');
  }

  private _closeParamsModal(): void {
    this.el.paramsModal.classList.add('hidden');
  }

  private _lastUsedParams(): BuildingParams {
    try {
      const raw = sessionStorage.getItem('bim-last-params');
      if (raw) return { ...DefaultParams, ...JSON.parse(raw) };
    } catch {}
    return DefaultParams;
  }

  private _collectParams(): BuildingParams {
    const p: BuildingParams = {
      floors: Number((document.getElementById('param-floors') as HTMLInputElement).value) || DefaultParams.floors,
      floorHeight: Number((document.getElementById('param-floorHeight') as HTMLInputElement).value) || DefaultParams.floorHeight,
      columnsX: Number((document.getElementById('param-columnsX') as HTMLInputElement).value) || DefaultParams.columnsX,
      columnsZ: Number((document.getElementById('param-columnsZ') as HTMLInputElement).value) || DefaultParams.columnsZ,
      columnSpacingX: Number((document.getElementById('param-spacingX') as HTMLInputElement).value) || DefaultParams.columnSpacingX,
      columnSpacingZ: Number((document.getElementById('param-spacingZ') as HTMLInputElement).value) || DefaultParams.columnSpacingZ,
      wallMaterial: (document.getElementById('param-wallMaterial') as HTMLSelectElement).value || DefaultParams.wallMaterial
    };
    try { sessionStorage.setItem('bim-last-params', JSON.stringify(p)); } catch {}
    return p;
  }

  setActiveComponentMesh(mesh: THREE.Mesh | null): void {
    if (this.activeComponentMesh && this.activeComponentMesh !== mesh) {
      this.animHelper.removeHighlight(this.activeComponentMesh);
    }
    this.activeComponentMesh = mesh;
  }
}
