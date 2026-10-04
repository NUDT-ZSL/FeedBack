import { FURNITURE_TYPES, FurnitureGroup, FurnitureItem } from './furniture';

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
  </svg>`,
  group: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
    <path d="M10 6.5h4a3 3 0 0 1 3 3V14"/>
    <path d="m15.5 12 1.5 2 1.5-2"/>
  </svg>`,
  ungroup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
    <path d="M10 6.5h4"/>
    <path d="m12 4.5 2 2-2 2"/>
    <path d="M14 17.5h-4"/>
    <path d="m12 15.5-2 2 2 2"/>
  </svg>`
};

export interface UICallbacks {
  onAddFurniture: (type: string) => void;
  onRotate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}

export class UIManager {
  private toolbar: HTMLElement;
  private callbacks: UICallbacks;
  private selectedItems: FurnitureItem[] = [];
  private selectedGroup: FurnitureGroup | null = null;
  private buttons: Map<string, HTMLButtonElement> = new Map();
  private groupBtn!: HTMLButtonElement;
  private ungroupBtn!: HTMLButtonElement;
  private infoPanel: HTMLElement;

  constructor(toolbarId: string, callbacks: UICallbacks) {
    const toolbar = document.getElementById(toolbarId);
    if (!toolbar) throw new Error(`Toolbar element #${toolbarId} not found`);

    this.toolbar = toolbar;
    this.callbacks = callbacks;

    this.infoPanel = document.createElement('div');
    this.infoPanel.id = 'selection-info';
    const app = document.getElementById('app');
    if (app) app.appendChild(this.infoPanel);

    this.createButtons();
    this.bindKeyboardEvents();
    this.updateSelectionUI();
  }

  private createButtons(): void {
    const types = Object.keys(FURNITURE_TYPES);

    for (const type of types) {
      const data = FURNITURE_TYPES[type];
      const btn = document.createElement('button');
      btn.className = 'toolbar-btn';
      btn.title = `添加${data.name}`;
      btn.innerHTML = ICONS[type] + `<span>${data.name}</span>`;

      btn.addEventListener('click', () => {
        this.callbacks.onAddFurniture(type);
        this.highlightButton(type);
      });

      this.toolbar.appendChild(btn);
      this.buttons.set(type, btn);
    }

    const divider = document.createElement('div');
    divider.className = 'toolbar-divider';
    this.toolbar.appendChild(divider);

    this.groupBtn = this.createActionButton('group', '分组', () => {
      this.callbacks.onGroup();
    });
    this.toolbar.appendChild(this.groupBtn);

    this.ungroupBtn = this.createActionButton('ungroup', '取消分组', () => {
      this.callbacks.onUngroup();
    });
    this.toolbar.appendChild(this.ungroupBtn);
  }

  private createActionButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn action-btn';
    btn.title = label;
    btn.innerHTML = ICONS[icon] + `<span>${label}</span>`;
    btn.addEventListener('click', onClick);
    return btn;
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

      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this.callbacks.onGroup();
      }

      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        this.callbacks.onUngroup();
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.callbacks.onDelete();
      }
    });
  }

  setSelection(items: FurnitureItem[], group: FurnitureGroup | null): void {
    this.selectedItems = items;
    this.selectedGroup = group;
    this.updateSelectionUI();
  }

  private updateSelectionUI(): void {
    let text = '';

    if (this.selectedGroup) {
      text = `${this.selectedGroup.name} · ${this.selectedGroup.memberIds.size} 件家具`;
    } else if (this.selectedItems.length > 1) {
      text = `已选 ${this.selectedItems.length} 件家具`;
    } else if (this.selectedItems.length === 1) {
      text = this.selectedItems[0].data.name;
    }

    if (text) {
      this.infoPanel.textContent = text;
      this.infoPanel.style.display = 'block';
    } else {
      this.infoPanel.style.display = 'none';
    }

    this.groupBtn.disabled = this.selectedItems.length < 2;
    this.ungroupBtn.disabled = !this.selectedItems.some((item) => item.groupId);
  }

  dispose(): void {
    this.buttons.clear();
    this.infoPanel.remove();
  }
}
