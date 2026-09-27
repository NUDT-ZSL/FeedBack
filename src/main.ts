import { AudioEngine } from './audioEngine';
import { WaveRenderer } from './waveRenderer';
import { SpectrumRenderer } from './spectrumRenderer';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const uploadArea = document.getElementById('uploadArea') as HTMLDivElement;
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const progressThumb = document.getElementById('progressThumb') as HTMLDivElement;
const timeDisplay = document.getElementById('timeDisplay') as HTMLDivElement;
const thicknessSlider = document.getElementById('thicknessSlider') as HTMLInputElement;
const thicknessValue = document.getElementById('thicknessValue') as HTMLSpanElement;
const colorSlider = document.getElementById('colorSlider') as HTMLInputElement;
const colorValue = document.getElementById('colorValue') as HTMLSpanElement;
const brightnessSlider = document.getElementById('brightnessSlider') as HTMLInputElement;
const brightnessValue = document.getElementById('brightnessValue') as HTMLSpanElement;
const waveCanvas = document.getElementById('waveCanvas') as HTMLCanvasElement;
const spectrumCanvas = document.getElementById('spectrumCanvas') as HTMLCanvasElement;
const waveEmpty = document.getElementById('waveEmpty') as HTMLDivElement;
const spectrumEmpty = document.getElementById('spectrumEmpty') as HTMLDivElement;
const mobileTabButtons = document.querySelectorAll('.mobile-tabs button');
const waveSection = document.getElementById('waveSection') as HTMLDivElement;
const spectrumSection = document.getElementById('spectrumSection') as HTMLDivElement;

let isDraggingProgress = false;

const audioEngine = new AudioEngine({
  onWaveformData: (data) => {
    waveRenderer.setWaveformData(data);
    waveEmpty.style.display = 'none';
  },
  onFrequencyData: (data) => {
    spectrumRenderer.setFrequencyData(data);
    spectrumEmpty.style.display = 'none';
  },
  onTimeUpdate: (currentTime, duration) => {
    const progress = duration > 0 ? currentTime / duration : 0;
    if (!isDraggingProgress) {
      progressFill.style.width = `${progress * 100}%`;
      progressThumb.style.left = `${progress * 100}%`;
      waveRenderer.setPlayProgress(progress);
    }
    timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  },
  onPlayEnd: () => {
    updatePlayButton(false);
  }
});

const waveRenderer = new WaveRenderer(waveCanvas);
const spectrumRenderer = new SpectrumRenderer(spectrumCanvas);

function updatePlayButton(playing: boolean): void {
  const svg = playBtn.querySelector('svg') as SVGSVGElement;
  if (playing) {
    svg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    svg.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}

function handleFile(file: File): void {
  if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav)$/i)) {
    alert('请选择 MP3 或 WAV 音频文件');
    return;
  }

  uploadBtn.textContent = '正在解析...';
  uploadBtn.disabled = true;

  audioEngine.loadAudioFile(file)
    .then(() => {
      playBtn.disabled = false;
      updatePlayButton(false);
    })
    .catch((err) => {
      console.error('Failed to load audio:', err);
      alert('音频文件解析失败，请尝试其他文件');
    })
    .finally(() => {
      uploadBtn.textContent = '选择音频文件';
      uploadBtn.disabled = false;
    });
}

uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    handleFile(file);
  }
});

uploadArea.addEventListener('click', (e) => {
  if (e.target === uploadArea || (e.target as HTMLElement).tagName === 'P') {
    fileInput.click();
  }
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) {
    handleFile(file);
  }
});

playBtn.addEventListener('click', () => {
  if (audioEngine.getIsPlaying()) {
    audioEngine.pause();
    updatePlayButton(false);
  } else {
    audioEngine.play();
    updatePlayButton(true);
  }
});

function updateProgressFromEvent(clientX: number): number {
  const rect = progressBar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  progressFill.style.width = `${ratio * 100}%`;
  progressThumb.style.left = `${ratio * 100}%`;
  waveRenderer.setPlayProgress(ratio);
  
  const duration = audioEngine.getDuration();
  const currentTime = ratio * duration;
  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  
  return ratio;
}

progressBar.addEventListener('mousedown', (e) => {
  if (audioEngine.getDuration() <= 0) return;
  isDraggingProgress = true;
  const ratio = updateProgressFromEvent(e.clientX);
  if (ratio !== undefined) {
    audioEngine.seek(ratio * audioEngine.getDuration());
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isDraggingProgress) return;
  const ratio = updateProgressFromEvent(e.clientX);
  if (ratio !== undefined) {
    audioEngine.seek(ratio * audioEngine.getDuration());
  }
});

document.addEventListener('mouseup', () => {
  isDraggingProgress = false;
});

progressBar.addEventListener('touchstart', (e) => {
  if (audioEngine.getDuration() <= 0) return;
  isDraggingProgress = true;
  const touch = e.touches[0];
  const ratio = updateProgressFromEvent(touch.clientX);
  if (ratio !== undefined) {
    audioEngine.seek(ratio * audioEngine.getDuration());
  }
});

document.addEventListener('touchmove', (e) => {
  if (!isDraggingProgress) return;
  const touch = e.touches[0];
  const ratio = updateProgressFromEvent(touch.clientX);
  if (ratio !== undefined) {
    audioEngine.seek(ratio * audioEngine.getDuration());
  }
});

document.addEventListener('touchend', () => {
  isDraggingProgress = false;
});

thicknessSlider.addEventListener('input', (e) => {
  const value = parseInt((e.target as HTMLInputElement).value);
  thicknessValue.textContent = value.toString();
  waveRenderer.setStyle({ thickness: value });
});

colorSlider.addEventListener('input', (e) => {
  const value = parseInt((e.target as HTMLInputElement).value);
  colorValue.textContent = value.toString();
  waveRenderer.setStyle({ colorOffset: value / 100 });
});

brightnessSlider.addEventListener('input', (e) => {
  const value = parseInt((e.target as HTMLInputElement).value);
  brightnessValue.textContent = value.toString();
  waveRenderer.setStyle({ brightness: value / 100 });
});

mobileTabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.getAttribute('data-tab');
    mobileTabButtons.forEach(b => b.classList.remove('active'));
    button.classList.add('active');

    if (tab === 'wave') {
      waveSection.classList.add('active');
      spectrumSection.classList.remove('active');
      setTimeout(() => waveRenderer.resize(), 50);
    } else if (tab === 'spectrum') {
      waveSection.classList.remove('active');
      spectrumSection.classList.add('active');
      setTimeout(() => spectrumRenderer.resize(), 50);
    }
  });
});

window.addEventListener('beforeunload', () => {
  audioEngine.destroy();
  waveRenderer.destroy();
});
