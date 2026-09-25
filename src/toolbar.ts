import type { ToolType } from './pixel-canvas.ts';

export interface ToolSelectedEventDetail {
  tool: ToolType;
}

interface ToolConfig {
  id: ToolType;
  icon: string;
  label: string;
  description: string;
}

const TOOLS: ToolConfig[] = [
  { id: 'pencil', icon: '✏️', label: '铅笔', description: '点击或拖拽绘制像素' },
  { id: 'eraser', icon: '🧹', label: '橡皮', description: '清除像素颜色' },
  { id: 'picker', icon: '💧', label: '取色', description: '点击像素获取颜色' },
  { id: 'fill', icon: '🪣', label: '填充', description: '填充相邻同色区域' }
];

export class PixelToolbar extends HTMLElement {
  private selectedTool: ToolType = 'pencil';
  private container!: HTMLDivElement;
  private styleEl!: HTMLStyleElement;
  private buttons: Map<ToolType, HTMLButtonElement> = new Map();

  static get observedAttributes(): string[] {
    return ['tool'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    const toolAttr = this.getAttribute('tool') as ToolType | null;
    if (toolAttr && this.isValidTool(toolAttr)) {
      this.selectedTool = toolAttr;
    }
    this.render();
    this.attachEvents();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (name === 'tool' && oldValue !== newValue && this.isValidTool(newValue as ToolType)) {
      this.selectedTool = newValue as ToolType;
      this.updateButtonStates();
    }
  }

  public getTool(): ToolType {
    return this.selectedTool;
  }

  public setTool(tool: ToolType): void {
    if (this.isValidTool(tool)) {
      this.setAttribute('tool', tool);
    }
  }

  private isValidTool(tool: string): tool is ToolType {
    return tool === 'pencil' || tool === 'eraser' || tool === 'picker' || tool === 'fill';
  }

  private render(): void {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      :host {
        display: block;
      }
      .toolbar-container {
        background-color: #16213e;
        padding: 16px;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .toolbar-title {
        font-size: 14px;
        font-weight: 600;
        color: #b0b0c0;
        margin: 0;
      }
      .tool-buttons {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      .tool-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-height: 72px;
        min-width: 72px;
        padding: 12px 8px;
        border: 2px solid #3a3a5c;
        border-radius: 8px;
        background-color: #1a1a2e;
        color: #e0e0e0;
        cursor: pointer;
        transition: all 0.2s ease;
        touch-action: manipulation;
      }
      .tool-btn:hover {
        transform: translateY(-2px);
        border-color: #5a5a7c;
        background-color: #1f2040;
      }
      .tool-btn:active {
        transform: translateY(0);
      }
      .tool-btn.active {
        background-color: #0f3460;
        border-color: #e94560;
        box-shadow: 0 2px 10px rgba(233, 69, 96, 0.3);
      }
      .tool-icon {
        font-size: 24px;
        line-height: 1;
      }
      .tool-label {
        font-size: 12px;
        font-weight: 500;
      }
      .tool-btn.active .tool-label {
        color: #ffffff;
      }
      .hint {
        font-size: 11px;
        color: #666688;
        text-align: center;
        margin: 0;
        line-height: 1.4;
      }
      @media (max-width: 768px) {
        .tool-buttons {
          grid-template-columns: repeat(4, 1fr);
        }
        .tool-btn {
          min-height: 64px;
          min-width: 64px;
          padding: 8px 4px;
        }
        .tool-label {
          font-size: 11px;
        }
      }
    `;

    this.container = document.createElement('div');
    this.container.className = 'toolbar-container';

    let buttonsHtml = '';
    for (const tool of TOOLS) {
      const isActive = tool.id === this.selectedTool;
      buttonsHtml += `
        <button type="button" class="tool-btn ${isActive ? 'active' : ''}" data-tool="${tool.id}" aria-label="${tool.description}" title="${tool.description}">
          <span class="tool-icon">${tool.icon}</span>
          <span class="tool-label">${tool.label}</span>
        </button>
      `;
    }

    this.container.innerHTML = `
      <h3 class="toolbar-title">🛠️ 绘图工具</h3>
      <div class="tool-buttons">
        ${buttonsHtml}
      </div>
      <p class="hint" id="toolHint">${this.getHintForTool(this.selectedTool)}</p>
    `;

    this.shadowRoot!.appendChild(this.styleEl);
    this.shadowRoot!.appendChild(this.container);

    this.cacheButtons();
  }

  private cacheButtons(): void {
    this.buttons.clear();
    const btnEls = this.container.querySelectorAll('.tool-btn');
    btnEls.forEach(btn => {
      const toolId = (btn as HTMLButtonElement).dataset.tool as ToolType;
      if (toolId) {
        this.buttons.set(toolId, btn as HTMLButtonElement);
      }
    });
  }

  private getHintForTool(tool: ToolType): string {
    const config = TOOLS.find(t => t.id === tool);
    return config ? config.description : '';
  }

  private updateButtonStates(): void {
    this.buttons.forEach((btn, toolId) => {
      if (toolId === this.selectedTool) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    const hintEl = this.container.querySelector('#toolHint') as HTMLParagraphElement | null;
    if (hintEl) {
      hintEl.textContent = this.getHintForTool(this.selectedTool);
    }
  }

  private attachEvents(): void {
    const buttonsContainer = this.container.querySelector('.tool-buttons')!;
    buttonsContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.tool-btn') as HTMLButtonElement | null;
      if (btn && btn.dataset.tool) {
        const tool = btn.dataset.tool as ToolType;
        this.selectTool(tool);
      }
    });

    buttonsContainer.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        const target = e.target as HTMLElement;
        const btn = target.closest('.tool-btn') as HTMLButtonElement | null;
        if (btn && btn.dataset.tool) {
          e.preventDefault();
          const tool = btn.dataset.tool as ToolType;
          this.selectTool(tool);
        }
      }
    });
  }

  private selectTool(tool: ToolType): void {
    if (tool === this.selectedTool) return;
    this.selectedTool = tool;
    this.updateButtonStates();
    this.dispatchEvent(new CustomEvent<ToolSelectedEventDetail>('toolselected', {
      bubbles: true,
      composed: true,
      detail: { tool }
    }));
  }
}

customElements.define('pixel-toolbar', PixelToolbar);
