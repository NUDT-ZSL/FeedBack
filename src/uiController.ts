import { VisualizationMode } from './sculptureBuilder';
import { UIIntents, UIView, UIViewState } from './appController';

export class UIController implements UIView {
  private intents: UIIntents | null = null;
  private viewState: UIViewState | null = null;

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

    this.bindEvents();
  }

  bindIntents(intents: UIIntents): void {
    this.intents = intents;
  }

  private bindEvents(): void {
    this.uploadBtn.addEventListener('click', () => {
      this.openFileDialog();
    });

    this.fileInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file && this.intents) {
        this.intents.onUpload(file);
      }
      this.fileInput.value = '';
    });

    this.playBtn.addEventListener('click', () => {
      if (this.intents) {
        this.intents.onPlayPause();
      }
    });

    this.progressContainer.addEventListener('mousedown', (e) => {
      if (!this.viewState?.hasAudio) return;
      this.isDragging = true;
      this.handleSeek(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.handleSeek(e);
      }
    });

    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.progressContainer.addEventListener('touchstart', (e) => {
      if (!this.viewState?.hasAudio) return;
      this.isDragging = true;
      const touch = e.touches[0];
      this.handleSeekTouch(touch);
    });

    document.addEventListener('touchmove', (e) => {
      if (this.isDragging) {
        const touch = e.touches[0];
        this.handleSeekTouch(touch);
      }
    });

    document.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    this.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as VisualizationMode;
        if (this.intents) {
          this.intents.onModeChange(mode);
        }
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

  private handleSeek(e: MouseEvent): void {
    const rect = this.progressContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (this.intents) {
      this.intents.onSeek(percent);
    }
  }

  private handleSeekTouch(touch: Touch): void {
    const rect = this.progressContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    if (this.intents) {
      this.intents.onSeek(percent);
    }
  }

  render(state: UIViewState): void {
    this.viewState = state;

    if (state.isPlaying) {
      this.playBtn.classList.add('playing');
      this.playIcon.style.display = 'none';
      this.pauseIcon.style.display = 'block';
    } else {
      this.playBtn.classList.remove('playing');
      this.playIcon.style.display = 'block';
      this.pauseIcon.style.display = 'none';
    }

    const percent = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
    this.progressBar.style.width = `${percent}%`;
    this.progressHandle.style.right = `${-8 + (100 - percent) * 0.16}px`;
    this.timeDisplay.textContent = `${this.formatTime(state.currentTime)} / ${this.formatTime(state.duration)}`;

    this.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.selectedMode);
    });

    this.uploadHint.classList.toggle('hidden', state.hasAudio);
  }

  setUploading(uploading: boolean): void {
    this.uploadBtn.disabled = uploading;
    if (uploading) {
      this.uploadBtn.textContent = '加载中...';
    } else {
      this.uploadBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        上传音频
      `;
    }
  }

  notifyUploadError(): void {
    alert('音频文件加载失败，请检查文件格式');
  }

  openFileDialog(): void {
    this.fileInput.click();
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  dispose(): void {
    this.uploadBtn.onclick = null;
    this.fileInput.onchange = null;
    this.playBtn.onclick = null;
    this.progressContainer.onmousedown = null;
    this.sidebarToggle.onclick = null;
  }
}
