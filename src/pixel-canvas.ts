import { CanvasStore, type PixelData, type StoreChangeType } from './canvas-store.ts';

export type { PixelData } from './canvas-store.ts';

export type ToolType = 'pencil' | 'eraser' | 'picker' | 'fill';

export interface ToolChangeEventDetail {
  tool: ToolType;
}

export interface ColorChangeEventDetail {
  color: string;
}

export interface PixelPickedEventDetail {
  color: string;
}

export interface CanvasChangeEventDetail {
  pixels: PixelData;
}

export interface HistoryChangeEventDetail {
  canUndo: boolean;
  canRedo: boolean;
}

export class PixelCanvas extends HTMLElement {
  private store!: CanvasStore;
  private currentTool: ToolType = 'pencil';
  private currentColor: string = '#000000';
  private isDrawing: boolean = false;
  private container!: HTMLDivElement;
  private styleEl!: HTMLStyleElement;
  private rafId: number | null = null;
  private pendingPixels: Set<string> = new Set();
  private lastPaintedKey: string | null = null;

  static get observedAttributes(): string[] {
    return ['size'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    const sizeAttr = this.getAttribute('size');
    const initialSize = sizeAttr ? parseInt(sizeAttr, 10) : 32;
    this.store = new CanvasStore(initialSize);
    this.store.subscribe((type) => this.handleStoreChange(type));
    this.render();
    this.buildGrid();
    this.attachEvents();
  }

  disconnectedCallback(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (name === 'size' && oldValue !== newValue && this.store) {
      this.store.reset(parseInt(newValue, 10));
    }
  }

  public getGridSize(): number {
    return this.store.getGridSize();
  }

  public setSize(size: number): void {
    this.setAttribute('size', String(size));
  }

  public getPixels(): PixelData {
    return this.store.getCommittedPixels();
  }

  public setPixels(pixels: PixelData): void {
    this.store.setPixels(pixels);
  }

  public resetPixels(size?: number): void {
    this.store.reset(size);
  }

  public setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.container.style.cursor = this.getCursorForTool(tool);
  }

  public setColor(color: string): void {
    this.currentColor = color;
  }

  public toCanvas(): HTMLCanvasElement {
    const size = this.store.getGridSize();
    const pixels = this.store.getCommittedPixels();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = pixels[y][x];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas;
  }

  public undo(): boolean {
    return this.store.undo();
  }

  public redo(): boolean {
    return this.store.redo();
  }

  public canUndo(): boolean {
    return this.store.canUndo();
  }

  public canRedo(): boolean {
    return this.store.canRedo();
  }

  /** Rebuild the grid layout without touching state (e.g. after window resize). */
  public refreshLayout(): void {
    this.buildGrid();
  }

