import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';

export interface SilkBall {
  id: string;
  color: string;
  mesh: THREE.Mesh;
  originalPosition: THREE.Vector3;
}

export interface Particle {
  id: string;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export type InteractionEventType =
  | 'silk_drop'
  | 'pattern_select'
  | 'shuttle_click'
  | 'scroll_click'
  | 'camera_orbit'
  | 'loom_double_click'
  | 'target_length_change';

export interface InteractionEvent {
  type: InteractionEventType;
  data?: any;
}

const SNAP_DISTANCE = 0.3;
const PARTICLE_COUNT = 15;

export class UserInteraction {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;

  private silkBalls: SilkBall[] = [];
  private particles: Particle[] = [];
  private silkLibraryGroup: THREE.Group;
  private patternLibraryGroup: THREE.Group;
  private uiGroup: THREE.Group;

  private draggingSilk: SilkBall | null = null;
  private dragTrail: THREE.Line | null = null;
  private dragTrailPoints: THREE.Vector3[] = [];
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private isDragging = false;
  private isOrbiting = false;
  private lastMousePosition = new THREE.Vector2();
  private orbitAngleY = 0;
  private orbitAngleX = 30;
  private orbitDistance = 5;
  private viewMode: 'orbit' | 'firstPerson' = 'orbit';

  private slotPositions: THREE.Vector3[] = [];
  private loomClickable: THREE.Object3D[] = [];
  private shuttleButton: THREE.Object3D | null = null;
  private scrollGroup: THREE.Group | null = null;

  private listeners: Map<InteractionEventType, ((event: InteractionEvent) => void)[]> = new Map();

  private readonly SILK_COLORS: string[] = [
    '#cc2936', '#ffe066', '#1f4e79', '#d6ecf0',
    '#8b0000', '#2e8b57', '#9932cc', '#ff6347',
    '#4682b4', '#daa520', '#8b4513', '#2f4f4f',
  ];

  private readonly PATTERNS = [
    { id: 'baji', name: '八吉图案' },
    { id: 'dragon-phoenix', name: '龙凤纹' },
    { id: 'lotus', name: '缠枝莲' },
    { id: 'wave', name: '海水江崖' },
  ];

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    container: HTMLElement
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.container = container;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.silkLibraryGroup = new THREE.Group();
    this.patternLibraryGroup = new THREE.Group();
    this.uiGroup = new THREE.Group();

    this.uiGroup.add(this.silkLibraryGroup);
    this.uiGroup.add(this.patternLibraryGroup);
    this.scene.add(this.uiGroup);

    this.buildSilkLibrary();
    this.buildPatternLibrary();
    this.buildTargetLengthControl();
    this.bindEvents();
    this.updateCameraPosition();
  }

