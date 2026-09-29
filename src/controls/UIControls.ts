import type { FaultType, FaultParams } from '../geologyModule/FaultGenerator';

export interface UICallbacks {
  onFaultTypeChange: (type: FaultType) => void;
  onFaultParamChange: (params: Partial<FaultParams>) => void;
  onPickSource: () => void;
  onIntensityChange: (intensity: number) => void;
  onReset: () => void;
  onTerrainOpacity: (opacity: number) => void;
  onTerrainAmplitude: (amplitude: number) => void;
  onClipAxis: (axis: 'x' | 'z' | null) => void;
  onClipPosition: (position: number) => void;
}

interface SliderConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
}

export class UIControls {
  private panel: HTMLElement;
  private mobileBar: HTMLElement;
  private callbacks: UICallbacks;
  private faultParams: FaultParams;
  private intensity: number;
  private terrainOpacity: number;
  private terrainAmplitude: number;
  private clipAxis: 'x' | 'z' | null;
  private clipPosition: number;

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;
    this.panel = document.getElementById('ui-panel')!;
    this.mobileBar = document.getElementById('mobile-bar')!;

    this.faultParams = {
      type: 'normal',
      dip: 60,
      strike: 0,
      displacement: 60
    };
    this.intensity = 5;
    this.terrainOpacity = 0.85;
    this.terrainAmplitude = 20;
    this.clipAxis = null;
    this.clipPosition = 0;

