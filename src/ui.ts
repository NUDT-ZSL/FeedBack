import { FURNITURE_TYPES, FurnitureItem } from './furniture';

const ICONS: Record<string, string> = {
  sofa: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 9V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2"/>
    <path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0Z"/>
    <path d="M4 18v2"/>
    <path d="M20 18v2"/>
  </svg>`,
  table: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v18"/>
    <path d="M3 8h18"/>
    <path d="M3 16h18"/>
    <path d="M8 3v18"/>
    <path d="M16 3v18"/>
  </svg>`,
  chair: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 13v5"/>
    <path d="M17 13v5"/>
    <path d="M7 8h10v5H7z"/>
    <path d="M7 8V4h10v4"/>
    <path d="M5 18h14"/>
  </svg>`,
  bookshelf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="1"/>
    <path d="M3 8h18"/>
    <path d="M3 14h18"/>
    <path d="M7 3v18"/>
    <path d="M17 3v18"/>
  </svg>`,
  bed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 4v16"/>
    <path d="M2 8h18a2 2 0 0 1 2 2v10"/>
    <path d="M2 17h20"/>
    <path d="M6 8v9"/>
    <path d="M18 8v9"/>
  </svg>`
};

export interface UICallbacks {
  onAddFurniture: (type: string) => void;
  onRotate: () => void;
  onDelete: () => void;
}

export class UIManager {
  private toolbar: HTMLElement;
  private callbacks: UICallbacks;
  private selectedItem: FurnitureItem | null = null;
  private buttons: Map<string, HTMLButtonElement> = new Map();

  constructor(toolbarId: string, callbacks: UICallbacks) {
    const toolbar = document.getElementById(toolbarId);
    if (!toolbar) throw new Error(`Toolbar element #${toolbarId} not found`);
    
    this.toolbar = toolbar;
    this.callbacks = callbacks;
    
    this.createButtons();
    this.bindKeyboardEvents();
  }

  private createButtons(): void {
    const types = Object.keys(FURNITURE_TYPES);
    
    for (const type of types) {
      const data = FURNITURE_TYPES[type];
      const btn = document.createElement('button');
      btn.className = 'toolbar-btn';
      btn.title = data.name;
      btn.innerHTML = ICONS[type] + `<span>${data.name}</span>`;
      
      btn.addEventListener('click', () => {
        this.callbacks.onAddFurniture(type);
        this.highlightButton(type);
      });
      
      this.toolbar.appendChild(btn);
      this.buttons.set(type, btn);
    }
  }

  private highlightButton(type: string): void {
    this.buttons.forEach((btn, t) => {
      if (t === type) {
        btn.style.boxShadow = '0 0 0 3px rgba(212, 165, 116, 0.5), 0 4px 16px rgba(212, 165, 116, 0.4)';
      } else {
        btn.style.boxShadow = '';
      }
    });
    
    setTimeout(() => {
      this.buttons.forEach((btn) => {
        btn.style.boxShadow = '';
      });
    }, 500);
  }

  private bindKeyboardEvents(): void {
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this.callbacks.onRotate();
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.callbacks.onDelete();
      }
    });
  }

  setSelectedItem(item: FurnitureItem | null): void {
    this.selectedItem = item;
  }

  getSelectedItem(): FurnitureItem | null {
    return this.selectedItem;
  }

  dispose(): void {
    this.buttons.clear();
  }
}
