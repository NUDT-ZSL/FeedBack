import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSolarSystem, updateSolarSystem, PLANET_DATA } from './solarSystem';
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
  
  const FOCUS_DURATION = 1.0;
  
  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  interface FocusState {
    planetName: string;
    progress: number;
    locked: boolean;
    startTarget: THREE.Vector3;
    startDistance: number;
    prevPlanetPos: THREE.Vector3;
  }
  let focusState: FocusState | null = null;
  
  ui.onSpeedChange((speed) => {
    speedMultiplier = speed;
  });
  
  ui.onOrbitToggle((show) => {
    showOrbits = show;
  });
  
  ui.onFocus((planetDisplayName) => {
    const nameParts = planetDisplayName.split(' · ');
    const planetName = nameParts[1] || planetDisplayName;
    const planet = solarSystem.planets.find(p => p.data.name === planetName);
    if (!planet) return;
    focusState = {
      planetName,
      progress: 0,
      locked: false,
      startTarget: controller.controls.target.clone(),
      startDistance: controller.camera.position.distanceTo(planet.mesh.position),
      prevPlanetPos: planet.mesh.position.clone()
    };
  });
  
  let frameCount = 0;
  let lastFPSUpdate = 0;
  
  controller.useFrame((delta, elapsed) => {
    updateSolarSystem(
      solarSystem,
      delta,
      speedMultiplier,
      controller.camera,
      showOrbits
    );
    
    if (focusState) {
      const state = focusState;
      const planet = solarSystem.planets.find(p => p.data.name === state.planetName);
      if (!planet) {
        focusState = null;
      } else {
        const planetPos = planet.mesh.position;
        const camera = controller.camera;
        const orbitControls = controller.controls;
        
        if (state.locked) {
          const movement = planetPos.clone().sub(state.prevPlanetPos);
          camera.position.add(movement);
          orbitControls.target.copy(planetPos);
        } else {
          state.progress = Math.min(1, state.progress + delta / FOCUS_DURATION);
          const t = easeInOutCubic(state.progress);
          orbitControls.target.lerpVectors(state.startTarget, planetPos, t);
          
          const desiredDistance = planet.data.radius * 6 + 5;
          const offset = camera.position.clone().sub(planetPos);
          if (offset.lengthSq() < 1e-8) {
            offset.set(0, 0.5, 1);
          }
          offset.normalize();
          const newDistance = state.startDistance + (desiredDistance - state.startDistance) * t;
          camera.position.copy(planetPos).addScaledVector(offset, newDistance);
          
          if (state.progress >= 1) {
            orbitControls.target.copy(planetPos);
            state.locked = true;
          }
        }
        
        state.prevPlanetPos.copy(planetPos);
      }
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
