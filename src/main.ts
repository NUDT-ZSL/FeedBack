import * as THREE from 'three';
import { createGallery, type Artwork } from './gallery';
import { createUI } from './ui';
import { createStarParticles } from './particles';

const app = document.getElementById('app')!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0A0A0F);
scene.fog = new THREE.Fog(0x0A0A0F, 15, 40);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 1.7, 14);
camera.lookAt(0, 2.5, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = false;
app.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0x9098B8, 0x2A2520, 0.55);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.25);
scene.add(ambientLight);

const mainLight = new THREE.DirectionalLight(0xFFF0DC, 0.35);
mainLight.position.set(5, 10, 5);
scene.add(mainLight);

const fillLight = new THREE.PointLight(0xC5A35A, 0.6, 30);
fillLight.position.set(0, 4, 0);
scene.add(fillLight);

const particles = createStarParticles(scene);

let focusedArtwork: Artwork | null = null;
let infoPanelOpen = false;

const ui = createUI(app, {
  onThumbnailClick: (index) => {
    gallery.teleportTo(index, camera);
  },
  onInfoPanelClose: () => {
    infoPanelOpen = false;
  }
});

const gallery = createGallery(scene, {
  onArtworkFocus: (artwork) => {
    focusedArtwork = artwork;
    ui.setFocusedArtwork(artwork);
  },
  onArtworkClick: (artwork) => {
    infoPanelOpen = true;
    ui.showInfoPanel(artwork);
  },
  onNearestDistance: (distance) => {
    ui.updateDistance(distance);
  }
});

ui.setThumbnails(gallery.artworks);
ui.setFocusedArtwork(null);

const keys: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape' && infoPanelOpen) {
    ui.hideInfoPanel();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let yaw = 0;
let pitch = 0;
let targetYaw = 0;
let targetPitch = 0;
const SENSITIVITY = 0.003;
const DAMPING = 0.95;

function updateCameraRotationFromDelta(dx: number, dy: number): void {
  targetYaw -= dx * SENSITIVITY;
  targetPitch -= dy * SENSITIVITY;
  targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, targetPitch));
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (infoPanelOpen) return;
  isDragging = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

renderer.domElement.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastMouseX;
  const dy = e.clientY - lastMouseY;
  updateCameraRotationFromDelta(dx, dy);
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

let touchStartX = 0;
let touchStartY = 0;
let touchId: number | null = null;

renderer.domElement.addEventListener('touchstart', (e) => {
  if (infoPanelOpen) return;
  if (e.touches.length === 1) {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchId = t.identifier;
  }
}, { passive: true });

renderer.domElement.addEventListener('touchmove', (e) => {
  if (touchId === null) return;
  for (const t of Array.from(e.touches)) {
    if (t.identifier === touchId) {
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      updateCameraRotationFromDelta(dx, dy);
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      break;
    }
  }
}, { passive: true });

renderer.domElement.addEventListener('touchend', (e) => {
  let found = false;
  for (const t of Array.from(e.touches)) {
    if (t.identifier === touchId) {
      found = true;
      break;
    }
  }
  if (!found) touchId = null;
}, { passive: true });

let clickStartTime = 0;
let clickStartX = 0;
let clickStartY = 0;

renderer.domElement.addEventListener('mousedown', (e) => {
  clickStartTime = performance.now();
  clickStartX = e.clientX;
  clickStartY = e.clientY;
});

renderer.domElement.addEventListener('mouseup', (e) => {
  const elapsed = performance.now() - clickStartTime;
  const dx = Math.abs(e.clientX - clickStartX);
  const dy = Math.abs(e.clientY - clickStartY);
  if (elapsed < 300 && dx < 5 && dy < 5 && !infoPanelOpen) {
    gallery.handleClick(e, camera);
  }
});

renderer.domElement.addEventListener('click', (e) => {
  if (infoPanelOpen) {
    const target = e.target as HTMLElement;
    if (target === renderer.domElement) {
      ui.hideInfoPanel();
    }
  }
});

let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;

renderer.domElement.addEventListener('touchend', (e) => {
  if (e.changedTouches.length === 1 && !infoPanelOpen) {
    const t = e.changedTouches[0];
    const now = performance.now();
    const dx = Math.abs(t.clientX - lastTapX);
    const dy = Math.abs(t.clientY - lastTapY);
    if (now - lastTapTime < 300 && dx < 10 && dy < 10) {
      const touchLike = { clientX: t.clientX, clientY: t.clientY, target: renderer.domElement } as unknown as Touch;
      gallery.handleClick(touchLike, camera);
    }
    lastTapTime = now;
    lastTapX = t.clientX;
    lastTapY = t.clientY;
  }
}, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const moveSpeed = 5.5;

const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  gallery.update(delta, camera);
  particles.update(delta);

  yaw += (targetYaw - yaw) * (1 - Math.pow(DAMPING, delta * 60));
  pitch += (targetPitch - pitch) * (1 - Math.pow(DAMPING, delta * 60));

  euler.set(pitch, yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);

  if (!infoPanelOpen) {
    const joyVec = ui.getJoystickVector();

    let moveX = 0;
    let moveZ = 0;

    if (keys['KeyW'] || keys['ArrowUp']) moveZ -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveZ += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;

    moveZ -= joyVec.y;
    moveX += joyVec.x;

    const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLen > 1) {
      moveX /= moveLen;
      moveZ /= moveLen;
    }

    if (moveX !== 0 || moveZ !== 0) {
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();

      const velocity = moveSpeed * delta;
      camera.position.addScaledVector(forward, -moveZ * velocity);
      camera.position.addScaledVector(right, moveX * velocity);

      const boundary = 18;
      camera.position.x = Math.max(-boundary, Math.min(boundary, camera.position.x));
      camera.position.z = Math.max(-boundary, Math.min(boundary, camera.position.z));
    }
  }

  renderer.render(scene, camera);
}

animate();
