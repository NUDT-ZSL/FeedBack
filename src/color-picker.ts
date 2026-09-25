export interface ColorPickedEventDetail {
  color: string;
}

const PRESET_COLORS: string[] = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#ff6600',
  '#ffcc00',
  '#33cc33',
  '#0099ff',
  '#6633ff',
  '#ff3399',
  '#996633',
  '#999999',
  '#00ffff'
];

export class ColorPicker extends HTMLElement {
  private selectedColor: string = '#000000';
  private container!: HTMLDivElement;
  private styleEl!: HTMLStyleElement;
  private previewEl!: HTMLDivElement;
  private hexInputEl!: HTMLInputElement;
  private nativePickerEl!: HTMLInputElement;

  static get observedAttributes(): string[] {
    return ['color'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    const colorAttr = this.getAttribute('color');
    if (colorAttr) {
      this.selectedColor = colorAttr;
    }
    this.render();
    this.attachEvents();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (name === 'color' && oldValue !== newValue) {
      this.selectedColor = newValue;
      if (this.previewEl) {
        this.updatePreview();
      }
      if (this.hexInputEl) {
        this.hexInputEl.value = newValue.toUpperCase();
      }
      if (this.nativePickerEl) {
        this.nativePickerEl.value = newValue;
      }
      this.updatePresetSelection();
    }
  }

  public getColor(): string {
    return this.selectedColor;
  }

  public setColor(color: string): void {
    this.setAttribute('color', color);
  }

  private render(): void {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      :host {
        display: block;
      }
      .picker-container {
        background-color: #16213e;
        padding: 16px;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .picker-title {
        font-size: 14px;
        font-weight: 600;
        color: #b0b0c0;
        margin: 0;
      }
      .current-color {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .color-preview {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        border: 2px solid #3a3a5c;
        min-width: 48px;
        background-color: #ffffff;
        position: relative;
        cursor: pointer;
        overflow: hidden;
      }
      .color-preview::after {
        content: '🎨';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;
        font-size: 20px;
      }
      .color-preview:hover::after {
        opacity: 1;
      }
      .color-preview:hover {
        border-color: #e94560;
      }
      .color-inputs {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-width: 0;
      }
      .hex-input {
        background-color: #0f3460;
        color: #ffffff;
        border: 1px solid #3a3a5c;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 14px;
        font-family: 'Courier New', monospace;
        text-transform: uppercase;
        min-height: 44px;
        width: 100%;
        box-sizing: border-box;
      }
      .hex-input:focus {
        outline: none;
        border-color: #e94560;
      }
      .hex-label {
        font-size: 11px;
        color: #8080a0;
      }
      .native-picker-wrapper {
        position: relative;
        height: 0;
        width: 0;
        overflow: hidden;
      }
      .native-picker {
        position: absolute;
        left: -9999px;
        opacity: 0;
        pointer-events: none;
      }
      .preset-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 8px;
      }
      .preset-color {
        aspect-ratio: 1;
        min-height: 44px;
        min-width: 44px;
        border-radius: 6px;
        border: 2px solid #3a3a5c;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }
      .preset-color:hover {
        transform: translateY(-2px);
        border-color: #e94560;
      }
      .preset-color.selected {
        border-color: #e94560;
        box-shadow: 0 0 0 2px rgba(233, 69, 96, 0.4);
      }
      .preset-color.selected::after {
        content: '✓';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 18px;
        font-weight: bold;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
      }
      @media (max-width: 768px) {
        .preset-grid {
          grid-template-columns: repeat(6, 1fr);
        }
        .preset-color {
          min-height: 40px;
          min-width: 40px;
        }
      }
    `;

    this.container = document.createElement('div');
    this.container.className = 'picker-container';

    this.container.innerHTML = `
      <h3 class="picker-title">🎨 颜色选择</h3>
      <div class="current-color">
        <div class="color-preview" id="colorPreview"></div>
        <div class="color-inputs">
          <span class="hex-label">HEX 颜色值</span>
          <input type="text" class="hex-input" id="hexInput" maxlength="7" placeholder="#000000" />
        </div>
        <div class="native-picker-wrapper">
          <input type="color" class="native-picker" id="nativePicker" />
        </div>
      </div>
      <div class="preset-grid" id="presetGrid"></div>
    `;

    this.shadowRoot!.appendChild(this.styleEl);
    this.shadowRoot!.appendChild(this.container);

    this.previewEl = this.container.querySelector('#colorPreview') as HTMLDivElement;
    this.hexInputEl = this.container.querySelector('#hexInput') as HTMLInputElement;
    this.nativePickerEl = this.container.querySelector('#nativePicker') as HTMLInputElement;

    this.updatePreview();
    this.hexInputEl.value = this.selectedColor.toUpperCase();
    this.nativePickerEl.value = this.selectedColor;
    this.renderPresets();
  }

  private renderPresets(): void {
    const grid = this.container.querySelector('#presetGrid')!;
    grid.innerHTML = '';
    PRESET_COLORS.forEach(color => {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = 'preset-color';
      div.style.backgroundColor = color;
      div.dataset.color = color;
      div.setAttribute('aria-label', `选择颜色 ${color}`);
      if (this.colorsEqual(color, this.selectedColor)) {
        div.classList.add('selected');
      }
      grid.appendChild(div);
    });
  }

  private updatePresetSelection(): void {
    const presets = this.container.querySelectorAll('.preset-color');
    presets.forEach(el => {
      const btn = el as HTMLButtonElement;
      if (this.colorsEqual(btn.dataset.color!, this.selectedColor)) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  private updatePreview(): void {
    this.previewEl.style.backgroundColor = this.selectedColor;
  }

  private colorsEqual(c1: string, c2: string): boolean {
    return c1.toLowerCase() === c2.toLowerCase();
  }

  private isValidHex(color: string): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
  }

  private normalizeHex(color: string): string {
    if (color.length === 4) {
      return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    return color;
  }

  private attachEvents(): void {
    const grid = this.container.querySelector('#presetGrid')!;
    grid.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const preset = target.closest('.preset-color') as HTMLButtonElement | null;
      if (preset && preset.dataset.color) {
        this.selectColor(preset.dataset.color);
      }
    });

    this.previewEl.addEventListener('click', () => {
      this.nativePickerEl.click();
    });

    this.nativePickerEl.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.selectColor(target.value);
    });

    this.hexInputEl.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      let value = target.value.trim();
      if (!value.startsWith('#')) {
        value = '#' + value;
      }
      if (this.isValidHex(value)) {
        this.selectColor(this.normalizeHex(value));
      } else {
        target.value = this.selectedColor.toUpperCase();
      }
    });

    this.hexInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.hexInputEl.blur();
      }
    });
  }

  private selectColor(color: string): void {
    this.selectedColor = color;
    this.updatePreview();
    this.hexInputEl.value = color.toUpperCase();
    this.nativePickerEl.value = color;
    this.updatePresetSelection();
    this.dispatchEvent(new CustomEvent<ColorPickedEventDetail>('colorpicked', {
      bubbles: true,
      composed: true,
      detail: { color }
    }));
  }
}

customElements.define('color-picker', ColorPicker);