  private buildSilkLibrary(): void {
    const baseX = 2.8;
    const startY = 2.2;
    const spacing = 0.35;

    this.SILK_COLORS.forEach((color, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;

      const gemGeo = new THREE.BoxGeometry(0.25, 0.25, 0.1);
      const gemMat = new THREE.MeshStandardMaterial({
        color: 0x2a1810,
        roughness: 0.5,
        metalness: 0.3,
        transparent: true,
        opacity: 0.8,
      });
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(baseX + col * 0.3, startY - row * spacing, -0.5);
      this.silkLibraryGroup.add(gem);

      const silkGeo = new THREE.SphereGeometry(0.05, 16, 16);
      const silkMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.3,
        metalness: 0.1,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.2,
      });
      const silk = new THREE.Mesh(silkGeo, silkMat);
      silk.position.set(baseX + col * 0.3, startY - row * spacing, -0.4);
      silk.userData.isSilkBall = true;
      silk.userData.color = color;
      this.silkLibraryGroup.add(silk);

      this.silkBalls.push({
        id: uuidv4(),
        color,
        mesh: silk,
        originalPosition: silk.position.clone(),
      });

      const glowGeo = new THREE.RingGeometry(0.08, 0.12, 32);
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.copy(silk.position);
      glow.position.z -= 0.01;
      glow.rotation.y = Math.PI;
      this.silkLibraryGroup.add(glow);
    });

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255, 224, 178, 0.9)';
    ctx.font = 'bold 28px "Ma Shan Zheng", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('丝线库', 128, 45);

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex,
      transparent: true,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), labelMat);
    label.position.set(baseX + 0.3, startY + 0.2, -0.5);
    this.silkLibraryGroup.add(label);
  }

  private buildPatternLibrary(): void {
    const baseX = -2.8;
    const startY = 2.2;
    const spacing = 0.55;

    this.PATTERNS.forEach((pattern, index) => {
      const y = startY - index * spacing;

      const bgGeo = new THREE.BoxGeometry(0.6, 0.45, 0.1);
      const bgMat = new THREE.MeshStandardMaterial({
        color: 0x2a1810,
        roughness: 0.6,
        metalness: 0.2,
      });
      const bg = new THREE.Mesh(bgGeo, bgMat);
      bg.position.set(baseX, y, -0.5);
      this.patternLibraryGroup.add(bg);

      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = 128;
      patternCanvas.height = 128;
      const ctx = patternCanvas.getContext('2d')!;

      ctx.fillStyle = '#3e2723';
      ctx.fillRect(0, 0, 128, 128);

      for (let py = 0; py < 64; py++) {
        for (let px = 0; px < 64; px++) {
          let value: number;
          switch (pattern.id) {
            case 'baji':
              const cx = 32, cy = 32;
              const dx = px - cx, dy = py - cy;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const angle = Math.atan2(dy, dx);
              value = Math.sin(angle * 8) * 10 + dist * 2;
              break;
            case 'dragon-phoenix':
              value = Math.sin(px * 0.2 + py * 0.1) * Math.cos(py * 0.15) * 0.6 +
                      Math.cos(px * 0.15 - py * 0.2) * Math.sin(px * 0.1) * 0.4;
              break;
            case 'lotus':
              const lx = px - 32, ly = py - 32;
              const ldist = Math.sqrt(lx * lx + ly * ly);
              const langle = Math.atan2(ly, lx);
              value = Math.cos(langle * 6) * Math.exp(-ldist * 0.05) + Math.sin(px * 0.1 + py * 0.05) * 0.3;
              break;
            case 'wave':
            default:
              value = Math.sin(px * 0.15 + py * 0.05) * 0.5 +
                      Math.sin(px * 0.1 - py * 0.1) * 0.3 +
                      Math.cos(px * 0.2 + py * 0.15) * 0.2;
          }
          const gray = Math.floor(128 + value * 127);
          ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
          ctx.fillRect(px * 2, py * 2, 2, 2);
        }
      }

      ctx.strokeStyle = 'rgba(255, 224, 178, 0.5)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= 64; gx += 16) {
        ctx.beginPath();
        ctx.moveTo(gx * 2, 0);
        ctx.lineTo(gx * 2, 128);
        ctx.stroke();
      }
      for (let gy = 0; gy <= 64; gy += 16) {
        ctx.beginPath();
        ctx.moveTo(0, gy * 2);
        ctx.lineTo(128, gy * 2);
        ctx.stroke();
      }

      const patternTex = new THREE.CanvasTexture(patternCanvas);
      const patternMat = new THREE.MeshStandardMaterial({
        map: patternTex,
        roughness: 0.8,
      });
      const patternMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), patternMat);
      patternMesh.position.set(baseX, y, -0.44);
      patternMesh.userData.isPattern = true;
      patternMesh.userData.patternId = pattern.id;
      this.patternLibraryGroup.add(patternMesh);

      const nameCanvas = document.createElement('canvas');
      nameCanvas.width = 256;
      nameCanvas.height = 48;
      const nameCtx = nameCanvas.getContext('2d')!;
      nameCtx.fillStyle = 'rgba(255, 224, 178, 0.9)';
      nameCtx.font = 'bold 22px "Ma Shan Zheng", cursive';
      nameCtx.textAlign = 'center';
      nameCtx.fillText(pattern.name, 128, 35);

      const nameTex = new THREE.CanvasTexture(nameCanvas);
      const nameMat = new THREE.MeshBasicMaterial({
        map: nameTex,
        transparent: true,
      });
      const nameLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), nameMat);
      nameLabel.position.set(baseX, y - 0.32, -0.45);
      this.patternLibraryGroup.add(nameLabel);
    });

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255, 224, 178, 0.9)';
    ctx.font = 'bold 28px "Ma Shan Zheng", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('纹样库', 128, 45);

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex,
      transparent: true,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), labelMat);
    label.position.set(baseX, startY + 0.4, -0.5);
    this.patternLibraryGroup.add(label);
  }

  private buildTargetLengthControl(): void {
    const baseX = 0;
    const baseY = -1.2;

    const bgGeo = new THREE.BoxGeometry(2, 0.4, 0.1);
    const bgMat = new THREE.MeshStandardMaterial({
      color: 0x2a1810,
      roughness: 0.6,
      metalness: 0.2,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.position.set(baseX, baseY, -1);
    this.uiGroup.add(bg);

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 300;
    labelCanvas.height = 48;
    const ctx = labelCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255, 224, 178, 0.9)';
    ctx.font = 'bold 20px "Ma Shan Zheng", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('织物长度: 20 厘米 (步长5厘米)', 150, 35);

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.MeshBasicMaterial({
      map: labelTex,
      transparent: true,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), labelMat);
    label.position.set(baseX, baseY, -0.94);
    this.uiGroup.add(label);

    const minusBtnGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
    const btnMat = new THREE.MeshStandardMaterial({
      color: 0x8b7d6b,
      metalness: 0.7,
      roughness: 0.3,
    });
    const minusBtn = new THREE.Mesh(minusBtnGeo, btnMat);
    minusBtn.rotation.x = Math.PI / 2;
    minusBtn.position.set(baseX - 0.7, baseY, -0.93);
    minusBtn.userData.isLengthControl = true;
    minusBtn.userData.delta = -5;
    this.uiGroup.add(minusBtn);

    const plusBtn = new THREE.Mesh(minusBtnGeo, btnMat.clone());
    plusBtn.rotation.x = Math.PI / 2;
    plusBtn.position.set(baseX + 0.7, baseY, -0.93);
    plusBtn.userData.isLengthControl = true;
    plusBtn.userData.delta = 5;
    this.uiGroup.add(plusBtn);
  }

  public setSlotPositions(positions: THREE.Vector3[]): void {
    this.slotPositions = positions;
  }

  public setLoomClickable(objects: THREE.Object3D[]): void {
    this.loomClickable = objects;
  }

  public setShuttleButton(button: THREE.Object3D): void {
    this.shuttleButton = button;
  }

  public setScrollGroup(group: THREE.Group): void {
    this.scrollGroup = group;
  }

  public addEventListener(type: InteractionEventType, callback: (event: InteractionEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(callback);
  }

  private emit(event: InteractionEvent): void {
    const callbacks = this.listeners.get(event.type);
    if (callbacks) {
      callbacks.forEach((cb) => cb(event));
    }
  }

  private bindEvents(): void {
    this.container.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.container.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.container.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.container.addEventListener('dblclick', this.onDoubleClick.bind(this));
    this.container.addEventListener('wheel', this.onWheel.bind(this));

    this.container.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    this.container.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.container.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
  }

  private updateMouse(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.updateMouse(event.clientX, event.clientY);
    this.handlePointerDown();
    this.lastMousePosition.set(event.clientX, event.clientY);
  }

  private onMouseMove(event: MouseEvent): void {
    event.preventDefault();
    this.updateMouse(event.clientX, event.clientY);
    this.handlePointerMove();

    if (this.isOrbiting && this.viewMode === 'orbit') {
      const deltaX = event.clientX - this.lastMousePosition.x;
      const deltaY = event.clientY - this.lastMousePosition.y;
      this.orbitAngleY += deltaX * 0.5;
      this.orbitAngleX = Math.max(10, Math.min(80, this.orbitAngleX - deltaY * 0.5));
      this.updateCameraPosition();
      this.lastMousePosition.set(event.clientX, event.clientY);
    }
  }

  private onMouseUp(event: MouseEvent): void {
    event.preventDefault();
    this.updateMouse(event.clientX, event.clientY);
    this.handlePointerUp();
    this.isOrbiting = false;
  }

  private onDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    this.updateMouse(event.clientX, event.clientY);

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.loomClickable, true);

    if (intersects.length > 0 || this.isPointingAtLoom()) {
      this.toggleViewMode();
    }
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.viewMode === 'orbit') {
      this.orbitDistance = Math.max(3, Math.min(10, this.orbitDistance + event.deltaY * 0.01));
      this.updateCameraPosition();
    }
  }

  private onTouchStart(event: TouchEvent): void {
    event.preventDefault();
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.updateMouse(touch.clientX, touch.clientY);
      this.handlePointerDown();
      this.lastMousePosition.set(touch.clientX, touch.clientY);
    }
  }

  private onTouchMove(event: TouchEvent): void {
    event.preventDefault();
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.updateMouse(touch.clientX, touch.clientY);
      this.handlePointerMove();

      if (this.isOrbiting && this.viewMode === 'orbit') {
        const deltaX = touch.clientX - this.lastMousePosition.x;
        const deltaY = touch.clientY - this.lastMousePosition.y;
        this.orbitAngleY += deltaX * 0.5;
        this.orbitAngleX = Math.max(10, Math.min(80, this.orbitAngleX - deltaY * 0.5));
        this.updateCameraPosition();
        this.lastMousePosition.set(touch.clientX, touch.clientY);
      }
    }
  }

  private onTouchEnd(event: TouchEvent): void {
    event.preventDefault();
    this.handlePointerUp();
    this.isOrbiting = false;
  }

  private handlePointerDown(): void {
    if (this.draggingSilk) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const silkIntersects = this.raycaster.intersectObjects(
      this.silkBalls.map((s) => s.mesh),
      true
    );

    if (silkIntersects.length > 0) {
      const silkBall = this.silkBalls.find(
        (s) => s.mesh === silkIntersects[0].object || s.mesh === silkIntersects[0].object.parent
      );
      if (silkBall) {
        this.draggingSilk = silkBall;
        this.isDragging = true;
        this.createDragTrail(silkBall.color);
        return;
      }
    }

    const uiObjects: THREE.Object3D[] = [];
    this.patternLibraryGroup.traverse((obj) => {
      if (obj.userData.isPattern) uiObjects.push(obj);
    });
    if (this.shuttleButton) uiObjects.push(this.shuttleButton);
    if (this.scrollGroup) {
      this.scrollGroup.traverse((obj) => {
        if (obj.userData.isScroll) uiObjects.push(obj);
      });
    }
    this.uiGroup.traverse((obj) => {
      if (obj.userData.isLengthControl) uiObjects.push(obj);
    });

    const uiIntersects = this.raycaster.intersectObjects(uiObjects, true);
    if (uiIntersects.length > 0) {
      this.handleUIClick(uiIntersects[0].object);
      return;
    }

    this.isOrbiting = true;
  }

  private handlePointerMove(): void {
    if (this.draggingSilk && this.isDragging) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const intersectPoint = new THREE.Vector3();
      this.raycaster.setFromCamera(this.mouse, this.camera);
      this.raycaster.ray.intersectPlane(plane, intersectPoint);

      this.draggingSilk.mesh.position.copy(intersectPoint);

      if (this.dragTrail) {
        this.dragTrailPoints.push(intersectPoint.clone());
        if (this.dragTrailPoints.length > 50) {
          this.dragTrailPoints.shift();
        }
        const positions = new Float32Array(this.dragTrailPoints.length * 3);
        this.dragTrailPoints.forEach((p, i) => {
          positions[i * 3] = p.x;
          positions[i * 3 + 1] = p.y;
          positions[i * 3 + 2] = p.z;
        });
        this.dragTrail.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.dragTrail.geometry.computeBoundingSphere();
      }

      const nearestSlot = this.findNearestSlot(intersectPoint);
      if (nearestSlot) {
        const snapPos = this.slotPositions[nearestSlot.slotIndex];
        this.draggingSilk.mesh.position.lerp(snapPos, 0.3);
      }
    }
  }

  private handlePointerUp(): void {
    if (this.draggingSilk && this.isDragging) {
      const nearestSlot = this.findNearestSlot(this.draggingSilk.mesh.position);

      if (nearestSlot) {
        this.emit({
          type: 'silk_drop',
          data: {
            slotIndex: nearestSlot.slotIndex,
            color: this.draggingSilk.color,
          },
        });
        this.createParticleBurst(
          this.slotPositions[nearestSlot.slotIndex],
          this.draggingSilk.color
        );
      }

      this.draggingSilk.mesh.position.copy(this.draggingSilk.originalPosition);
      this.removeDragTrail();
      this.draggingSilk = null;
    }

    this.isDragging = false;
  }

  private handleUIClick(object: THREE.Object3D): void {
    let target: THREE.Object3D | null = object;
    while (target) {
      if (target.userData.isPattern) {
        this.emit({
          type: 'pattern_select',
          data: { patternId: target.userData.patternId },
        });
        return;
      }
      if (target.userData.isShuttleButton) {
        this.emit({ type: 'shuttle_click' });
        return;
      }
      if (target.userData.isScroll) {
        this.emit({ type: 'scroll_click' });
        return;
      }
      if (target.userData.isLengthControl) {
        this.emit({
          type: 'target_length_change',
          data: { delta: target.userData.delta },
        });
        return;
      }
      target = target.parent;
    }
  }

  private createDragTrail(color: string): void {
    this.dragTrailPoints = [];
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.3,
    });
    const geometry = new THREE.BufferGeometry();
    this.dragTrail = new THREE.Line(geometry, material);
    this.scene.add(this.dragTrail);
  }

  private removeDragTrail(): void {
    if (this.dragTrail) {
      this.scene.remove(this.dragTrail);
      this.dragTrail.geometry.dispose();
      (this.dragTrail.material as THREE.Material).dispose();
      this.dragTrail = null;
    }
    this.dragTrailPoints = [];
  }

  private findNearestSlot(position: THREE.Vector3): { slotIndex: number; distance: number } | null {
    let nearest: { slotIndex: number; distance: number } | null = null;
    let minDist = Infinity;

    this.slotPositions.forEach((slot, index) => {
      const dist = position.distanceTo(slot);
      if (dist < minDist && dist < SNAP_DISTANCE) {
        minDist = dist;
        nearest = { slotIndex: index, distance: dist };
      }
    });

    return nearest;
  }

  private createParticleBurst(position: THREE.Vector3, color: string): void {
    const threeColor = new THREE.Color(color);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const geo = new THREE.SphereGeometry(0.02, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: threeColor,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      this.scene.add(mesh);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.1
      );

      this.particles.push({
        id: uuidv4(),
        mesh,
        velocity,
        life: 0.5,
        maxLife: 0.5,
      });
    }
  }

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === 'orbit' ? 'firstPerson' : 'orbit';
    this.emit({
      type: 'loom_double_click',
      data: { viewMode: this.viewMode },
    });
    this.updateCameraPosition();
  }

  private updateCameraPosition(): void {
    if (this.viewMode === 'orbit') {
      const radY = (this.orbitAngleY * Math.PI) / 180;
      const radX = (this.orbitAngleX * Math.PI) / 180;

      this.camera.position.x = Math.sin(radY) * Math.cos(radX) * this.orbitDistance;
      this.camera.position.y = Math.sin(radX) * this.orbitDistance + 1;
      this.camera.position.z = Math.cos(radY) * Math.cos(radX) * this.orbitDistance;
      this.camera.lookAt(0, 1, 0);
    } else {
      this.camera.position.set(0, 1.2, 1.8);
      this.camera.lookAt(0, 1, 0);
    }
  }

  private isPointingAtLoom(): boolean {
    const center = new THREE.Vector2(0, 0);
    this.raycaster.setFromCamera(center, this.camera);
    const direction = this.raycaster.ray.direction;
    return Math.abs(direction.y) < 0.5 && Math.abs(direction.x) < 0.5;
  }

  public getViewMode(): 'orbit' | 'firstPerson' {
    return this.viewMode;
  }

  public setViewMode(mode: 'orbit' | 'firstPerson'): void {
    this.viewMode = mode;
    this.updateCameraPosition();
  }

  public update(deltaTime: number): void {
    const now = performance.now();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= deltaTime;
      p.mesh.position.add(p.velocity.clone().multiplyScalar(deltaTime * 60));
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, p.life / p.maxLife);

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        mat.dispose();
        this.particles.splice(i, 1);
      }
    }

    this.silkBalls.forEach((silk) => {
      const glowIntensity = 0.3 + Math.sin(now * 0.003) * 0.3;
      const mat = silk.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = glowIntensity * 0.2;
    });
  }

  public dispose(): void {
    this.container.removeEventListener('mousedown', this.onMouseDown.bind(this));
    this.container.removeEventListener('mousemove', this.onMouseMove.bind(this));
    this.container.removeEventListener('mouseup', this.onMouseUp.bind(this));
    this.container.removeEventListener('dblclick', this.onDoubleClick.bind(this));
    this.container.removeEventListener('wheel', this.onWheel.bind(this));
    this.container.removeEventListener('touchstart', this.onTouchStart.bind(this));
    this.container.removeEventListener('touchmove', this.onTouchMove.bind(this));
    this.container.removeEventListener('touchend', this.onTouchEnd.bind(this));

    this.removeDragTrail();
    this.particles.forEach((p) => {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    });
  }
}
