import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSolarSystem, updateSolarSystem, getPlanetFocusPosition, PLANET_DATA } from './solarSystem';
import { createUI } from './ui';

export type FrameCallback = (delta: number, elapsed: number) => void;

export interface SceneController {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  useFrame: (cb: FrameCallback) => void;
  start: () => void;
  stop: () => void;
}

const frameCallbacks: FrameCallback[] = [];

export function useFrame(cb: FrameCallback): void {
  frameCallbacks.push(cb);
}

export function initScene(container: HTMLElement): SceneController {
  const scene = new THREE.Scene();
  
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 2;
  bgCanvas.height = 2;
  const bgCtx = bgCanvas.getContext('2d')!;
  const bgGradient = bgCtx.createLinearGradient(0, 0, 0, 2);
  bgGradient.addColorStop(0, '#0a0a2e');
  bgGradient.addColorStop(0.5, '#050510');
  bgGradient.addColorStop(1, '#000000');
  bgCtx.fillStyle = bgGradient;
  bgCtx.fillRect(0, 0, 2, 2);
  const bgTexture = new THREE.CanvasTexture(bgCanvas);
  scene.background = bgTexture;

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 30, 80);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 5;
  controls.maxDistance = 200;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.8;
  controls.rotateSpeed = 0.6;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  const ambientLight = new THREE.AmbientLight(0x404040, 0.15);
  scene.add(ambientLight);

  const starsGeometry = new THREE.BufferGeometry();
  const starCount = 2000;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const radius = 200 + Math.random() * 300;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = radius * Math.cos(phi);
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true,
    opacity: 0.8
  });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(stars);

  const clock = new THREE.Clock();
  let animationId: number | null = null;
  let isRunning = false;

  function animate(): void {
    if (!isRunning) return;
    
    animationId = requestAnimationFrame(animate);
    
    const delta = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.getElapsedTime();
    
    controls.update();
    
    frameCallbacks.forEach(cb => cb(delta, elapsed));
    
    renderer.render(scene, camera);
  }

  function start(): void {
    if (isRunning) return;
    isRunning = true;
    clock.start();
    animate();
  }

  function stop(): void {
    isRunning = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  }

  function handleResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', handleResize);

  const originalDispose = controls.dispose.bind(controls);
  controls.dispose = () => {
    stop();
    window.removeEventListener('resize', handleResize);
    renderer.dispose();
    originalDispose();
  };

  return {
    scene,
    camera,
    renderer,
    controls,
    useFrame,
    start,
    stop
  };
}

export default initScene;

const canvasContainer = document.getElementById('canvas-container');
const uiContainer = document.getElementById('ui-container');

if (canvasContainer && uiContainer) {
  const controller = initScene(canvasContainer);
  
  const ui = createUI(uiContainer);
  
  const solarSystem = createSolarSystem(controller.scene, uiContainer);
  
  ui.updatePlanetOptions(PLANET_DATA.map(p => p.nameCn + ' · ' + p.name));
  
  let speedMultiplier = 1.0;
  let showOrbits = true;
  let focusTarget: THREE.Vector3 | null = null;
  let focusProgress = 0;
  let focusPlanetName = '';
  
  ui.onSpeedChange((speed) => {
    speedMultiplier = speed;
  });
  
  ui.onOrbitToggle((show) => {
    showOrbits = show;
  });
  
  ui.onFocus((planetDisplayName) => {
    const nameParts = planetDisplayName.split(' · ');
    focusPlanetName = nameParts[1] || planetDisplayName;
    const target = getPlanetFocusPosition(solarSystem, focusPlanetName, controller.camera);
    if (target) {
      focusTarget = target;
      focusProgress = 0;
      
      const planet = solarSystem.planets.find(p => p.data.name === focusPlanetName);
      if (planet) {
        controller.controls.target.copy(planet.mesh.position);
      }
    }
  });
  
  let frameCount = 0;
  let lastFPSUpdate = 0;
  
  controller.useFrame((delta, elapsed) => {
    const result = updateSolarSystem(
      solarSystem,
      delta,
      speedMultiplier,
      controller.camera,
      showOrbits,
      focusTarget,
      focusProgress
    );
    focusProgress = result.focusProgress;
    
    if (result.shouldUpdateControls) {
      const planet = solarSystem.planets.find(p => p.data.name === focusPlanetName);
      if (planet) {
        controller.controls.target.lerp(planet.mesh.position, 0.05);
      }
    }
    
    if (focusProgress >= 1) {
      focusTarget = null;
    }
    
    frameCount++;
    if (elapsed - lastFPSUpdate >= 0.5) {
      const fps = frameCount / (elapsed - lastFPSUpdate);
      ui.updateFPS(fps);
      frameCount = 0;
      lastFPSUpdate = elapsed;
    }
  });
  
  controller.start();
}