    this.initPanel();
    this.initMobileBar();
  }

  private initPanel(): void {
    this.bindFaultTypeButtons();
    this.addCard('fault-card', '断层参数', this.buildFaultSliders(), true);
    this.addCard('quake-card', '地震参数', this.buildQuakeControls(), true);
    this.addCard('scene-card', '场景设置', this.buildSceneControls(), false);
  }

  private bindFaultTypeButtons(): void {
    const group = document.getElementById('fault-type-group')!;
    const buttons = group.querySelectorAll('.fault-btn');

    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.createRipple(btn as HTMLElement, e as MouseEvent);
        const type = (btn as HTMLElement).dataset.type as FaultType;
        this.setFaultType(type);
        this.callbacks.onFaultTypeChange(type);
      });
    });
  }

  private createRipple(el: HTMLElement, event: MouseEvent): void {
    const rect = el.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = event.clientX - rect.left - size / 2 + 'px';
    ripple.style.top = event.clientY - rect.top - size / 2 + 'px';
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 400);
  }

  private setFaultType(type: FaultType): void {
    this.faultParams.type = type;
    const group = document.getElementById('fault-type-group')!;
    group.querySelectorAll('.fault-btn').forEach((btn) => {
      if ((btn as HTMLElement).dataset.type === type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private addCard(id: string, title: string, bodyHtml: string, expanded: boolean): void {
    const card = document.createElement('div');
    card.className = 'card' + (expanded ? '' : ' collapsed');
    card.id = id;
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${title}</span>
        <span class="card-arrow">▼</span>
      </div>
      <div class="card-body">${bodyHtml}</div>
    `;
    this.panel.appendChild(card);

    const header = card.querySelector('.card-header')!;
    header.addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });
  }

  private buildFaultSliders(): string {
    const sliders: SliderConfig[] = [
      { key: 'dip', label: '倾角', min: 30, max: 90, step: 1, value: 60, unit: '°' },
      { key: 'strike', label: '走向', min: 0, max: 360, step: 1, value: 0, unit: '°' },
      { key: 'displacement', label: '垂直位移', min: 0, max: 200, step: 1, value: 60, unit: '' }
    ];

    return sliders
      .map(
        (s) => `
      <div class="slider-group" data-key="${s.key}">
        <div class="slider-label">
          <span>${s.label}</span>
          <span class="slider-value">${s.value}${s.unit || ''}</span>
        </div>
        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" />
      </div>
    `
      )
      .join('');
  }

  private buildQuakeControls(): string {
    return `
      <button class="action-btn primary" id="pick-source-btn">🎯 选择震源位置</button>
      <div class="slider-group" data-key="intensity">
        <div class="slider-label">
          <span>地震强度</span>
          <span class="slider-value">${this.intensity} 级</span>
        </div>
        <input type="range" min="1" max="10" step="1" value="${this.intensity}" />
      </div>
      <button class="action-btn" id="reset-btn">↺ 重置场景</button>
    `;
  }

  private buildSceneControls(): string {
    return `
      <div class="slider-group" data-key="terrainOpacity">
        <div class="slider-label">
          <span>地表透明度</span>
          <span class="slider-value">${this.terrainOpacity.toFixed(2)}</span>
        </div>
        <input type="range" min="0.2" max="1.0" step="0.01" value="${this.terrainOpacity}" />
      </div>
      <div class="slider-group" data-key="terrainAmplitude">
        <div class="slider-label">
          <span>地形起伏幅度</span>
          <span class="slider-value">${this.terrainAmplitude}</span>
        </div>
        <input type="range" min="0" max="60" step="1" value="${this.terrainAmplitude}" />
      </div>
      <div class="axis-toggle" id="axis-toggle">
        <button class="axis-btn" data-axis="none" ${this.clipAxis === null ? 'class="axis-btn active"' : 'class="axis-btn"'}>无切割</button>
        <button class="axis-btn" data-axis="x" ${this.clipAxis === 'x' ? 'class="axis-btn active"' : 'class="axis-btn"'}>X轴切割</button>
        <button class="axis-btn" data-axis="z" ${this.clipAxis === 'z' ? 'class="axis-btn active"' : 'class="axis-btn"'}>Z轴切割</button>
      </div>
      <div class="slider-group" data-key="clipPosition" style="${this.clipAxis === null ? 'display:none;' : ''}">
        <div class="slider-label">
          <span>切割位置</span>
          <span class="slider-value">${this.clipPosition}</span>
        </div>
        <input type="range" min="-200" max="200" step="1" value="${this.clipPosition}" />
      </div>
    `;
  }

  public bindAllEvents(): void {
    this.bindSliders();
    this.bindButtons();
    this.bindAxisToggle();
  }

  private bindSliders(): void {
    const groups = this.panel.querySelectorAll('.slider-group');

    groups.forEach((group) => {
      const key = (group as HTMLElement).dataset.key!;
      const input = group.querySelector('input[type="range"]') as HTMLInputElement;
      const valueEl = group.querySelector('.slider-value') as HTMLElement;

      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        this.updateSliderDisplay(key, value, valueEl);
        this.handleSliderChange(key, value);
      });
    });
  }

  private updateSliderDisplay(key: string, value: number, el: HTMLElement): void {
    const unitMap: Record<string, string> = {
      dip: '°',
      strike: '°',
      intensity: ' 级',
      terrainOpacity: '',
      terrainAmplitude: '',
      clipPosition: '',
      displacement: ''
    };
    const unit = unitMap[key] || '';
    const display = key === 'terrainOpacity' ? value.toFixed(2) : value.toString();
    el.textContent = display + unit;
  }

  private handleSliderChange(key: string, value: number): void {
    switch (key) {
      case 'dip':
        this.faultParams.dip = value;
        this.callbacks.onFaultParamChange({ dip: value });
        break;
      case 'strike':
        this.faultParams.strike = value;
        this.callbacks.onFaultParamChange({ strike: value });
        break;
      case 'displacement':
        this.faultParams.displacement = value;
        this.callbacks.onFaultParamChange({ displacement: value });
        break;
      case 'intensity':
        this.intensity = value;
        this.callbacks.onIntensityChange(value);
        break;
      case 'terrainOpacity':
        this.terrainOpacity = value;
        this.callbacks.onTerrainOpacity(value);
        break;
      case 'terrainAmplitude':
        this.terrainAmplitude = value;
        this.callbacks.onTerrainAmplitude(value);
        break;
      case 'clipPosition':
        this.clipPosition = value;
        this.callbacks.onClipPosition(value);
        break;
    }
  }

  private bindButtons(): void {
    const pickBtn = document.getElementById('pick-source-btn');
    if (pickBtn) {
      pickBtn.addEventListener('click', (e) => {
        this.createRipple(pickBtn, e as MouseEvent);
        this.callbacks.onPickSource();
      });
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        this.createRipple(resetBtn, e as MouseEvent);
        this.callbacks.onReset();
      });
    }
  }

  private bindAxisToggle(): void {
    const toggle = document.getElementById('axis-toggle');
    if (!toggle) return;

    const buttons = toggle.querySelectorAll('.axis-btn');
    const clipSliderGroup = this.panel.querySelector('[data-key="clipPosition"]') as HTMLElement;

    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.createRipple(btn as HTMLElement, e as MouseEvent);
        const axis = (btn as HTMLElement).dataset.axis as 'none' | 'x' | 'z';
        const parsedAxis: 'x' | 'z' | null = axis === 'none' ? null : axis;

        this.clipAxis = parsedAxis;
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        if (clipSliderGroup) {
          clipSliderGroup.style.display = parsedAxis === null ? 'none' : 'block';
        }

        this.callbacks.onClipAxis(parsedAxis);
      });
    });
  }

  private initMobileBar(): void {
    const items = [
      { icon: '🔴', label: '正断层', action: () => this.setMobileFault('normal') },
      { icon: '🔵', label: '逆断层', action: () => this.setMobileFault('reverse') },
      { icon: '🟢', label: '平移', action: () => this.setMobileFault('strike-slip') },
      { icon: '🎯', label: '震源', action: () => this.callbacks.onPickSource() },
      { icon: '📊', label: '参数', action: () => this.showMobilePanel() },
      { icon: '↺', label: '重置', action: () => this.callbacks.onReset() }
    ];

    items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'mobile-item';
      el.textContent = item.icon;
      el.title = item.label;
      el.addEventListener('click', item.action);
      if (idx === 0) el.classList.add('active');
      this.mobileBar.appendChild(el);
    });
  }

  private setMobileFault(type: FaultType): void {
    this.setFaultType(type);
    this.callbacks.onFaultTypeChange(type);
    const items = this.mobileBar.querySelectorAll('.mobile-item');
    items.forEach((it, i) => {
      if (i < 3) it.classList.remove('active');
    });
    const idx = type === 'normal' ? 0 : type === 'reverse' ? 1 : 2;
    items[idx]?.classList.add('active');
  }

  private showMobilePanel(): void {
    if (window.innerWidth <= 768) {
      this.panel.style.display = 'block';
      this.panel.style.left = '8px';
      this.panel.style.right = '8px';
      this.panel.style.top = '8px';
      this.panel.style.bottom = '76px';
      this.panel.style.width = 'auto';
    }
  }

  public getFaultParams(): FaultParams {
    return { ...this.faultParams };
  }

  public getIntensity(): number {
    return this.intensity;
  }

  public getTerrainOpacity(): number {
    return this.terrainOpacity;
  }

  public getTerrainAmplitude(): number {
    return this.terrainAmplitude;
  }

  public setPickMode(active: boolean): void {
    const btn = document.getElementById('pick-source-btn');
    if (btn) {
      if (active) {
        btn.textContent = '👆 点击地表选择震源...';
        btn.style.boxShadow = '0 0 20px rgba(255, 0, 170, 0.8)';
      } else {
        btn.textContent = '🎯 选择震源位置';
        btn.style.boxShadow = '';
      }
    }
  }
}
