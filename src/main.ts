import * as THREE from 'three';
import { AudioVisualizer, type ColorTheme } from './audio-visualizer';
import { ParticleSystem } from './particle-system';
import { GestureController } from './gesture-controller';
import { UIOverlay } from './ui-overlay';
import { AppStore } from './app-store';
import { GestureActions } from './gesture-actions';

class App {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private visualizer!: AudioVisualizer;
  private particles!: ParticleSystem;
  private gesture!: GestureController;
  private ui!: UIOverlay;
  private store!: AppStore;
  private gestureActions!: GestureActions;
  private rafId = 0;
  private initialized = false;

  async start(): Promise<void> {
    this.initThree();
    this.visualizer = new AudioVisualizer();
    await this.visualizer.init();
    this.store = new AppStore(this.visualizer);
    this.gestureActions = new GestureActions(this.store);
    this.particles = new ParticleSystem(this.scene, 3000);
    this.ui = new UIOverlay(document.getElementById('ui-overlay')!);
    this.gesture = new GestureController();

    // 初始主题：无过渡直接应用
    this.particles.setTheme(this.store.currentTheme, false);
    this.applyBodyTheme(this.store.currentTheme);

    this.bindStateRenderers();
    this.ui.setThemes(this.store.themes, this.store.getState().themeIndex, (i) => this.store.setTheme(i));
    this.ui.onSeek((t) => this.store.seek(t));
    this.ui.setPlaylistHint(`播放列表 ${this.store.songs.length} 首 · Web Audio 合成演示`);
    this.visualizer.onEnded(() => this.store.onSongEnded());
    this.store.loadSong(0, false);
    this.bindEvents();
    this.animate();
    this.initialized = true;
  }

  /** 状态 -> 渲染 的单向绑定：所有订阅在同一个 commit 内同步执行，保证同帧一致 */
  private bindStateRenderers(): void {
    this.store.subscribe((state, changed) => {
      if (changed.has('themeIndex')) {
        const theme = this.store.currentTheme;
        this.particles.setTheme(theme, true);
        this.applyBodyTheme(theme);
        this.ui.setActiveTheme(state.themeIndex);
      }
      if (changed.has('songIndex')) {
        const song = this.store.currentSong;
        this.ui.setSongInfo(song.title, `${song.artist} · ${state.songIndex + 1}/${this.store.songs.length}`);
        this.ui.setProgress(0, song.duration);
      }
      if (changed.has('volume')) {
        this.ui.setVolume(state.volume);
      }
      if (changed.has('gesture')) {
        this.ui.setGestureIcon(state.gesture);
      }
      if (changed.has('gestureReady')) {
        this.ui.setGestureActive(state.gestureReady);
      }
    });
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
        this.gesture.onGestureChange((g) => this.gestureActions.enqueue(g));
        this.store.setGestureReady(true);
      } catch (e) {
        // 摄像头不可用时退回键鼠控制，其余模块不受影响
        console.warn('摄像头初始化失败，可使用鼠标键盘控制：', e);
        this.store.setGestureReady(false);
      }
      document.getElementById('start-overlay')!.classList.add('hidden');
      this.store.loadSong(0, true);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.initialized) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.store.togglePlay(); break;
        case 'ArrowRight': this.store.nextSong(); break;
        case 'ArrowUp': this.store.adjustVolume(0.05); break;
        case 'ArrowDown': this.store.adjustVolume(-0.05); break;
        case 'KeyM': this.store.toggleMute(); break;
      }
    });
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private applyBodyTheme(theme: ColorTheme): void {
    document.body.style.background = `linear-gradient(to bottom, ${theme.bgTop} 0%, ${theme.bgBottom} 100%)`;
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();

    // 1) 状态变更：只在这一段发生，全部经由 store 收敛
    this.visualizer.tick();
    this.gestureActions.flush(now);
    this.gestureActions.tick(now);

    // 2) 渲染：只读取状态，不再修改
    const state = this.store.getState();
    const audio = this.visualizer.getAudioData();
    this.particles.update(audio, state.gesture, delta);
    this.ui.setProgress(this.visualizer.getCurrentTime(), this.visualizer.getDuration());

    const t = now * 0.0008;
    this.camera.position.x = Math.sin(t) * 1.5;
    this.camera.position.y = Math.cos(t * 0.7) * 1.0;
    this.camera.position.z = 16 + Math.sin(t * 1.3) * 0.8;
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  };
}

const app = new App();
app.start().catch(e => console.error('初始化失败:', e));
