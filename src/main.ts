import * as THREE from 'three';
import { AudioVisualizer, PLAYLIST, THEMES, type GestureType, type PlaylistItem, type ColorTheme } from './audio-visualizer';
import { ParticleSystem } from './particle-system';
import { GestureController } from './gesture-controller';
import { UIOverlay } from './ui-overlay';

class App {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private visualizer!: AudioVisualizer;
  private particles!: ParticleSystem;
  private gesture!: GestureController;
  private ui!: UIOverlay;
  private playlist: PlaylistItem[] = PLAYLIST;
  private currentIndex = 0;
  private themes: ColorTheme[] = THEMES;
  private currentThemeIndex = 0;
  private lastGesture: GestureType = 'none';
  private gestureHoldFrames = 0;
  private volumeContinuous = false;
  private lastVolumeChange = 0;
  private rafId = 0;
  private initialized = false;

  async start(): Promise<void> {
    this.initThree();
    this.visualizer = new AudioVisualizer();
    await this.visualizer.init();
    this.particles = new ParticleSystem(this.scene, 3000);
    this.ui = new UIOverlay(document.getElementById('ui-overlay')!);
    this.gesture = new GestureController();
    this.particles.setTheme(this.themes[this.currentThemeIndex], false);
    this.applyBodyTheme(this.themes[this.currentThemeIndex]);
    this.ui.setThemes(this.themes, this.currentThemeIndex, (i) => this.onThemeSelect(i));
    this.loadSong(0);
    this.ui.setVolume(this.visualizer.volume);
    this.ui.setPlaylistHint(`播放列表 ${this.playlist.length} 首 · Web Audio 合成演示`);
    this.bindEvents();
    this.animate();
    this.initialized = true;
  }

  private initThree(): void {
    const container = document.getElementById('canvas-container')!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 16);
    this.camera.lookAt(0, 0, 0);
    window.addEventListener('resize', () => this.onResize());
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);
  }

  private bindEvents(): void {
    document.getElementById('start-btn')!.addEventListener('click', async () => {
      try {
        const video = document.getElementById('webcam-video') as HTMLVideoElement;
        await this.gesture.init(video);
        this.gesture.start();
        this.ui.setGestureActive(true);
        document.getElementById('start-overlay')!.classList.add('hidden');
        this.gesture.onGestureChange((g, count) => this.onGestureDetected(g, count));
      } catch (e) {
        console.warn('摄像头初始化失败，可使用鼠标键盘控制：', e);
        document.getElementById('start-overlay')!.classList.add('hidden');
      }
      this.loadSong(0);
      this.visualizer.play();
      this.ui.setVolume(this.visualizer.volume);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.initialized) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.togglePlay(); break;
        case 'ArrowRight': this.nextSong(); break;
        case 'ArrowUp': this.changeVolume(0.05); break;
        case 'ArrowDown': this.changeVolume(-0.05); break;
        case 'KeyM': this.mute(); break;
      }
    });
  }

  private onGestureDetected(g: GestureType, _count: number): void {
    const now = performance.now();
    this.lastGesture = g;
    this.gestureHoldFrames = 0;
    this.ui.setGestureIcon(g);
    switch (g) {
      case '1-finger':
        this.togglePlay();
        break;
      case '2-finger':
        this.nextSong();
        break;
      case 'fist':
        this.mute();
        break;
    }
    if (g === '3-finger' || g === '4-finger') {
      this.volumeContinuous = true;
      this.lastVolumeChange = now;
      const delta = g === '3-finger' ? 0.04 : -0.04;
      this.changeVolume(delta);
    } else {
      this.volumeContinuous = false;
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onThemeSelect(i: number): void {
    this.currentThemeIndex = i;
    this.particles.setTheme(this.themes[i], true);
    this.applyBodyTheme(this.themes[i]);
  }

  private applyBodyTheme(theme: ColorTheme): void {
    document.body.style.background = `linear-gradient(to bottom, ${theme.bgTop} 0%, ${theme.bgBottom} 100%)`;
  }

  private loadSong(i: number): void {
    this.currentIndex = (i + this.playlist.length) % this.playlist.length;
    const song = this.playlist[this.currentIndex];
    this.visualizer.loadSong(song);
    this.ui.setSongInfo(song.title, song.artist + ` · ${this.currentIndex + 1}/${this.playlist.length}`);
  }

  private togglePlay(): void {
    if (this.visualizer.getIsPlaying()) this.visualizer.pause();
    else this.visualizer.play();
  }

  private nextSong(): void {
    this.loadSong(this.currentIndex + 1);
    this.visualizer.play();
  }

  private changeVolume(delta: number): void {
    const v = Math.max(0, Math.min(1, this.visualizer.volume + delta));
    this.visualizer.setVolume(v);
    this.ui.setVolume(v);
  }

  private mute(): void {
    const v = this.visualizer.volume > 0.01 ? 0 : 0.7;
    this.visualizer.setVolume(v);
    this.ui.setVolume(v);
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const audio = this.visualizer.getAudioData();
    if (this.volumeContinuous) {
      const now = performance.now();
      if (now - this.lastVolumeChange > 180) {
        const deltaVol = this.lastGesture === '3-finger' ? 0.035 : -0.035;
        this.changeVolume(deltaVol);
        this.lastVolumeChange = now;
      }
    }
    this.particles.update(audio, this.lastGesture, delta);
    const song = this.visualizer.getCurrentSong();
    if (song) {
      this.ui.setProgress(
        this.visualizer.getCurrentTime(),
        this.visualizer.getDuration(),
        (t) => this.visualizer.seek(t)
      );
    }
    const t = performance.now() * 0.0008;
    this.camera.position.x = Math.sin(t) * 1.5;
    this.camera.position.y = Math.cos(t * 0.7) * 1.0;
    this.camera.position.z = 16 + Math.sin(t * 1.3) * 0.8;
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    this.visualizer.onEnded(() => this.nextSong());
  };
}

const app = new App();
app.start().catch(e => console.error('初始化失败:', e));
