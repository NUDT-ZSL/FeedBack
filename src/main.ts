import * as THREE from 'three';
import { Player } from './player';
import { TrackManager } from './track';
import { AudioController } from './audio-controller';
import { UIManager } from './ui-manager';

class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;

  private player: Player;
  private trackManager: TrackManager;
  private audioController: AudioController;
  private uiManager: UIManager;

  private clock: THREE.Clock;
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private score: number = 0;
  private playerName: string = '玩家';
  private gameStartTime: number = 0;

  private readonly SCORE_PER_SECOND = 10;
  private readonly SCORE_PER_COIN = 100;
  private readonly CAMERA_OFFSET = new THREE.Vector3(0, 1.5, 3);
  private readonly CAMERA_SMOOTH = 0.1;

  private beatTimer: number = 0;
  private beatInterval: number = 60 / 128;

  private frameCount: number = 0;
  private fpsUpdateTime: number = 0;
  private currentFps: number = 60;

  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0020);
    this.scene.fog = new THREE.Fog(0x0a0020, 20, 80);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.5, 3);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(5, 10, 5);
    this.scene.add(this.directionalLight);

    this.player = new Player();
    this.scene.add(this.player.getMesh());

    this.trackManager = new TrackManager(this.scene);

    this.audioController = new AudioController();

    this.uiManager = new UIManager();

    this.clock = new THREE.Clock();

    this.setupEventListeners();
    this.uiManager.showStartScreen();

    this.uiManager.setOnStartCallback((name) => this.startGame(name));
    this.uiManager.setOnRestartCallback(() => this.restartGame());
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.onWindowResize());

    document.addEventListener('keydown', (e) => {
      if (!this.isPlaying || this.isPaused) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.player.jump();
          break;
        case 'KeyA':
        case 'ArrowLeft':
          e.preventDefault();
          this.player.dodgeLeft();
          break;
        case 'KeyD':
        case 'ArrowRight':
          e.preventDefault();
          this.player.dodgeRight();
          break;
      }
    });
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private async startGame(playerName: string): Promise<void> {
    this.playerName = playerName;

    try {
      await this.audioController.loadAudio('/src/music/track.wav');
    } catch (e) {
      console.warn('Using synthetic audio');
    }

    this.score = 0;
    this.player.reset();
    this.trackManager.reset();
    this.beatTimer = 0;

    const bpm = this.audioController.getBPM() || 128;
    this.beatInterval = 60 / bpm;

    this.uiManager.showGameHUD();
    this.uiManager.updateScore(0);
    this.uiManager.updateHealth(this.player.getHealth());

    this.isPlaying = true;
    this.isPaused = false;
    this.gameStartTime = performance.now();

    this.audioController.play();
    this.clock.start();

    this.animate();
  }

  private restartGame(): void {
    this.uiManager.showStartScreen();
    this.uiManager.setPlayerName(this.playerName);
    this.isPlaying = false;
  }

  private endGame(): void {
    this.isPlaying = false;
    this.audioController.stop();

    this.uiManager.showEndScreen(Math.floor(this.score), this.playerName);
  }

  private animate(): void {
    if (!this.isPlaying) return;

    requestAnimationFrame(() => this.animate());

    const deltaTime = Math.min(this.clock.getDelta(), 0.1);

    this.update(deltaTime);
    this.render();
    this.updateFPS(deltaTime);
  }

  private update(deltaTime: number): void {
    this.audioController.update();

    const beatIntensity = this.audioController.getBeatIntensity();
    const energyLevel = this.audioController.getEnergyLevel();
    const isBeat = this.audioController.isBeatDetected();

    if (isBeat) {
      this.trackManager.onBeat();
    }

    this.trackManager.setBeatIntensity(beatIntensity);
    this.trackManager.updateColors(energyLevel);

    this.player.update(deltaTime);

    const playerPos = this.player.getPosition();
    this.trackManager.update(deltaTime, playerPos.z);

    const playerBox = this.player.getBoundingBox();
    const collisionResult = this.trackManager.checkCollisions(
      playerBox,
      this.player.getIsJumping()
    );

    if (collisionResult.coins > 0) {
      this.score += collisionResult.coins * this.SCORE_PER_COIN;
      this.uiManager.updateScore(Math.floor(this.score));
    }

    if (collisionResult.damage) {
      const dead = this.player.takeDamage();
      this.uiManager.updateHealth(this.player.getHealth());
      if (dead) {
        this.endGame();
        return;
      }
    }

    this.score += this.SCORE_PER_SECOND * deltaTime;
    this.uiManager.updateScore(Math.floor(this.score));

    this.updateCamera(deltaTime);

    this.uiManager.updateBeatIntensity(beatIntensity);

    const freqData = this.audioController.getFrequencyData();
    if (freqData.length > 0) {
      this.uiManager.drawSpectrum(freqData, beatIntensity);
    }

    this.scene.background = new THREE.Color(0x0a0020).lerp(
      new THREE.Color(0x150030),
      energyLevel * 0.3
    );
  }

  private updateCamera(deltaTime: number): void {
    const playerPos = this.player.getPosition();
    const targetPos = new THREE.Vector3(
      playerPos.x,
      playerPos.y + this.CAMERA_OFFSET.y,
      playerPos.z + this.CAMERA_OFFSET.z
    );

    this.camera.position.lerp(targetPos, this.CAMERA_SMOOTH);

    const lookTarget = new THREE.Vector3(
      playerPos.x,
      playerPos.y + 0.5,
      playerPos.z - 5
    );
    this.camera.lookAt(lookTarget);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateFPS(deltaTime: number): void {
    this.frameCount++;
    this.fpsUpdateTime += deltaTime;

    if (this.fpsUpdateTime >= 1) {
      this.currentFps = this.frameCount / this.fpsUpdateTime;
      this.frameCount = 0;
      this.fpsUpdateTime = 0;
    }
  }

  getFPS(): number {
    return this.currentFps;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

let game: Game;

window.addEventListener('DOMContentLoaded', () => {
  game = new Game();
});

export { Game };
