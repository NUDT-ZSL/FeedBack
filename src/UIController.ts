import type { DecorationType } from './SceneManager';
import type { FishManager } from './FishManager';
import type { SceneManager } from './SceneManager';

export class UIController {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private fishManager: FishManager;
  private sceneManager: SceneManager;
  private selectedDecoration: DecorationType | null = null;
  private isDragging = false;
  private dragType: DecorationType | null = null;
  private infoPanel!: HTMLElement;
  private fishCountEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private onFoodClick: ((x: number, y: number) => void) | null = null;
  private onDecorationPlace: ((type: DecorationType, x: number, y: number) => void) | null = null;
  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 60;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    fishManager: FishManager,
    sceneManager: SceneManager
  ) {
    this.container = container;
    this.canvas = canvas;
    this.fishManager = fishManager;
    this.sceneManager = sceneManager;
    this.createUI();
    this.bindEvents();
  }

  setFoodClickHandler(handler: (x: number, y: number) => void): void {
    this.onFoodClick = handler;
  }

  setDecorationPlaceHandler(handler: (type: DecorationType, x: number, y: number) => void): void {
    this.onDecorationPlace = handler;
  }

  private glassStyle(): Partial<CSSStyleDeclaration> {
    return {
      background: 'rgba(10, 10, 42, 0.5)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.188)',
      borderRadius: '16px'
    } as Partial<CSSStyleDeclaration>;
  }

  private buttonStyle(hoverColor = '#ff7043'): Partial<CSSStyleDeclaration> {
    return {
      background: 'rgba(255, 112, 67, 0.15)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.188)',
      borderRadius: '12px',
      color: hoverColor,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      fontSize: '13px',
      fontWeight: '600',
      letterSpacing: '0.5px',
      userSelect: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px'
    } as Partial<CSSStyleDeclaration>;
  }

  private applyStyle(el: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
    Object.assign(el.style, style);
  }

  private createUI(): void {
    const toolbar = document.createElement('div');
    toolbar.id = 'toolbar';
    this.applyStyle(toolbar, {
      ...this.glassStyle(),
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 16px',
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      zIndex: '100'
    });

    const createBtn = (
      label: string,
      iconSvg: string,
      onClick: () => void,
      width = '90px',
      height = '44px'
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.innerHTML = `${iconSvg}<span>${label}</span>`;
      this.applyStyle(btn, {
        ...this.buttonStyle(),
        width,
        height
      });
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = '0 0 20px rgba(255, 112, 67, 0.5)';
        btn.style.background = 'rgba(255, 112, 67, 0.3)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = 'none';
        btn.style.background = 'rgba(255, 112, 67, 0.15)';
      });
      btn.addEventListener('click', onClick);
      return btn;
    };

    const foodIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="3"/><circle cx="6" cy="14" r="2"/><circle cx="18" cy="14" r="2"/><circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/></svg>`;
    const foodBtn = createBtn('撒食', foodIcon, () => {
      this.selectedDecoration = null;
      this.canvas.style.cursor = 'crosshair';
      this.updateSelectionUI();
    });

    const coralIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L8 8H6v2h2v4H6v2h2v6h2v-6h4v6h2v-6h2v-2h-2v-4h2V8h-2z"/></svg>`;
    const coralBtn = createBtn('珊瑚', coralIcon, () => {
      this.selectedDecoration = 'coral';
      this.canvas.style.cursor = 'copy';
      this.updateSelectionUI();
    });

    const shellIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="14" rx="9" ry="7"/><ellipse cx="12" cy="12" rx="6" ry="4" fill="#fff8e1"/></svg>`;
    const shellBtn = createBtn('贝壳', shellIcon, () => {
      this.selectedDecoration = 'shell';
      this.canvas.style.cursor = 'copy';
      this.updateSelectionUI();
    });

    const wreckIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="10" width="18" height="6"/><rect x="6" y="6" width="10" height="4"/><rect x="10" y="3" width="2" height="3"/></svg>`;
    const wreckBtn = createBtn('沉船', wreckIcon, () => {
      this.selectedDecoration = 'wreck';
      this.canvas.style.cursor = 'copy';
      this.updateSelectionUI();
    });

    toolbar.appendChild(foodBtn);
    toolbar.appendChild(coralBtn);
    toolbar.appendChild(shellBtn);
    toolbar.appendChild(wreckBtn);

    const sep = document.createElement('div');
    this.applyStyle(sep, {
      width: '1px',
      height: '32px',
      background: 'rgba(255,255,255,0.2)',
      margin: '0 4px'
    });
    toolbar.appendChild(sep);

    const screenshotIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4l2-2h2l2 2h4a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h4zm3 5a5 5 0 100 10 5 5 0 000-10z"/></svg>`;
    const screenshotBtn = createBtn('截图', screenshotIcon, () => this.takeScreenshot());

    const exportIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l-5 5h3v8h4V7h3l-5-5zM5 18h14v2H5v-2z"/></svg>`;
    const exportBtn = createBtn('导出', exportIcon, () => this.exportGenes());

    const importIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22l5-5h-3V9h-4v8H7l5 5zM5 4h14v2H5V4z"/></svg>`;
    const importBtn = createBtn('导入', importIcon, () => this.importGenes());

    toolbar.appendChild(screenshotBtn);
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(importBtn);

    this.container.appendChild(toolbar);

    this.infoPanel = document.createElement('div');
    this.applyStyle(this.infoPanel, {
      ...this.glassStyle(),
      position: 'fixed',
      top: '24px',
      right: '24px',
      padding: '16px 20px',
      color: '#fff',
      minWidth: '160px',
      zIndex: '100'
    });

    const title = document.createElement('div');
    title.textContent = '🐟 像素鱼缸';
    this.applyStyle(title, {
      fontSize: '16px',
      fontWeight: '700',
      color: '#ff7043',
      marginBottom: '10px',
      letterSpacing: '1px'
    });

    this.fishCountEl = document.createElement('div');
    this.applyStyle(this.fishCountEl, {
      fontSize: '13px',
      marginBottom: '4px',
      opacity: '0.9'
    });

    this.fpsEl = document.createElement('div');
    this.applyStyle(this.fpsEl, {
      fontSize: '13px',
      opacity: '0.7'
    });

    this.infoPanel.appendChild(title);
    this.infoPanel.appendChild(this.fishCountEl);
    this.infoPanel.appendChild(this.fpsEl);
    this.container.appendChild(this.infoPanel);

    const tip = document.createElement('div');
    tip.textContent = '点击鱼缸撒食 · 选择装饰物后点击放置';
    this.applyStyle(tip, {
      position: 'fixed',
      top: '24px',
      left: '24px',
      padding: '10px 16px',
      ...this.glassStyle(),
      color: 'rgba(255,255,255,0.7)',
      fontSize: '12px',
      zIndex: '100'
    });
    this.container.appendChild(tip);
  }

  private updateSelectionUI(): void {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    const btns = toolbar.querySelectorAll('button');
    btns.forEach((btn, i) => {
      const isFood = i === 0 && this.selectedDecoration === null && this.canvas.style.cursor === 'crosshair';
      const decorationMap: Record<number, DecorationType> = { 1: 'coral', 2: 'shell', 3: 'wreck' };
      const isDeco = decorationMap[i] && decorationMap[i] === this.selectedDecoration;
      if (isFood || isDeco) {
        btn.style.background = 'rgba(255, 112, 67, 0.5)';
        btn.style.boxShadow = '0 0 15px rgba(255, 112, 67, 0.6)';
      } else {
        btn.style.background = 'rgba(255, 112, 67, 0.15)';
        btn.style.boxShadow = 'none';
      }
    });
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      if (this.selectedDecoration) {
        this.isDragging = true;
        this.dragType = this.selectedDecoration;
      } else {
        if (this.onFoodClick) this.onFoodClick(x, y);
      }
    });

    this.canvas.addEventListener('mousemove', () => {
      if (this.selectedDecoration) {
        this.canvas.style.cursor = 'copy';
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (this.isDragging && this.dragType) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
        if (this.onDecorationPlace) this.onDecorationPlace(this.dragType, x, y);
      }
      this.isDragging = false;
      this.dragType = null;
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.selectedDecoration = null;
      this.canvas.style.cursor = 'default';
      this.updateSelectionUI();
    });
  }

  private takeScreenshot(): void {
    const dataUrl = this.sceneManager.takeScreenshot();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `pixel-fish-tank-${Date.now()}.png`;
    a.click();
  }

  private exportGenes(): void {
    const code = this.fishManager.exportGenes();
    const decorations = this.sceneManager.decorations.map(d => ({
      t: d.type,
      x: d.x / this.canvas.width,
      y: d.y / this.canvas.height,
      s: d.scale
    }));
    const fullCode = btoa(unescape(encodeURIComponent(JSON.stringify({ genes: code, decorations }))));

    const modal = this.createModal('导出基因编码');
    const textarea = document.createElement('textarea');
    textarea.value = fullCode;
    textarea.readOnly = true;
    this.applyStyle(textarea, {
      width: '100%',
      height: '120px',
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '8px',
      color: '#fff',
      padding: '10px',
      fontSize: '12px',
      resize: 'none',
      fontFamily: 'monospace'
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制到剪贴板';
    this.applyStyle(copyBtn, {
      ...this.buttonStyle(),
      width: '100%',
      height: '40px',
      marginTop: '12px'
    });
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.transform = 'scale(1.05)';
      copyBtn.style.boxShadow = '0 0 15px rgba(255, 112, 67, 0.5)';
    });
    copyBtn.addEventListener('mouseleave', () => {
      copyBtn.style.transform = 'scale(1)';
      copyBtn.style.boxShadow = 'none';
    });
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fullCode);
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => { copyBtn.textContent = '复制到剪贴板'; }, 1500);
      } catch {
        textarea.select();
        document.execCommand('copy');
      }
    });

    modal.appendChild(textarea);
    modal.appendChild(copyBtn);
  }

  private importGenes(): void {
    const modal = this.createModal('导入基因编码');
    const textarea = document.createElement('textarea');
    textarea.placeholder = '粘贴基因编码...';
    this.applyStyle(textarea, {
      width: '100%',
      height: '120px',
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '8px',
      color: '#fff',
      padding: '10px',
      fontSize: '12px',
      resize: 'none',
      fontFamily: 'monospace'
    });

    const importBtn = document.createElement('button');
    importBtn.textContent = '确认导入';
    this.applyStyle(importBtn, {
      ...this.buttonStyle(),
      width: '100%',
      height: '40px',
      marginTop: '12px'
    });
    importBtn.addEventListener('mouseenter', () => {
      importBtn.style.transform = 'scale(1.05)';
      importBtn.style.boxShadow = '0 0 15px rgba(255, 112, 67, 0.5)';
    });
    importBtn.addEventListener('mouseleave', () => {
      importBtn.style.transform = 'scale(1)';
      importBtn.style.boxShadow = 'none';
    });
    importBtn.addEventListener('click', () => {
      const code = textarea.value.trim();
      if (!code) return;
      try {
        const data = JSON.parse(decodeURIComponent(escape(atob(code))));
        if (data.genes) {
          const ok = this.fishManager.importGenes(data.genes);
          if (ok && data.decorations) {
            this.sceneManager.decorations = data.decorations.map((d: any) => ({
              id: Date.now() + Math.random(),
              type: d.t as DecorationType,
              x: d.x * this.canvas.width,
              y: d.y * this.canvas.height,
              scale: d.s
            }));
          }
          if (ok) {
            this.closeModals();
          } else {
            importBtn.textContent = '导入失败，编码无效';
            setTimeout(() => { importBtn.textContent = '确认导入'; }, 1500);
          }
        } else {
          const ok = this.fishManager.importGenes(code);
          if (!ok) {
            importBtn.textContent = '导入失败，编码无效';
            setTimeout(() => { importBtn.textContent = '确认导入'; }, 1500);
          } else {
            this.closeModals();
          }
        }
      } catch {
        importBtn.textContent = '导入失败，编码无效';
        setTimeout(() => { importBtn.textContent = '确认导入'; }, 1500);
      }
    });

    modal.appendChild(textarea);
    modal.appendChild(importBtn);
  }

  private createModal(title: string): HTMLElement {
    this.closeModals();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    this.applyStyle(overlay, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '1000',
      backdropFilter: 'blur(4px)'
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModals();
    });

    const modal = document.createElement('div');
    this.applyStyle(modal, {
      ...this.glassStyle(),
      padding: '24px',
      minWidth: '380px',
      maxWidth: '90vw',
      color: '#fff'
    });

    const header = document.createElement('div');
    header.textContent = title;
    this.applyStyle(header, {
      fontSize: '18px',
      fontWeight: '700',
      color: '#ff7043',
      marginBottom: '16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    });

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    this.applyStyle(closeBtn, {
      cursor: 'pointer',
      opacity: '0.6',
      fontSize: '16px'
    });
    closeBtn.addEventListener('click', () => this.closeModals());
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.6'; });
    header.appendChild(closeBtn);

    modal.appendChild(header);
    overlay.appendChild(modal);
    this.container.appendChild(overlay);
    return modal;
  }

  private closeModals(): void {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  }

  update(dt: number): void {
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.currentFps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
      this.fishCountEl.textContent = `🐠 鱼群: ${this.fishManager.fishes.length} / ${this.fishManager.MAX_FISH}`;
      this.fpsEl.textContent = `⚡ FPS: ${this.currentFps}`;
    }
  }
}
