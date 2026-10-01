import { SequencerModule, INSTRUMENTS, PRESETS, Instrument, InstrumentParams, GridState, Preset } from './sequencer.js';
import { RecorderModule } from './recorder.js';

export interface UIContainerRefs {
  topBar: HTMLElement;
  controlPanel: HTMLElement;
  gridContainer: HTMLElement;
  visualizerContainer: HTMLElement;
  recorderContainer: HTMLElement;
  visualizerCanvas: HTMLCanvasElement;
  waveformCanvas: HTMLCanvasElement;
}

export class UIModule {
  private app: HTMLElement;
  private sequencer: SequencerModule;
  private recorder: RecorderModule;
  private refs: UIContainerRefs | null = null;
  private gridCells: HTMLDivElement[][] = [];
  private highlightedCol: number = -1;
  private isCompact: boolean = false;
  private cellSize: number = 40;
  private rowHeight: number = 40;
  private colAnimTimeouts: Map<number, number> = new Map();
  private bpmSlider: HTMLInputElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private recBtn: HTMLButtonElement | null = null;
  private playbackProgress: number = 0;

  constructor(app: HTMLElement, sequencer: SequencerModule, recorder: RecorderModule) {
    this.app = app;
    this.sequencer = sequencer;
    this.recorder = recorder;
    this.checkResponsive();
  }

  private checkResponsive(): void {
    this.isCompact = window.innerWidth < 900;
    this.cellSize = this.isCompact ? 30 : 40;
  }

  build(): UIContainerRefs {
    this.injectStyles();

    this.app.innerHTML = '';
    this.app.className = 'synth-app' + (this.isCompact ? ' compact' : '');

    const title = document.createElement('div');
    title.className = 'app-title';
    title.innerHTML = '<span class="title-icon">🎛️</span> 合成器音序器';
    this.app.appendChild(title);

    const topBar = document.createElement('div');
    topBar.className = 'top-bar';
    this.buildTopBar(topBar);
    this.app.appendChild(topBar);

    const presetBar = document.createElement('div');
    presetBar.className = 'preset-bar';
    this.buildPresetBar(presetBar);
    this.app.appendChild(presetBar);

    const mainArea = document.createElement('div');
    mainArea.className = 'main-area';

    const controlPanel = document.createElement('div');
    controlPanel.className = 'control-panel';
    this.buildControlPanel(controlPanel);

    const gridContainer = document.createElement('div');
    gridContainer.className = 'grid-container';
    this.buildGrid(gridContainer);

    const visualizerContainer = document.createElement('div');
    visualizerContainer.className = 'visualizer-container';
    const visualizerCanvas = this.buildVisualizer(visualizerContainer);

    mainArea.appendChild(controlPanel);
    mainArea.appendChild(gridContainer);
    mainArea.appendChild(visualizerContainer);
    this.app.appendChild(mainArea);

    const recorderContainer = document.createElement('div');
    recorderContainer.className = 'recorder-container';
    const waveformCanvas = this.buildRecorderSection(recorderContainer);
    this.app.appendChild(recorderContainer);

    this.refs = {
      topBar,
      controlPanel,
      gridContainer,
      visualizerContainer,
      recorderContainer,
      visualizerCanvas,
      waveformCanvas,
    };

    this.bindSequencerEvents();
    this.bindRecorderEvents();
    window.addEventListener('resize', this.handleResize);

    return this.refs;
  }

