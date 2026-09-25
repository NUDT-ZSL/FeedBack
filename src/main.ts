import * as THREE from 'three';
import { AudioVisualizer, PLAYLIST, THEMES, type ColorTheme } from './audio-visualizer';
import { ParticleSystem } from './particle-system';
import { GestureController } from './gesture-controller';
import { UIOverlay } from './ui-overlay';
import { AppStore, type AppState } from './app-store';

/**
 * 应用装配层：
 * - AppStore 是唯一可信状态来源，所有用户操作（手势/键盘/鼠标）都转化为 store action；
 * - store 订阅者把状态变化同步应用到音频、粒子、UI（同一次通知内完成，保证同帧一致）；
 * - 渲染循环只读取状态和音频数据，不修改任何状态。
 */
class App {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private visualizer!: AudioVisualizer;
  private particles!: ParticleSystem;
  private gesture!: GestureController;
  private ui!: UIOverlay;
  private store = new AppStore(PLAYLIST.length);
  private initialized = false;

  async start(): Promise<void> {
    this.initThree();
    this.visualizer = new AudioVisualizer();
    await this.visualizer.init();
    this.particles = new ParticleSystem(this.scene, 3000);
    this.ui = new UIOverlay(document.getElementById('ui-overlay')!);
    this.gesture = new GestureController();
    // 播放结束自动切歌：只注册一次，由音频模块的调度器检测结束并回调
    this.visualizer.onEnded(() => this.store.nextSong());
    this.applyInitialState();
    this.wireStore();
    this.bindEvents();
    this.animate();
    this.initialized = true;
  }

  /** 把 store 的初始状态一次性应用到各模块 */
  private applyInitialState(): void {
    const s = this.store.getState();
    const song = PLAYLIST[s.songIndex];
    const theme = THEMES[s.themeIndex];
    this.visualizer.loadSong(song);
    this.visualizer.setVolume(s.volume);
    this.particles.setTheme(theme, false);
    this.applyBodyTheme(theme);
    this.ui.setThemes(THEMES, s.themeIndex, (i) => this.store.selectTheme(i));
    this.ui.onSeek((t) => this.visualizer.seek(t));
    this.ui.setSongInfo(song.title, this.songSubtitle(s.songIndex));
    this.ui.setProgress(0, song.duration);
    this.ui.setVolume(s.volume);
    this.ui.setPlaylistHint(`播放列表 ${PLAYLIST.length} 首 · Web Audio 合成演示`);
  }

  /** 状态变化 → 各模块的同步应用（同一次通知内全部完成） */
  private wireStore(): void {
    this.store.subscribe((state, changed) => {
      if (changed.has('songIndex')) {
        const song = PLAYLIST[state.songIndex];
        this.visualizer.loadSong(song);
        if (state.isPlaying) this.visualizer.play();
        this.ui.setSongInfo(song.title, this.songSubtitle(state.songIndex));
        this.ui.setProgress(0, song.duration);
      } else if (changed.has('isPlaying')) {
        if (state.isPlaying) this.visualizer.play();
        else this.visualizer.pause();
      }
      if (changed.has('volume')) {
        this.visualizer.setVolume(state.volume);
        this.ui.setVolume(state.volume);
      }
      if (changed.has('themeIndex')) {
        const theme = THEMES[state.themeIndex];
        this.particles.setTheme(theme, true);
        this.applyBodyTheme(theme);
        this.ui.setActiveTheme(state.themeIndex);
      }
      if (changed.has('gestureEventId')) {
        this.ui.setGestureIcon(state.gesture);
      }
      if (changed.has('gestureReady')) {
        this.ui.setGestureActive(state.gestureReady);
      }
    });
  }

  private songSubtitle(index: number): string {
    return PLAYLIST[index].artist + ` · ${index + 1}/${PLAYLIST.length}`;
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
        this.gesture.onGestureChange((g) => this.store.applyGesture(g));
        this.store.setGestureReady(true);
      } catch (e) {
        // 摄像头不可用时退回键鼠控制，音频/粒子/UI 不受影响
        console.warn('摄像头初始化失败，可使用鼠标键盘控制：', e);
      }
      document.getElementById('start-overlay')!.classList.add('hidden');
      this.store.play();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.initialized) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.store.togglePlay(); break;
        case 'ArrowRight': this.store.nextSong(); break;
        case 'ArrowUp': this.store.changeVolume(0.05); break;
        case 'ArrowDown': this.store.changeVolume(-0.05); break;
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
    const docStyle = document.documentElement.style;
    docStyle.setProperty('--bg-top', theme.bgTop);
    docStyle.setProperty('--bg-bottom', theme.bgBottom);
    document.body.style.background = `linear-gradient(to bottom, ${theme.bgTop} 0%, ${theme.bgBottom} 100%)`;
  }

  /**
   * 纯渲染循环：只读取 store 状态和音频分析数据驱动画面与进度显示，
   * 不修改任何状态（音量连续调节、切歌等状态变更均由 store action 触发）。
   */
  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const state: Readonly<AppState> = this.store.getState();
    const audio = this.visualizer.getAudioData();
    this.particles.update(audio, state.gesture, delta);
    this.ui.setProgress(this.visualizer.getCurrentTime(), this.visualizer.getDuration());
    const t = performance.now() * 0.0008;
    this.camera.position.x = Math.sin(t) * 1.5;
    this.camera.position.y = Math.cos(t * 0.7) * 1.0;
    this.camera.position.z = 16 + Math.sin(t * 1.3) * 0.8;
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  };
}

const app = new App();
app.start().catch(e => console.error('初始化失败:', e));
