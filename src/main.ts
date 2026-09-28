import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sun } from './sun';
import { Room } from './room';
import { SunPathRenderer } from './sunPath';
import { Season, SunPosition, RoomLighting } from './types';
import './style.css';

class Application {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;

  private sun: Sun;
  private room: Room;
  private sunPathRenderer: SunPathRenderer;

  private clock: THREE.Clock;
  private animationId: number | null = null;

  private seasonButtons: NodeListOf<HTMLButtonElement>;
  private timeSlider: HTMLInputElement;
  private currentTimeDisplay: HTMLElement;
  private sunAnglesDisplay: HTMLElement;
  private windowIlluminationBar: HTMLElement;
  private windowIlluminationValue: HTMLElement;
  private avgIlluminanceValue: HTMLElement;
  private shadowRatioValue: HTMLElement;

  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fps: number = 60;

  constructor() {
    this.canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error('Canvas element not found');
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 50);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(6, 5, 8);
    this.camera.lookAt(0, 1.5, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 25;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.2;
    this.controls.target.set(0, 1.5, 0);

    this.sun = new Sun('autumn', 12);

    this.room = new Room();
    this.scene.add(this.room.group);

    const ambientLight = new THREE.AmbientLight(0x404060, 0.4);
    this.scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1f, 0.3);
    this.scene.add(hemisphereLight);

    this.sunPathRenderer = new SunPathRenderer('sun-path-canvas');

    this.seasonButtons = document.querySelectorAll('.season-btn');
    this.timeSlider = document.getElementById('time-slider') as HTMLInputElement;
    this.currentTimeDisplay = document.getElementById('current-time') as HTMLElement;
    this.sunAnglesDisplay = document.getElementById('sun-angles') as HTMLElement;
    this.windowIlluminationBar = document.getElementById('window-illumination') as HTMLElement;
    this.windowIlluminationValue = document.getElementById('window-illumination-value') as HTMLElement;
    this.avgIlluminanceValue = document.getElementById('avg-illuminance') as HTMLElement;
    this.shadowRatioValue = document.getElementById('shadow-ratio') as HTMLElement;

    this.clock = new THREE.Clock();

    this.bindEvents();
    this.updateSeasonUI('autumn');
  }

  private bindEvents(): void {
    this.seasonButtons.forEach(button => {
      button.addEventListener('click', () => {
        const season = button.dataset.season as Season;
        if (season) {
          this.sun.setSeason(season, true);
          this.updateSeasonUI(season);
        }
      });
    });

    this.timeSlider.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      this.sun.setTime(value);
    });

    window.addEventListener('resize', () => this.onResize());
  }

  private updateSeasonUI(activeSeason: Season): void {
    this.seasonButtons.forEach(button => {
      const season = button.dataset.season as Season;
      if (season === activeSeason) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  }

  private updateTimeDisplay(time: number): void {
    const hours = Math.floor(time);
    const minutes = Math.floor((time - hours) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    this.currentTimeDisplay.textContent = timeStr;
  }

  private updateAnglesDisplay(position: SunPosition): void {
    const elev = position.elevation.toFixed(1);
    const azim = position.azimuth.toFixed(1);
    this.sunAnglesDisplay.textContent = `仰角: ${elev}° | 方位角: ${azim}°`;
  }

  private updateLightingUI(lighting: RoomLighting): void {
    const pct = Math.min(100, Math.max(0, lighting.windowIllumination));
    this.windowIlluminationBar.style.width = `${pct}%`;
    this.windowIlluminationValue.textContent = `${pct.toFixed(0)}%`;

    this.avgIlluminanceValue.textContent = `${lighting.avgIlluminance} lx`;
    this.shadowRatioValue.textContent = `${lighting.shadowRatio}%`;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());

    const deltaTime = Math.min(this.clock.getDelta(), 0.1);

    const sunPosition = this.sun.update(deltaTime);

    this.room.updateLight(sunPosition, deltaTime);

    const lighting = this.room.calculateLighting();

    const pathPoints: Record<Season, { x: number; y: number }[]> = {
      spring: this.sun.getSunPathPoints('spring'),
      summer: this.sun.getSunPathPoints('summer'),
      autumn: this.sun.getSunPathPoints('autumn'),
      winter: this.sun.getSunPathPoints('winter')
    };

    const currentSeason = this.sun.getCurrentSeason();
    this.sunPathRenderer.update(sunPosition, currentSeason, pathPoints);

    this.updateTimeDisplay(this.sun.getCurrentTime());
    this.updateAnglesDisplay(sunPosition);
    this.updateLightingUI(lighting);

    this.controls.update();

    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  public start(): void {
    this.clock.start();
    this.animate();
    console.log('Sunlight Simulator started');
  }

  public stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.room.dispose();
    this.renderer.dispose();
    this.controls.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new Application();
  app.start();

  (window as any).app = app;
});
