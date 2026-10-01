import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CrystalStructure, CrystalAtom } from './crystal';

export interface CrystalSceneCallbacks {
  onAtomClick?: (
    atomId: string,
    screenPos: { x: number; y: number },
    info: { name: string; position: [number, number, number] }
  ) => void;
  onBackgroundClick?: () => void;
}

interface ActiveAnimation {
  startTime: number;
  duration: number;
  easing: (t: number) => number;
  onUpdate: (progress: number) => void;
  onComplete?: () => void;
}

type AnimationName =
  | 'crystalFadeOut'
  | 'crystalFadeIn'
  | 'latticeScale'
  | 'atomRadius'
  | 'explode';

const ROTATION_SPEED = (15 * Math.PI) / 180;
const PULSE_PERIOD = 1.5;

const Easing = {
  linear: (t: number) => t,
  easeOut: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
};

export class CrystalScene {
  private container: HTMLElement;
  private callbacks: CrystalSceneCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock: THREE.Clock;

  private crystalGroup: THREE.Group;
  private atomGroup: THREE.Group;
  private bondGroup: THREE.Group;

  private axesHelper: THREE.AxesHelper | null = null;
  private gridHelper: THREE.GridHelper | null = null;

  private atomMeshes: Map<string, { mesh: THREE.Mesh; glow: THREE.Mesh; data: CrystalAtom }>;
  private bondMeshes: THREE.Mesh[];

  private atomRadiusScale: number = 0.5;
  private latticeConstant: number = 2.5;
  private isExploded: boolean = false;
  private autoRotate: boolean = true;
  private userInteracting: boolean = false;

  private animations: Map<AnimationName, ActiveAnimation>;

  private selectedAtomId: string | null = null;
  private pulseTime: number = 0;

  private raycaster: THREE.Raycaster;
  private pointer: THREE.Vector2;

  private basePositions: Map<string, THREE.Vector3>;
  private originalBondOpacity: number = 0.4;
  private originalBondRadius: number = 0.02;

  private frameId: number = 0;
  private disposed: boolean = false;