  private injectStyles(): void {
    const styleId = 'synth-ui-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .synth-app {
        padding: 20px;
        max-width: 1600px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .app-title {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 2px;
        background: linear-gradient(90deg, #ff4081, #7e57c2, #2196f3);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .title-icon { font-size: 28px; -webkit-text-fill-color: initial; }
      .top-bar {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        padding: 12px 16px;
        background: rgba(26, 26, 62, 0.6);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .ctrl-btn {
        padding: 10px 22px;
        border-radius: 10px;
        border: none;
        background: rgba(255, 64, 129, 0.15);
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease-out;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .ctrl-btn:hover {
        background: #ff4081;
        transform: scale(1.05);
        box-shadow: 0 0 20px rgba(255, 64, 129, 0.5);
      }
      .ctrl-btn:active { transform: scale(0.98); }
      .ctrl-btn.play { background: rgba(76, 175, 80, 0.2); }
      .ctrl-btn.play:hover { background: #4caf50; box-shadow: 0 0 20px rgba(76,175,80,0.5); }
      .ctrl-btn.pause { background: rgba(255, 193, 7, 0.2); }
      .ctrl-btn.pause:hover { background: #ffc107; box-shadow: 0 0 20px rgba(255,193,7,0.5); }
      .ctrl-btn.rec { background: rgba(244, 67, 54, 0.2); position: relative; }
      .ctrl-btn.rec:hover { background: #f44336; box-shadow: 0 0 20px rgba(244,67,54,0.5); }
      .ctrl-btn.rec.active::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 14px;
        border: 2px solid #f44336;
        animation: recPulse 0.8s ease-in-out infinite;
      }
      @keyframes recPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(1.1); }
      }
      .bpm-wrap {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-left: auto;
      }
      .bpm-label { font-size: 13px; color: #a0a0c0; }
      .bpm-value {
        font-size: 18px;
        font-weight: 700;
        color: #ff4081;
        min-width: 48px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .bpm-slider {
        -webkit-appearance: none;
        width: 180px;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(90deg, #1a1a3e, #42426e);
        outline: none;
        cursor: pointer;
      }
      .bpm-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ff4081;
        cursor: pointer;
        box-shadow: 0 0 10px rgba(255,64,129,0.6);
        transition: box-shadow 0.2s;
      }
      .bpm-slider.pulsing::-webkit-slider-thumb {
        animation: bpmGlow 0.6s ease-out;
      }
      @keyframes bpmGlow {
        0% { box-shadow: 0 0 10px rgba(255,64,129,0.6); }
        50% { box-shadow: 0 0 25px rgba(255,64,129,1), 0 0 40px rgba(255,64,129,0.6); }
        100% { box-shadow: 0 0 10px rgba(255,64,129,0.6); }
      }
      .preset-bar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .preset-btn {
        padding: 8px 16px;
        border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.03);
        color: #c0c0e0;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease-out;
      }
      .preset-btn:hover {
        background: rgba(255, 64, 129, 0.2);
        border-color: #ff4081;
        color: #fff;
        transform: scale(1.05);
      }
      .preset-btn.active {
        background: rgba(255, 64, 129, 0.3);
        border-color: #ff4081;
        color: #fff;
      }
      .main-area {
        display: grid;
        grid-template-columns: 260px 1fr 200px;
        gap: 16px;
        align-items: start;
      }
      .synth-app.compact .main-area {
        grid-template-columns: 1fr;
      }
      .control-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px;
        background: rgba(26, 26, 62, 0.5);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
      }
      .inst-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
        padding: 10px;
        border-radius: 8px;
        background: rgba(255,255,255,0.02);
      }
      .inst-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .inst-icon { font-size: 18px; }
      .inst-name {
        font-size: 12px;
        font-weight: 600;
        flex: 1;
      }
      .inst-param {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
      }
      .inst-param .param-label {
        width: 34px;
        color: #8888aa;
      }
      .inst-param .param-value {
        width: 32px;
        text-align: right;
        color: #c0c0e0;
        font-variant-numeric: tabular-nums;
      }
      .inst-param input[type="range"] {
        flex: 1;
        -webkit-appearance: none;
        height: 4px;
        border-radius: 2px;
        background: rgba(255,255,255,0.1);
        outline: none;
        cursor: pointer;
        transition: all 0.2s ease-out;
      }
      .inst-param input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        cursor: pointer;
        transition: transform 0.2s ease-out;
      }
      .inst-param input[type="range"].vol::-webkit-slider-thumb { background: #66bb6a; }
      .inst-param input[type="range"].pan::-webkit-slider-thumb { background: #42a5f5; }
      .inst-param input[type="range"].det::-webkit-slider-thumb { background: #ab47bc; }
      .inst-arp {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
      }
      .arp-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        user-select: none;
      }
      .arp-toggle input { display: none; }
      .arp-switch {
        width: 28px;
        height: 14px;
        border-radius: 7px;
        background: rgba(255,255,255,0.1);
        position: relative;
        transition: background 0.2s;
      }
      .arp-switch::before {
        content: '';
        position: absolute;
        left: 2px;
        top: 2px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #666;
        transition: all 0.2s ease-out;
      }
      .arp-toggle input:checked + .arp-switch {
        background: rgba(171, 71, 188, 0.5);
      }
      .arp-toggle input:checked + .arp-switch::before {
        left: 16px;
        background: #ab47bc;
      }
      .arp-rate {
        display: flex;
        gap: 2px;
        margin-left: auto;
      }
      .arp-rate button {
        padding: 2px 6px;
        font-size: 10px;
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.03);
        color: #a0a0c0;
        border-radius: 4px;
        cursor: pointer;
      }
      .arp-rate button.active {
        background: rgba(171, 71, 188, 0.3);
        border-color: #ab47bc;
        color: #fff;
      }
      .grid-container {
        padding: 12px;
        background: #1a1a3e;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
        overflow-x: auto;
      }
      .grid-inner {
        display: grid;
        gap: 2px;
      }
      .grid-row {
        display: flex;
        gap: 2px;
      }
      .grid-label {
        width: 90px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 0 8px;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 6px;
        background: rgba(255,255,255,0.03);
        flex-shrink: 0;
      }
      .synth-app.compact .grid-label { width: 70px; font-size: 11px; }
      .cell {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        background: rgba(255,255,255,0.04);
        border: 1px solid #444466;
        cursor: pointer;
        transition: background 0.15s ease-out, transform 0.15s ease-out;
        flex-shrink: 0;
      }
      .synth-app.compact .cell { width: 30px; height: 30px; }
      .cell:hover {
        transform: scale(1.08);
        border-color: #888;
      }
      .cell.active {
        border-color: transparent;
        box-shadow: 0 0 8px currentColor;
      }
      .cell.col-highlight {
        animation: colHighlight 0.3s ease-out forwards;
      }
      @keyframes colHighlight {
        0% { background-color: transparent; }
        50% { background-color: rgba(255,255,255,0.4); }
        100% { background-color: rgba(255,255,255,0.15); }
      }
      .cell.preset-flash {
        animation: presetFlash 0.5s ease-out forwards;
      }
      @keyframes presetFlash {
        0% { background: rgba(255, 64, 129, 0.8); transform: scale(1); }
        30% { transform: scale(1.2); }
        100% { background: transparent; transform: scale(1); }
      }
      .grid-cols-anim {
        transition: grid-template-columns 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .visualizer-container {
        background: rgba(26, 26, 62, 0.5);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
        padding: 10px;
        height: 340px;
      }
      .synth-app.compact .visualizer-container {
        height: 200px;
      }
      .visualizer-title {
        font-size: 12px;
        color: #8888aa;
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      #visualizer-canvas {
        width: 100%;
        height: calc(100% - 22px);
        display: block;
      }
      .recorder-container {
        padding: 14px;
        background: rgba(26, 26, 62, 0.5);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
      }
      .recorder-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }
      .recorder-title {
        font-size: 13px;
        color: #a0a0c0;
        font-weight: 600;
      }
      .rec-status {
        font-size: 12px;
        color: #ff4081;
      }
      #waveform-canvas {
        width: 100%;
        height: 80px;
        display: block;
        border-radius: 8px;
        background: rgba(0,0,0,0.2);
      }
      .playback-ctrls {
        margin-top: 10px;
        display: flex;
        gap: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  private buildTopBar(container: HTMLElement): void {
    this.playBtn = document.createElement('button');
    this.playBtn.className = 'ctrl-btn play';
    this.playBtn.innerHTML = '▶ 播放';
    this.playBtn.addEventListener('click', () => this.sequencer.play());

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'ctrl-btn pause';
    this.pauseBtn.innerHTML = '⏸ 暂停';
    this.pauseBtn.addEventListener('click', () => this.sequencer.pause());

    this.recBtn = document.createElement('button');
    this.recBtn.className = 'ctrl-btn rec';
    this.recBtn.innerHTML = '● 录音';
    this.recBtn.addEventListener('click', () => {
      if (this.recorder.isRecording()) {
        this.recorder.stopRecording();
      } else if (!this.recorder.isPlaying()) {
        this.recorder.startRecording();
      }
    });

    container.appendChild(this.playBtn);
    container.appendChild(this.pauseBtn);
    container.appendChild(this.recBtn);

    const bpmWrap = document.createElement('div');
    bpmWrap.className = 'bpm-wrap';
    const bpmLabel = document.createElement('span');
    bpmLabel.className = 'bpm-label';
    bpmLabel.textContent = 'BPM';

    const bpmValue = document.createElement('span');
    bpmValue.className = 'bpm-value';
    bpmValue.id = 'bpm-value-display';
    bpmValue.textContent = String(this.sequencer.getBPM());

    this.bpmSlider = document.createElement('input');
    this.bpmSlider.type = 'range';
    this.bpmSlider.className = 'bpm-slider';
    this.bpmSlider.min = '120';
    this.bpmSlider.max = '180';
    this.bpmSlider.value = String(this.sequencer.getBPM());
    this.bpmSlider.addEventListener('input', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      this.sequencer.setBPM(v);
      bpmValue.textContent = String(v);
      this.bpmSlider?.classList.remove('pulsing');
      void this.bpmSlider?.offsetWidth;
      this.bpmSlider?.classList.add('pulsing');
    });

    bpmWrap.appendChild(bpmLabel);
    bpmWrap.appendChild(this.bpmSlider);
    bpmWrap.appendChild(bpmValue);
    container.appendChild(bpmWrap);
  }

  private buildPresetBar(container: HTMLElement): void {
    PRESETS.forEach((preset, idx) => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn' + (idx === 1 ? ' active' : '');
      btn.textContent = preset.name;
      btn.dataset.presetIdx = String(idx);
      btn.addEventListener('click', () => {
        container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadPresetWithAnimation(preset);
      });
      container.appendChild(btn);
    });
  }

  private loadPresetWithAnimation(preset: Preset): void {
    const allCells: HTMLDivElement[] = [];
    this.gridCells.forEach(row => row.forEach(cell => allCells.push(cell)));

    const shuffled = [...allCells].sort(() => Math.random() - 0.5);
    const stepTime = 500 / shuffled.length;

    shuffled.forEach((cell, i) => {
      setTimeout(() => {
        cell.classList.add('preset-flash');
        setTimeout(() => cell.classList.remove('preset-flash'), 500);
      }, i * stepTime);
    });

    setTimeout(() => {
      this.sequencer.loadPreset(preset, true);
      this.sequencer.play();
    }, 250);
  }

  private buildControlPanel(container: HTMLElement): void {
    INSTRUMENTS.forEach((inst) => {
      const params = this.sequencer.getInstrumentParams(inst.id) || {
        volume: 60, pan: 0, detune: 0, arpEnabled: false, arpRate: 1 as const,
      };
      const row = this.buildInstrumentRow(inst, params);
      container.appendChild(row);
    });
  }

  private buildInstrumentRow(inst: Instrument, params: InstrumentParams): HTMLElement {
    const row = document.createElement('div');
    row.className = 'inst-row';
    row.style.borderLeft = `3px solid ${inst.color}`;

    const header = document.createElement('div');
    header.className = 'inst-header';
    header.innerHTML = `<span class="inst-icon">${inst.icon}</span><span class="inst-name" style="color:${inst.color}">${inst.name}</span>`;
    row.appendChild(header);

    const volParam = this.buildParamRow('vol', '音量', params.volume, 0, 100, (v) => {
      this.sequencer.setVolume(inst.id, v);
    });
    row.appendChild(volParam.row);

    const panParam = this.buildParamRow('pan', '声像', params.pan, -100, 100, (v) => {
      this.sequencer.setPan(inst.id, v);
    });
    row.appendChild(panParam.row);

    const detParam = this.buildParamRow('det', '音高', params.detune, -12, 12, (v) => {
      this.sequencer.setDetune(inst.id, v);
    });
    row.appendChild(detParam.row);

    const arpRow = document.createElement('div');
    arpRow.className = 'inst-arp';

    const label = document.createElement('span');
    label.style.color = '#8888aa';
    label.textContent = '琶音';
    arpRow.appendChild(label);

    const toggle = document.createElement('label');
    toggle.className = 'arp-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = params.arpEnabled;
    checkbox.addEventListener('change', (e) => {
      this.sequencer.setArpEnabled(inst.id, (e.target as HTMLInputElement).checked);
    });
    const sw = document.createElement('span');
    sw.className = 'arp-switch';
    toggle.appendChild(checkbox);
    toggle.appendChild(sw);
    arpRow.appendChild(toggle);

    const rateWrap = document.createElement('div');
    rateWrap.className = 'arp-rate';
    ([1, 2, 4] as const).forEach(rate => {
      const btn = document.createElement('button');
      btn.textContent = 'x' + rate;
      if (params.arpRate === rate) btn.classList.add('active');
      btn.addEventListener('click', () => {
        rateWrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sequencer.setInstrumentArpRate(inst.id, rate);
      });
      rateWrap.appendChild(btn);
    });
    arpRow.appendChild(rateWrap);

    row.appendChild(arpRow);
    return row;
  }

  private buildParamRow(
    cls: string,
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ): { row: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'inst-param';

    const lab = document.createElement('span');
    lab.className = 'param-label';
    lab.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.className = cls;
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);

    const val = document.createElement('span');
    val.className = 'param-value';
    val.textContent = String(value);

    let rafId = 0;
    input.addEventListener('input', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value, 10);
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        val.textContent = String(v);
        onChange(v);
      });
    });

    row.appendChild(lab);
    row.appendChild(input);
    row.appendChild(val);
    return { row };
  }

  private buildGrid(container: HTMLElement): void {
    const cols = this.sequencer.getCols();
    const inner = document.createElement('div');
    inner.className = 'grid-inner grid-cols-anim';
    inner.id = 'grid-inner';

    const grid = this.sequencer.getGrid();
    this.gridCells = [];

    INSTRUMENTS.forEach((inst, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'grid-row';

      const label = document.createElement('div');
      label.className = 'grid-label';
      label.innerHTML = `<span>${inst.icon}</span><span style="color:${inst.color}">${inst.name}</span>`;
      rowEl.appendChild(label);

      const rowCells: HTMLDivElement[] = [];
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = String(rowIdx);
        cell.dataset.col = String(c);
        if (grid[rowIdx]?.[c]) {
          cell.classList.add('active');
          cell.style.backgroundColor = inst.color;
          cell.style.color = inst.color;
        }
        cell.addEventListener('click', () => {
          this.sequencer.toggleCell(rowIdx, c);
          const active = this.sequencer.getGrid()[rowIdx][c];
          if (active) {
            cell.classList.add('active');
            cell.style.backgroundColor = inst.color;
            cell.style.color = inst.color;
          } else {
            cell.classList.remove('active');
            cell.style.backgroundColor = '';
            cell.style.color = '';
          }
        });
        rowCells.push(cell);
        rowEl.appendChild(cell);
      }
      this.gridCells.push(rowCells);
      inner.appendChild(rowEl);
    });

    container.innerHTML = '';
    container.appendChild(inner);
  }

  private buildVisualizer(container: HTMLElement): HTMLCanvasElement {
    const title = document.createElement('div');
    title.className = 'visualizer-title';
    title.textContent = '频谱可视化';
    container.appendChild(title);

    const canvas = document.createElement('canvas');
    canvas.id = 'visualizer-canvas';
    container.appendChild(canvas);
    return canvas;
  }

  private buildRecorderSection(container: HTMLElement): HTMLCanvasElement {
    const header = document.createElement('div');
    header.className = 'recorder-header';
    const title = document.createElement('span');
    title.className = 'recorder-title';
    title.textContent = '录音回放';
    const status = document.createElement('span');
    status.className = 'rec-status';
    status.id = 'rec-status-text';
    status.textContent = '待机';
    header.appendChild(title);
    header.appendChild(status);
    container.appendChild(header);

    const canvas = document.createElement('canvas');
    canvas.id = 'waveform-canvas';
    container.appendChild(canvas);

    const ctrls = document.createElement('div');
    ctrls.className = 'playback-ctrls';

    const playBtn = document.createElement('button');
    playBtn.className = 'ctrl-btn play';
    playBtn.innerHTML = '▶ 回放';
    playBtn.style.padding = '6px 14px';
    playBtn.style.fontSize = '12px';
    playBtn.addEventListener('click', () => {
      if (this.recorder.isPlaying()) {
        this.recorder.stopPlayback();
      } else {
        this.recorder.playRecording();
      }
    });

    const stopBtn = document.createElement('button');
    stopBtn.className = 'ctrl-btn pause';
    stopBtn.innerHTML = '⏹ 停止';
    stopBtn.style.padding = '6px 14px';
    stopBtn.style.fontSize = '12px';
    stopBtn.addEventListener('click', () => {
      this.recorder.stopPlayback();
    });

    ctrls.appendChild(playBtn);
    ctrls.appendChild(stopBtn);
    container.appendChild(ctrls);

    return canvas;
  }

  private bindSequencerEvents(): void {
    this.sequencer.on('step', (col: unknown) => {
      const c = col as number;
      this.setHighlightedColumn(c);
    });
    this.sequencer.on('gridChange', (grid: unknown) => {
      this.syncGridVisuals(grid as GridState);
    });
    this.sequencer.on('arpRateChange', () => {
      this.rebuildGridWithAnimation();
    });
    this.sequencer.on('play', () => {
      this.updatePlayStateUI(true);
    });
    this.sequencer.on('pause', () => {
      this.updatePlayStateUI(false);
      this.clearAllHighlights();
    });
    this.sequencer.on('bpmChange', (bpm: unknown) => {
      this.recorder.setBPM(bpm as number);
    });
  }

  private bindRecorderEvents(): void {
    this.recorder.setOnStateChange((state) => {
      const statusEl = document.getElementById('rec-status-text');
      if (this.recBtn) {
        this.recBtn.classList.toggle('active', state === 'recording');
        this.recBtn.innerHTML = state === 'recording' ? '■ 停止录制' : '● 录音';
      }
      if (statusEl) {
        if (state === 'recording') statusEl.textContent = '🔴 录制中...';
        else if (state === 'playing') statusEl.textContent = '▶ 回放中';
        else statusEl.textContent = '待机';
      }
    });
    this.recorder.setOnProgress((progress) => {
      this.playbackProgress = progress;
      const rec = this.recorder.getCurrentRecording();
      const canvas = document.getElementById('waveform-canvas') as HTMLCanvasElement | null;
      if (rec && canvas) {
        this.recorder.drawWaveform(canvas, rec.waveform, progress);
      }
    });
    this.recorder.setOnRecordingComplete((recording) => {
      const canvas = document.getElementById('waveform-canvas') as HTMLCanvasElement | null;
      if (canvas) {
        this.recorder.drawWaveform(canvas, recording.waveform, 0);
      }
    });
  }

  private setHighlightedColumn(col: number): void {
    this.clearAllHighlights();
    this.highlightedCol = col;
    this.gridCells.forEach(row => {
      const cell = row[col];
      if (cell) {
        cell.classList.add('col-highlight');
      }
    });
    const t = window.setTimeout(() => {
      this.gridCells.forEach(row => {
        const cell = row[col];
        if (cell) cell.classList.remove('col-highlight');
      });
      this.colAnimTimeouts.delete(col);
    }, 300);
    this.colAnimTimeouts.set(col, t);
  }

  private clearAllHighlights(): void {
    this.colAnimTimeouts.forEach(t => clearTimeout(t));
    this.colAnimTimeouts.clear();
    this.gridCells.forEach(row => row.forEach(cell => cell.classList.remove('col-highlight')));
  }

  private syncGridVisuals(grid: GridState): void {
    INSTRUMENTS.forEach((inst, r) => {
      for (let c = 0; c < grid[r].length; c++) {
        const cell = this.gridCells[r]?.[c];
        if (!cell) continue;
        if (grid[r][c]) {
          cell.classList.add('active');
          cell.style.backgroundColor = inst.color;
          cell.style.color = inst.color;
        } else {
          cell.classList.remove('active');
          cell.style.backgroundColor = '';
          cell.style.color = '';
        }
      }
    });
  }

  private rebuildGridWithAnimation(): void {
    const container = document.getElementById('grid-inner')?.parentElement;
    if (!container) return;

    const inner = document.getElementById('grid-inner');
    if (inner) {
      inner.style.opacity = '0';
      inner.style.transform = 'scale(0.95)';
      inner.style.transition = 'opacity 0.2s, transform 0.2s';
    }

    setTimeout(() => {
      this.buildGrid(container);
      const newInner = document.getElementById('grid-inner');
      if (newInner) {
        newInner.style.opacity = '0';
        newInner.style.transform = 'scale(0.95)';
        requestAnimationFrame(() => {
          newInner.style.transition = 'opacity 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
          newInner.style.opacity = '1';
          newInner.style.transform = 'scale(1)';
        });
      }
    }, 200);
  }

  private updatePlayStateUI(playing: boolean): void {
    if (this.playBtn) this.playBtn.style.opacity = playing ? '0.5' : '1';
    if (this.pauseBtn) this.pauseBtn.style.opacity = playing ? '1' : '0.5';
  }

  private handleResize = (): void => {
    const wasCompact = this.isCompact;
    this.checkResponsive();
    if (wasCompact !== this.isCompact) {
      this.app.classList.toggle('compact', this.isCompact);
      const container = document.getElementById('grid-inner')?.parentElement;
      if (container) this.buildGrid(container);
    }
  };

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.colAnimTimeouts.forEach(t => clearTimeout(t));
    this.colAnimTimeouts.clear();
  }
}
