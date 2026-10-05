import { FURNITURE_TYPES, SelectionInfo } from './furniture';

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
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>`,
  ungroup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="m5.17 11.75-1.72 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71"/>
    <line x1="8" x2="8" y1="2" y2="5"/>
    <line x1="2" x2="5" y1="8" y2="8"/>
    <line x1="16" x2="16" y1="19" y2="22"/>
    <line x1="19" x2="22" y1="16" y2="16"/>
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
  private infoPanel: HTMLElement;
  private callbacks: UICallbacks;
  private buttons: Map<string, HTMLButtonElement> = new Map();
  private groupButton!: HTMLButtonElement;
  private ungroupButton!: HTMLButtonElement;

  constructor(toolbarId: string, callbacks: UICallbacks) {
    const toolbar = document.getElementById(toolbarId);
    if (!toolbar) throw new Error(`Toolbar element #${toolbarId} not found`);

    this.toolbar = toolbar;
    this.callbacks = callbacks;
    this.infoPanel = this.createInfoPanel();

    this.createButtons();
    this.bindKeyboardEvents();
  }

  private createInfoPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'selection-info';
    panel.style.display = 'none';
    this.toolbar.parentElement?.appendChild(panel);
    return panel;
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

    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.height = '1px';
    divider.style.background = 'rgba(212, 165, 116, 0.3)';
    this.toolbar.appendChild(divider);

    this.groupButton = this.createActionButton('group', '分组', '将选中的家具编为一组');
    this.groupButton.addEventListener('click', () => this.callbacks.onGroup());
    this.ungroupButton = this.createActionButton('ungroup', '取消分组', '解散当前选中的组');
    this.ungroupButton.addEventListener('click', () => this.callbacks.onUngroup());
  }

  private createActionButton(id: string, label: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn action-btn';
    btn.title = title;
    btn.innerHTML = ICONS[id] + `<span>${label}</span>`;
    this.toolbar.appendChild(btn);
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

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.callbacks.onDelete();
      }
    });
  }

  setSelection(info: SelectionInfo): void {
    let text = '';

    if (info.kind === 'none') {
      text = '';
    } else if (info.kind === 'single') {
      text = info.item.data.name;
    } else if (info.kind === 'multi') {
      text = `已选 ${info.items.length} 件家具`;
    } else {
      text = `${info.group.name} · ${info.items.length} 件家具`;
    }

    if (text) {
      this.infoPanel.textContent = text;
      this.infoPanel.style.display = 'block';
    } else {
      this.infoPanel.style.display = 'none';
    }

    this.groupButton.disabled = !(info.kind === 'multi' && info.items.length >= 2);
    this.ungroupButton.disabled = info.kind !== 'group';
  }

  dispose(): void {
    this.buttons.clear();
    this.infoPanel.remove();
  }
}