  constructor(container: HTMLElement, callbacks: CrystalSceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.atomMeshes = new Map();
    this.bondMeshes = [];
    this.animations = new Map();
    this.basePositions = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();

    this.crystalGroup = new THREE.Group();
    this.atomGroup = new THREE.Group();
    this.bondGroup = new THREE.Group();
    this.crystalGroup.add(this.bondGroup);
    this.crystalGroup.add(this.atomGroup);

    this.renderer = this.createRenderer();
    this.scene = this.createScene();
    this.camera = this.createCamera();
    this.controls = this.createControls();

    this.setupLights();
    this.setupHelpers();
    this.bindEvents();

    this.scene.add(this.crystalGroup);
    this.container.appendChild(this.renderer.domElement);

    this.handleResize();
    this.animate();
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    return renderer;
  }

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();
    return scene;
  }

  private createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(4, 3.5, 4);
    return camera;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;
    return controls;
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    const keyLight = new THREE.PointLight(0xffffff, 1.2, 50);
    keyLight.position.set(5, 6, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x88ccff, 0.6, 50);
    fillLight.position.set(-4, 3, -3);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x00bcd4, 0.4, 50);
    rimLight.position.set(0, -3, 5);
    this.scene.add(rimLight);
  }

  private setupHelpers(): void {
    this.axesHelper = new THREE.AxesHelper(1.5);
    (this.axesHelper.material as THREE.Material).transparent = true;
    (this.axesHelper.material as THREE.Material).opacity = 0.7;
    this.axesHelper.visible = false;
    this.crystalGroup.add(this.axesHelper);

    this.gridHelper = new THREE.GridHelper(4, 4, 0x555555, 0x333333);
    const gridMat = this.gridHelper.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.35;
    this.gridHelper.visible = false;
    this.crystalGroup.add(this.gridHelper);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);

    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.userInteracting = true;
    });
    this.renderer.domElement.addEventListener('pointerup', () => {
      setTimeout(() => {
        this.userInteracting = false;
      }, 300);
    });

    this.renderer.domElement.addEventListener('click', this.handleClick);
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleClick = (event: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const atomMeshList = Array.from(this.atomMeshes.values()).map(v => v.mesh);
    const intersects = this.raycaster.intersectObjects(atomMeshList, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      const atomData = Array.from(this.atomMeshes.values()).find(
        v => v.mesh === hit
      );
      if (atomData) {
        this.selectAtom(atomData.data.id);
        const screenPos = this.worldToScreen(hit.position);
        this.callbacks.onAtomClick?.(atomData.data.id, screenPos, {
          name: atomData.data.element,
          position: [
            parseFloat(atomData.data.position[0].toFixed(3)),
            parseFloat(atomData.data.position[1].toFixed(3)),
            parseFloat(atomData.data.position[2].toFixed(3))
          ]
        });
      }
    } else {
      this.clearAtomSelection();
      this.callbacks.onBackgroundClick?.();
    }
  };

  private worldToScreen(pos: THREE.Vector3): { x: number; y: number } {
    const vec = pos.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: (vec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-vec.y * 0.5 + 0.5) * rect.height + rect.top
    };
  }

  private selectAtom(atomId: string): void {
    this.selectedAtomId = atomId;
    this.atomMeshes.forEach((val, id) => {
      val.glow.visible = id === atomId;
    });
  }

  clearAtomSelection(): void {
    this.selectedAtomId = null;
    this.atomMeshes.forEach(val => {
      val.glow.visible = false;
    });
  }

  private clearCrystal(): void {
    while (this.atomGroup.children.length > 0) {
      const child = this.atomGroup.children[0];
      this.atomGroup.remove(child);
    }
    while (this.bondGroup.children.length > 0) {
      const child = this.bondGroup.children[0];
      this.bondGroup.remove(child);
    }
    this.atomMeshes.clear();
    this.bondMeshes = [];
    this.basePositions.clear();
  }

  loadCrystal(structure: CrystalStructure): void {
    const fadeOut = this.animations.get('crystalFadeIn');
    if (fadeOut) {
      this.animations.delete('crystalFadeIn');
    }

    const startOpacity = this.getCrystalOpacity();
    const startScale = this.crystalGroup.scale.x;

    this.animations.set('crystalFadeOut', {
      startTime: performance.now(),
      duration: 500,
      easing: Easing.linear,
      onUpdate: (t) => {
        const opacity = startOpacity * (1 - t);
        this.setCrystalOpacity(opacity);
        this.crystalGroup.scale.setScalar(startScale * (1 - t * 0.15));
      },
      onComplete: () => {
        this.clearCrystal();
        this.buildCrystal(structure);
        this.isExploded = false;
        this.setCrystalOpacity(0);
        this.crystalGroup.scale.setScalar(0.5);

        this.animations.set('crystalFadeIn', {
          startTime: performance.now(),
          duration: 600,
          easing: Easing.easeOut,
          onUpdate: (t) => {
            this.setCrystalOpacity(t);
            this.crystalGroup.scale.setScalar(0.5 + t * 0.5);
          }
        });
      }
    });
  }

  private buildCrystal(structure: CrystalStructure): void {
    this.atomRadiusScale = 0.5;
    this.latticeConstant = structure.latticeConstant;
    this.crystalGroup.scale.setScalar(this.latticeConstant / 2.5);

    const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);
    const glowGeometry = new THREE.SphereGeometry(1.35, 32, 32);

    const elementMaterials: Record<string, THREE.MeshStandardMaterial> = {};
    for (const [elemId, elem] of Object.entries(structure.elements)) {
      elementMaterials[elemId] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(elem.color),
        metalness: 0.7,
        roughness: 0.25,
        transparent: true,
        opacity: 1
      });
    }

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bcd4,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false
    });

    structure.atoms.forEach(atom => {
      const elem = structure.elements[atom.element];
      if (!elem) return;

      const mesh = new THREE.Mesh(sphereGeometry, elementMaterials[atom.element].clone());
      const baseRadius = elem.radius * this.atomRadiusScale * 0.3;
      mesh.scale.setScalar(baseRadius);

      const pos = new THREE.Vector3(
        (atom.position[0] - 0.25) * 2,
        (atom.position[1] - 0.25) * 2,
        (atom.position[2] - 0.25) * 2
      );
      mesh.position.copy(pos);
      mesh.userData.atomId = atom.id;

      const glow = new THREE.Mesh(glowGeometry, glowMaterial.clone());
      glow.scale.copy(mesh.scale);
      glow.position.copy(mesh.position);
      glow.visible = false;

      this.atomGroup.add(mesh);
      this.atomGroup.add(glow);
      this.atomMeshes.set(atom.id, { mesh, glow, data: atom });
      this.basePositions.set(atom.id, pos.clone());
    });

    const bondMaterial = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: this.originalBondOpacity,
      metalness: 0.3,
      roughness: 0.6,
      depthWrite: false
    });

    const atomById = new Map(structure.atoms.map(a => [a.id, a]));
    structure.bonds.forEach(bond => {
      const a = atomById.get(bond.atomA);
      const b = atomById.get(bond.atomB);
      if (!a || !b) return;

      const mesh = this.createBondMesh(
        new THREE.Vector3(
          (a.position[0] - 0.25) * 2,
          (a.position[1] - 0.25) * 2,
          (a.position[2] - 0.25) * 2
        ),
        new THREE.Vector3(
          (b.position[0] - 0.25) * 2,
          (b.position[1] - 0.25) * 2,
          (b.position[2] - 0.25) * 2
        ),
        this.originalBondRadius,
        bondMaterial
      );
      mesh.userData = { bondA: bond.atomA, bondB: bond.atomB };
      this.bondGroup.add(mesh);
      this.bondMeshes.push(mesh);
    });
  }

  private createBondMesh(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    material: THREE.Material
  ): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
    const mesh = new THREE.Mesh(geometry, material);

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(mid);

    const up = new THREE.Vector3(0, 1, 0);
    const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
    const angle = Math.acos(up.dot(dir.clone().normalize()));
    if (axis.lengthSq() > 0.0001) {
      mesh.quaternion.setFromAxisAngle(axis, angle);
    }
    return mesh;
  }

  private getCrystalOpacity(): number {
    let total = 0;
    let count = 0;
    this.atomMeshes.forEach(v => {
      const mat = v.mesh.material as THREE.MeshStandardMaterial;
      if (mat) {
        total += mat.opacity;
        count++;
      }
    });
    this.bondMeshes.forEach(m => {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat) {
        total += mat.opacity;
        count++;
      }
    });
    return count > 0 ? total / count : 1;
  }

  private setCrystalOpacity(opacity: number): void {
    this.atomMeshes.forEach(v => {
      const mat = v.mesh.material as THREE.MeshStandardMaterial;
      if (mat) mat.opacity = opacity;
    });
    this.bondMeshes.forEach(m => {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat) mat.opacity = opacity * this.originalBondOpacity;
    });
  }

  setLatticeConstant(value: number, animate: boolean = true): void {
    const targetScale = value / 2.5;
    const startScale = this.crystalGroup.scale.x;
    this.latticeConstant = value;

    if (!animate) {
      this.crystalGroup.scale.setScalar(targetScale);
      return;
    }

    this.animations.set('latticeScale', {
      startTime: performance.now(),
      duration: 300,
      easing: Easing.easeOut,
      onUpdate: (t) => {
        const s = startScale + (targetScale - startScale) * t;
        this.crystalGroup.scale.setScalar(s);
      }
    });
  }

  setAtomRadiusScale(value: number, animate: boolean = true): void {
    const startScale = this.atomRadiusScale;
    const targetScale = value;

    if (!animate) {
      this.atomRadiusScale = value;
      this.applyAtomRadiusScale(value);
      return;
    }

    this.animations.set('atomRadius', {
      startTime: performance.now(),
      duration: 300,
      easing: Easing.easeOut,
      onUpdate: (t) => {
        const s = startScale + (targetScale - startScale) * t;
        this.atomRadiusScale = s;
        this.applyAtomRadiusScale(s);
      }
    });
  }

  private applyAtomRadiusScale(scale: number): void {
    this.atomMeshes.forEach((val, id) => {
      const elem = val.data.element;
      const data = val.data;
      const defaultRadius = (data.position.length > 0 ? 0.5 : 0.5);
      const baseRadius = defaultRadius * scale * 0.3;
      val.mesh.scale.setScalar(baseRadius);
      val.glow.scale.setScalar(baseRadius * 1.35);
    });
  }

  setAxesVisible(visible: boolean): void {
    if (this.axesHelper) {
      this.axesHelper.visible = visible;
    }
  }

  setGridVisible(visible: boolean): void {
    if (this.gridHelper) {
      this.gridHelper.visible = visible;
    }
  }

  toggleExplodedView(): void {
    const target = this.isExploded ? 0 : 1;
    const start = this.isExploded ? 1 : 0;

    this.animations.set('explode', {
      startTime: performance.now(),
      duration: 800,
      easing: Easing.easeInOut,
      onUpdate: (t) => {
        const factor = start + (target - start) * t;
        this.applyExplosion(factor);
      },
      onComplete: () => {
        this.isExploded = !this.isExploded;
      }
    });
  }

  private applyExplosion(factor: number): void {
    this.atomMeshes.forEach((val, id) => {
      const base = this.basePositions.get(id);
      if (!base) return;
      const dir = base.clone().normalize();
      if (dir.lengthSq() < 0.0001) {
        val.mesh.position.copy(base);
        val.glow.position.copy(base);
      } else {
        const offset = dir.multiplyScalar(factor * base.length() * 1.0);
        val.mesh.position.copy(base.clone().add(offset));
        val.glow.position.copy(val.mesh.position);
      }
    });

    this.bondMeshes.forEach(mesh => {
      const { bondA, bondB } = mesh.userData;
      const posA = this.atomMeshes.get(bondA)?.mesh.position;
      const posB = this.atomMeshes.get(bondB)?.mesh.position;
      if (!posA || !posB) return;

      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = this.originalBondOpacity * (1 - factor * 0.5);

      const dir = new THREE.Vector3().subVectors(posB, posA);
      const len = dir.length();
      mesh.scale.set(1, len / mesh.geometry.parameters.height, 1);
      mesh.scale.x = 1 - factor * 0.3;
      mesh.scale.z = 1 - factor * 0.3;

      const mid = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
      mesh.position.copy(mid);

      const up = new THREE.Vector3(0, 1, 0);
      const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(dir.clone().normalize()))));
      if (axis.lengthSq() > 0.0001) {
        mesh.quaternion.setFromAxisAngle(axis, angle);
      }
    });
  }

  private updatePulse(delta: number): void {
    this.pulseTime += delta;
    if (!this.selectedAtomId) return;

    const t = (this.pulseTime % PULSE_PERIOD) / PULSE_PERIOD;
    const pulse = (Math.sin(t * Math.PI * 2) + 1) * 0.5;

    const selected = this.atomMeshes.get(this.selectedAtomId);
    if (selected) {
      const glowMat = selected.glow.material as THREE.MeshBasicMaterial;
      glowMat.opacity = 0.15 + pulse * 0.45;
      const baseScale = selected.mesh.scale.x;
      selected.glow.scale.setScalar(baseScale * (1.25 + pulse * 0.25));
    }
  }

  private updateAnimations(now: number): void {
    const toRemove: AnimationName[] = [];

    this.animations.forEach((anim, name) => {
      const elapsed = now - anim.startTime;
      if (elapsed >= anim.duration) {
        anim.onUpdate(1);
        anim.onComplete?.();
        toRemove.push(name);
      } else {
        const t = anim.easing(elapsed / anim.duration);
        anim.onUpdate(t);
      }
    });

    toRemove.forEach(name => this.animations.delete(name));
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    const now = performance.now();

    if (this.autoRotate && !this.userInteracting) {
      this.crystalGroup.rotation.y += ROTATION_SPEED * delta;
    }

    this.updateAnimations(now);
    this.updatePulse(delta);
    this.controls.update();

    if (this.selectedAtomId) {
      const selected = this.atomMeshes.get(this.selectedAtomId);
      if (selected) {
        const worldPos = new THREE.Vector3();
        selected.mesh.getWorldPosition(worldPos);
        const screen = this.worldToScreen(worldPos);
        this.callbacks.onAtomClick?.(this.selectedAtomId, screen, {
          name: selected.data.element,
          position: [
            parseFloat(selected.data.position[0].toFixed(3)),
            parseFloat(selected.data.position[1].toFixed(3)),
            parseFloat(selected.data.position[2].toFixed(3))
          ]
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('click', this.handleClick);

    this.clearCrystal();

    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });

    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
