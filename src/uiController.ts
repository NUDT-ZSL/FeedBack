import { AudioAnalyzer } from './audioAnalyzer';
import { SculptureBuilder, VisualizationMode } from './sculptureBuilder';

export class UIController {
  private audioAnalyzer: AudioAnalyzer | null = null;
  private sculptureBuilder: SculptureBuilder | null = null;
  
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
  private uploadCallback: (() => void) | null = null;
  private playPauseCallback: ((playing: boolean) => void) | null = null;
  private modeChangeCallback: ((mode: VisualizationMode) => void) | null = null;
  private seekCallback: ((time: number) => void) | null = null;

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

  init(analyzer: AudioAnalyzer, builder: SculptureBuilder): void {
    this.audioAnalyzer = analyzer;
    this.sculptureBuilder = builder;
  }

  private bindEvents(): void {
    this.uploadBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file && this.audioAnalyzer) {
        try {
          this.uploadBtn.disabled = true;
          this.uploadBtn.textContent = '加载中...';
          await this.audioAnalyzer.loadAudio(file);
          this.hideUploadHint();
          this.updateProgress(0, this.audioAnalyzer.getDuration());
          this.setPlayButtonState(false);
          if (this.uploadCallback) {
            this.uploadCallback();
          }
        } catch (error) {
          console.error('Failed to load audio:', error);
          alert('音频文件加载失败，请检查文件格式');
        } finally {
          this.uploadBtn.disabled = false;
          this.uploadBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            上传音频
          `;
          this.fileInput.value = '';
        }
      }
    });

    this.playBtn.addEventListener('click', () => {
      if (!this.audioAnalyzer || !this.audioAnalyzer.hasAudio()) {
        this.fileInput.click();
        return;
      }
      
      if (this.audioAnalyzer.isPlaying()) {
        this.audioAnalyzer.pause();
        this.setPlayButtonState(false);
      } else {
        this.audioAnalyzer.play();
        this.setPlayButtonState(true);
      }
      
      if (this.playPauseCallback) {
        this.playPauseCallback(this.audioAnalyzer.isPlaying());
      }
    });

    this.progressContainer.addEventListener('mousedown', (e) => {
      if (!this.audioAnalyzer || !this.audioAnalyzer.hasAudio()) return;
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
      if (!this.audioAnalyzer || !this.audioAnalyzer.hasAudio()) return;
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
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode as VisualizationMode;
        if (!this.sculptureBuilder || this.sculptureBuilder.isTransitioning()) return;
        
        this.modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        await this.sculptureBuilder.setMode(mode);
        
        if (this.modeChangeCallback) {
          this.modeChangeCallback(mode);
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
    if (!this.audioAnalyzer) return;
    const rect = this.progressContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = percent * this.audioAnalyzer.getDuration();
    this.audioAnalyzer.seek(time);
    this.updateProgress(time, this.audioAnalyzer.getDuration());
    
    if (this.seekCallback) {
      this.seekCallback(time);
    }
  }

  private handleSeekTouch(touch: Touch): void {
    if (!this.audioAnalyzer) return;
    const rect = this.progressContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const time = percent * this.audioAnalyzer.getDuration();
    this.audioAnalyzer.seek(time);
    this.updateProgress(time, this.audioAnalyzer.getDuration());
    
    if (this.seekCallback) {
      this.seekCallback(time);
    }
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

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  updateProgress(current: number, duration: number): void {
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    this.progressBar.style.width = `${percent}%`;
    this.progressHandle.style.right = `${-8 + (100 - percent) * 0.16}px`;
    this.timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
  }

  hideUploadHint(): void {
    this.uploadHint.classList.add('hidden');
  }

  showUploadHint(): void {
    this.uploadHint.classList.remove('hidden');
  }

  onUpload(callback: () => void): void {
    this.uploadCallback = callback;
  }

  onPlayPause(callback: (playing: boolean) => void): void {
    this.playPauseCallback = callback;
  }

  onModeChange(callback: (mode: VisualizationMode) => void): void {
    this.modeChangeCallback = callback;
  }

  onSeek(callback: (time: number) => void): void {
    this.seekCallback = callback;
  }

  setModeButton(mode: VisualizationMode): void {
    this.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  updatePlayState(): void {
    if (this.audioAnalyzer) {
      this.setPlayButtonState(this.audioAnalyzer.isPlaying());
    }
  }

  dispose(): void {
    this.uploadBtn.onclick = null;
    this.fileInput.onchange = null;
    this.playBtn.onclick = null;
    this.progressContainer.onmousedown = null;
    this.sidebarToggle.onclick = null;
  }
}
