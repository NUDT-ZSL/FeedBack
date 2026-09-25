export type PixelData = string[][];
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

const DEFAULT_COLOR = '#ffffff';

export class PixelCanvas extends HTMLElement {
  private gridSize: number = 32;
  private pixels: PixelData = [];
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
    this.render();
    const size = this.getAttribute('size');
    if (size) {
      this.gridSize = parseInt(size, 10);
    }
    this.initPixels();
    this.buildGrid();
    this.attachEvents();
  }

  disconnectedCallback(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (name === 'size' && oldValue !== newValue && this.container) {
      this.gridSize = parseInt(newValue, 10);
      this.initPixels();
      this.buildGrid();
      this.dispatchChange();
    }
  }

  public getGridSize(): number {
    return this.gridSize;
  }

  public setSize(size: number): void {
    this.setAttribute('size', String(size));
  }

  public getPixels(): PixelData {
    return this.pixels.map(row => [...row]);
  }

  public setPixels(pixels: PixelData): void {
    this.pixels = pixels.map(row => [...row]);
    this.gridSize = pixels.length;
    this.buildGrid();
  }

  public resetPixels(size?: number): void {
    if (size !== undefined) {
      this.gridSize = size;
    }
    this.initPixels();
    this.buildGrid();
    this.dispatchChange();
  }

  public setTool(tool: ToolType): void {
    this.currentTool = tool;
    this.container.style.cursor = this.getCursorForTool(tool);
  }

  public setColor(color: string): void {
    this.currentColor = color;
  }

  public toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.gridSize;
    canvas.height = this.gridSize;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        ctx.fillStyle = this.pixels[y][x];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas;
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

  private initPixels(): void {
    this.pixels = [];
    for (let y = 0; y < this.gridSize; y++) {
      const row: string[] = [];
      for (let x = 0; x < this.gridSize; x++) {
        row.push(DEFAULT_COLOR);
      }
      this.pixels.push(row);
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

    const grid = document.createElement('div');
    grid.className = 'grid-container';

    const maxViewport = Math.min(window.innerWidth - 80, 520);
    const pixelSize = Math.max(8, Math.floor(maxViewport / this.gridSize));
    grid.style.setProperty('--pixel-size', `${pixelSize}px`);
    grid.style.gridTemplateColumns = `repeat(${this.gridSize}, var(--pixel-size))`;
    grid.style.gridTemplateRows = `repeat(${this.gridSize}, var(--pixel-size))`;

    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const pixel = document.createElement('div');
        pixel.className = 'pixel';
        pixel.dataset.x = String(x);
        pixel.dataset.y = String(y);
        pixel.style.backgroundColor = this.pixels[y][x];
        grid.appendChild(pixel);
      }
    }

    this.container.appendChild(grid);
    this.container.style.cursor = this.getCursorForTool(this.currentTool);
  }

  private attachEvents(): void {
    const grid = this.container.querySelector('.grid-container')!;

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

      const pixelSize = rect.width / this.gridSize;
      const x = Math.floor((clientX - rect.left) / pixelSize);
      const y = Math.floor((clientY - rect.top) / pixelSize);

      if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
        if (this.currentTool === 'pencil' || this.currentTool === 'eraser') {
          this.applyToolLine(x, y);
        } else {
          this.applyTool(x, y);
        }
      }
    };

    const handleEnd = () => {
      if (this.isDrawing && this.pendingPixels.size > 0) {
        this.flushPending();
        this.dispatchChange();
      }
      this.isDrawing = false;
      this.lastPaintedKey = null;
    };

    grid.addEventListener('mousedown', handleStart);
    grid.addEventListener('touchstart', handleStart, { passive: false });
    grid.addEventListener('mousemove', handleMove);
    grid.addEventListener('touchmove', handleMove, { passive: false });
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
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return;
    if (this.pixels[y][x] === this.currentColor) return;
    this.pixels[y][x] = this.currentColor;
    this.pendingPixels.add(`${x},${y}`);
    this.scheduleRender();
  }

  private erasePixel(x: number, y: number): void {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return;
    if (this.pixels[y][x] === DEFAULT_COLOR) return;
    this.pixels[y][x] = DEFAULT_COLOR;
    this.pendingPixels.add(`${x},${y}`);
    this.scheduleRender();
  }

  private pickColor(x: number, y: number): void {
    const color = this.pixels[y][x];
    this.dispatchEvent(new CustomEvent<PixelPickedEventDetail>('pixelpicked', {
      bubbles: true,
      composed: true,
      detail: { color }
    }));
  }

  private floodFill(x: number, y: number): void {
    const targetColor = this.pixels[y][x];
    const fillColor = this.currentTool === 'fill' ? this.currentColor : DEFAULT_COLOR;
    if (targetColor === fillColor) return;

    const stack: Array<[number, number]> = [[x, y]];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      if (cx < 0 || cx >= this.gridSize || cy < 0 || cy >= this.gridSize) continue;
      if (this.pixels[cy][cx] !== targetColor) continue;

      visited.add(key);
      this.pixels[cy][cx] = fillColor;
      this.pendingPixels.add(key);

      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
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
    for (const key of this.pendingPixels) {
      const [x, y] = key.split(',').map(Number);
      const index = y * this.gridSize + x;
      const pixelEl = grid.children[index] as HTMLElement;
      if (pixelEl) {
        pixelEl.style.backgroundColor = this.pixels[y][x];
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