  private handleStoreChange(type: StoreChangeType): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (type === 'commit') {
      this.flushPending();
    } else {
      this.pendingPixels.clear();
      this.buildGrid();
    }
    this.dispatchChange();
    this.dispatchEvent(new CustomEvent<HistoryChangeEventDetail>('historychange', {
      bubbles: true,
      composed: true,
      detail: { canUndo: this.store.canUndo(), canRedo: this.store.canRedo() }
    }));
  }

  private getCursorForTool(tool: ToolType): string {
    switch (tool) {
      case 'pencil':
        return 'crosshair';
      case 'eraser':
        return 'cell';
      case 'picker':
        return 'copy';
      case 'fill':
        return 'pointer';
      default:
        return 'default';
    }
  }

  private render(): void {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      :host {
        display: block;
      }
      .canvas-wrapper {
        background-color: #16213e;
        padding: 12px;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }
      .grid-container {
        display: grid;
        gap: 0;
        background-color: #3a3a5c;
        border: 2px solid #3a3a5c;
        cursor: crosshair;
        touch-action: none;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      .pixel {
        background-color: #ffffff;
        width: var(--pixel-size);
        height: var(--pixel-size);
        transition: none;
      }
      @media (max-width: 768px) {
        .grid-container {
          --pixel-size: 10px !important;
        }
      }
    `;
    this.container = document.createElement('div');
    this.container.className = 'canvas-wrapper';
    this.shadowRoot!.appendChild(this.styleEl);
    this.shadowRoot!.appendChild(this.container);
  }

  private buildGrid(): void {
    const existingGrid = this.container.querySelector('.grid-container');
    if (existingGrid) {
      existingGrid.remove();
    }

    const size = this.store.getGridSize();
    const pixels = this.store.getDisplayPixels();
    const grid = document.createElement('div');
    grid.className = 'grid-container';

    const maxViewport = Math.min(window.innerWidth - 80, 520);
    const pixelSize = Math.max(8, Math.floor(maxViewport / size));
    grid.style.setProperty('--pixel-size', `${pixelSize}px`);
    grid.style.gridTemplateColumns = `repeat(${size}, var(--pixel-size))`;
    grid.style.gridTemplateRows = `repeat(${size}, var(--pixel-size))`;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const pixel = document.createElement('div');
        pixel.className = 'pixel';
        pixel.dataset.x = String(x);
        pixel.dataset.y = String(y);
        pixel.style.backgroundColor = pixels[y][x];
        grid.appendChild(pixel);
      }
    }

    this.container.appendChild(grid);
    this.container.style.cursor = this.getCursorForTool(this.currentTool);
  }

  private attachEvents(): void {
    const getCoords = (target: EventTarget | null): { x: number; y: number } | null => {
      if (!(target instanceof HTMLElement)) return null;
      const pixelEl = target.closest('.pixel') as HTMLElement | null;
      if (!pixelEl) return null;
      return {
        x: parseInt(pixelEl.dataset.x!, 10),
        y: parseInt(pixelEl.dataset.y!, 10)
      };
    };

    const handleStart = (e: Event) => {
      e.preventDefault();
      this.isDrawing = true;
      this.lastPaintedKey = null;
      if (this.currentTool !== 'picker') {
        this.store.beginStroke();
      }
      const coords = getCoords(e.target);
      if (coords) {
        this.applyTool(coords.x, coords.y);
      }
    };

    const handleMove = (e: Event) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const gridEl = this.container.querySelector('.grid-container')!;
      const rect = gridEl.getBoundingClientRect();
      let clientX: number, clientY: number;
      
      if (e instanceof TouchEvent) {
        if (e.touches.length === 0) return;
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e instanceof MouseEvent) {
        clientX = e.clientX;
        clientY = e.clientY;
      } else {
        return;
      }

      const size = this.store.getGridSize();
      const pixelSize = rect.width / size;
      const x = Math.floor((clientX - rect.left) / pixelSize);
      const y = Math.floor((clientY - rect.top) / pixelSize);

      if (x >= 0 && x < size && y >= 0 && y < size) {
        if (this.currentTool === 'pencil' || this.currentTool === 'eraser') {
          this.applyToolLine(x, y);
        } else {
          this.applyTool(x, y);
        }
      }
    };

    const handleEnd = () => {
      if (this.isDrawing) {
        this.store.endStroke();
      }
      this.isDrawing = false;
      this.lastPaintedKey = null;
    };

    this.container.addEventListener('mousedown', handleStart);
    this.container.addEventListener('touchstart', handleStart, { passive: false });
    this.container.addEventListener('mousemove', handleMove);
    this.container.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);
  }

  private applyToolLine(x: number, y: number): void {
    const key = `${x},${y}`;
    if (this.lastPaintedKey === key) return;

    if (this.lastPaintedKey) {
      const [lx, ly] = this.lastPaintedKey.split(',').map(Number);
      this.bresenhamLine(lx, ly, x, y, (px, py) => {
        this.applyPixel(px, py);
      });
    } else {
      this.applyPixel(x, y);
    }
    this.lastPaintedKey = key;
  }

  private bresenhamLine(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  private applyTool(x: number, y: number): void {
    switch (this.currentTool) {
      case 'pencil':
        this.applyPixel(x, y);
        this.lastPaintedKey = `${x},${y}`;
        break;
      case 'eraser':
        this.erasePixel(x, y);
        this.lastPaintedKey = `${x},${y}`;
        break;
      case 'picker':
        this.pickColor(x, y);
        break;
      case 'fill':
        this.floodFill(x, y);
        break;
    }
  }

  private applyPixel(x: number, y: number): void {
    if (!this.store.applyPixel(x, y, this.currentColor)) return;
    this.pendingPixels.add(`${x},${y}`);
    this.scheduleRender();
  }

  private erasePixel(x: number, y: number): void {
    if (!this.store.erasePixel(x, y)) return;
    this.pendingPixels.add(`${x},${y}`);
    this.scheduleRender();
  }

  private pickColor(x: number, y: number): void {
    const color = this.store.getDisplayPixels()[y][x];
    this.dispatchEvent(new CustomEvent<PixelPickedEventDetail>('pixelpicked', {
      bubbles: true,
      composed: true,
      detail: { color }
    }));
  }

  private floodFill(x: number, y: number): void {
    const changed = this.store.floodFill(x, y, this.currentColor);
    if (changed.length === 0) return;
    for (const [cx, cy] of changed) {
      this.pendingPixels.add(`${cx},${cy}`);
    }
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.flushPending();
      this.rafId = null;
    });
  }

  private flushPending(): void {
    if (this.pendingPixels.size === 0) return;
    const grid = this.container.querySelector('.grid-container')!;
    const size = this.store.getGridSize();
    const pixels = this.store.getDisplayPixels();
    for (const key of this.pendingPixels) {
      const [x, y] = key.split(',').map(Number);
      const index = y * size + x;
      const pixelEl = grid.children[index] as HTMLElement;
      if (pixelEl) {
        pixelEl.style.backgroundColor = pixels[y][x];
      }
    }
    this.pendingPixels.clear();
  }

  private dispatchChange(): void {
    this.dispatchEvent(new CustomEvent<CanvasChangeEventDetail>('canvaschange', {
      bubbles: true,
      composed: true,
      detail: { pixels: this.getPixels() }
    }));
  }
}

customElements.define('pixel-canvas', PixelCanvas);
