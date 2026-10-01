import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createNebula, updateNebula, disposeNebula, animateNebula, NebulaParams } from './nebula';
import { createControls } from './controls';

const initialParams: NebulaParams = {
  particleCount: 5000,
  hueOffset: 0,
  radius: 12,
  rotationSpeed: 0.5
};

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let nebula: THREE.Points;
let clock: THREE.Clock;
let autoRotateAngle = 0;
let userInteracting = false;
let frameCount = 0;
let lastFpsUpdate = 0;
let fpsCounter: HTMLElement;

function init(): void {
  const container = document.getElementById('canvas-container')!;
  fpsCounter = document.getElementById('fps-counter')!;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 25);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 5;
  controls.maxDistance = 100;
  controls.enablePan = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  controls.addEventListener('start', () => {
    userInteracting = true;
  });

  controls.addEventListener('end', () => {
    userInteracting = false;
    autoRotateAngle = Math.atan2(camera.position.x, camera.position.z);
  });

  nebula = createNebula(initialParams);
  scene.add(nebula);

  clock = new THREE.Clock();

  const controlsContainer = document.getElementById('controls-container')!;
  createControls(controlsContainer, initialParams, handleParamsChange);

  window.addEventListener('resize', onWindowResize);

  animate();
}

function handleParamsChange(params: NebulaParams): void {
  updateNebula(nebula, params);
}

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateFps(delta: number): void {
  frameCount++;
  lastFpsUpdate += delta;

  if (lastFpsUpdate >= 0.5) {
    const fps = Math.round(frameCount / lastFpsUpdate);
    fpsCounter.textContent = `FPS: ${fps}`;
    frameCount = 0;
    lastFpsUpdate = 0;
  }
}

function animate(): void {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  updateFps(delta);

  if (!userInteracting) {
    const autoRotationSpeed = (2 * Math.PI) / 60;
    autoRotateAngle += autoRotationSpeed * delta;

    const radius = Math.sqrt(
      camera.position.x ** 2 + camera.position.z ** 2
    );
    camera.position.x = Math.sin(autoRotateAngle) * radius;
    camera.position.z = Math.cos(autoRotateAngle) * radius;
    camera.lookAt(0, 0, 0);
  }

  animateNebula(nebula, delta);

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('beforeunload', () => {
  if (nebula) {
    scene.remove(nebula);
    disposeNebula(nebula);
  }
  renderer.dispose();
  controls.dispose();
});

init();
