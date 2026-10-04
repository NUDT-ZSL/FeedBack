import { VisualizationMode } from './sculptureBuilder';
import type { UIIntents, UIPort, UIViewState } from './contracts';

/**
 * 界面控制模块：只负责 DOM 事件采集（转为用户意图）与视图状态渲染。
 * 不直接依赖音频/雕塑模块，所有状态通过 render() 单点刷新。
 */
export class UIController implements UIPort {
  private uploadBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private playIcon: SVGElement;
  private pauseIcon: SVGElement;
  private progressContainer: HTMLElement;
  private progressBar: HTMLElement;
  private progressHandle: HTMLElement;
  private timeDisplay: HTMLElement;
  private modeButtons: NodeListOf<HTMLElement>;
  private sidebarToggle: HTMLElement;
  private controlPanel: HTMLElement;
  private uploadHint: HTMLElement;

  private isDragging: boolean = false;
  private intents: UIIntents | null = null;
  private readonly uploadBtnDefaultHTML: string;
  private state: UIViewState = {
    hasAudio: false,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    activeMode: VisualizationMode.SPECTRUM,
    uploadHintVisible: true,
    uploadBusy: false
  };

  constructor() {
    this.uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
    this.fileInput = document.getElementById('fileInput') as HTMLInputElement;
    this.playBtn = document.getElementById('playBtn') as HTMLButtonElement;
    this.playIcon = document.getElementById('playIcon') as unknown as SVGElement;
    this.pauseIcon = document.getElementById('pauseIcon') as unknown as SVGElement;
    this.progressContainer = document.getElementById('progressContainer') as HTMLElement;
    this.progressBar = document.getElementById('progressBar') as HTMLElement;
    this.progressHandle = document.getElementById('progressHandle') as HTMLElement;
    this.timeDisplay = document.getElementById('timeDisplay') as HTMLElement;
    this.modeButtons = document.querySelectorAll('.mode-btn');
    this.sidebarToggle = document.getElementById('sidebarToggle') as HTMLElement;
    this.controlPanel = document.getElementById('controlPanel') as HTMLElement;
    this.uploadHint = document.getElementById('uploadHint') as HTMLElement;

    this.uploadBtnDefaultHTML = this.uploadBtn.innerHTML;

    this.bindEvents();
  }

  setIntents(intents: UIIntents): void {
    this.intents = intents;
  }

  render(state: UIViewState): void {
    const prev = this.state;
    this.state = state;

    if (prev.isPlaying !== state.isPlaying) {
      this.setPlayButtonState(state.isPlaying);
    }
    if (prev.currentTime !== state.currentTime || prev.duration !== state.duration) {
      this.updateProgress(state.currentTime, state.duration);
    }
    if (prev.activeMode !== state.activeMode) {
      this.setActiveModeButton(state.activeMode);
    }
    if (prev.uploadHintVisible !== state.uploadHintVisible) {
      this.uploadHint.classList.toggle('hidden', !state.uploadHintVisible);
    }
    if (prev.uploadBusy !== state.uploadBusy) {
      this.setUploadBusy(state.uploadBusy);
    }
  }

  notifyUploadError(_error: unknown): void {
    alert('音频文件加载失败，请检查文件格式');
  }

  private bindEvents(): void {
    this.uploadBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file && this.intents) {
        try {
          await this.intents.upload(file);
        } finally {
          this.fileInput.value = '';
        }
      }
    });

    this.playBtn.addEventListener('click', () => {
      if (!this.state.hasAudio) {
        this.fileInput.click();
        return;
      }
      this.intents?.togglePlayPause();
    });

    this.progressContainer.addEventListener('mousedown', (e) => {
      if (!this.state.hasAudio) return;
      this.isDragging = true;
      this.handleSeek(e.clientX);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.handleSeek(e.clientX);
      }
    });

    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.progressContainer.addEventListener('touchstart', (e) => {
      if (!this.state.hasAudio) return;
      this.isDragging = true;
      const touch = e.touches[0];
      this.handleSeek(touch.clientX);
    });

    document.addEventListener('touchmove', (e) => {
      if (this.isDragging) {
        const touch = e.touches[0];
        this.handleSeek(touch.clientX);
      }
    });

    document.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    this.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as VisualizationMode;
        this.intents?.changeMode(mode);
      });
    });

    this.sidebarToggle.addEventListener('click', () => {
      this.controlPanel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (window.innerWidth <= 768 &&
          this.controlPanel.classList.contains('open') &&
          !this.controlPanel.contains(target) &&
          !this.sidebarToggle.contains(target)) {
        this.controlPanel.classList.remove('open');
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        this.controlPanel.classList.remove('open');
      }
    });
  }

  private handleSeek(clientX: number): void {
    if (!this.intents || this.state.duration <= 0) return;
    const rect = this.progressContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    this.intents.seek(percent * this.state.duration);
  }

  private setPlayButtonState(playing: boolean): void {
    if (playing) {
      this.playBtn.classList.add('playing');
      this.playIcon.style.display = 'none';
      this.pauseIcon.style.display = 'block';
    } else {
      this.playBtn.classList.remove('playing');
      this.playIcon.style.display = 'block';
      this.pauseIcon.style.display = 'none';
    }
  }

  private setActiveModeButton(mode: VisualizationMode): void {
    this.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  private setUploadBusy(busy: boolean): void {
    this.uploadBtn.disabled = busy;
    if (busy) {
      this.uploadBtn.textContent = '加载中...';
    } else {
      this.uploadBtn.innerHTML = this.uploadBtnDefaultHTML;
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private updateProgress(current: number, duration: number): void {
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    this.progressBar.style.width = `${percent}%`;
    this.progressHandle.style.right = `${-8 + (100 - percent) * 0.16}px`;
    this.timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
  }

  dispose(): void {
    this.uploadBtn.onclick = null;
    this.fileInput.onchange = null;
    this.playBtn.onclick = null;
    this.progressContainer.onmousedown = null;
    this.sidebarToggle.onclick = null;
  }
}
