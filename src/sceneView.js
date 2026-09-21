import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

const PICKED_SURFACE_OFFSET = 1e-6;

export class SceneView {
  constructor({ canvas, viewport, onPickSurface, onSelectPart, onTransformPart }) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.onPickSurface = onPickSurface;
    this.onSelectPart = onSelectPart;
    this.onTransformPart = onTransformPart;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e14);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.camera.position.set(5.2, 4.1, 6.2);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.target.set(0, 0.5, 0);
    this.transform = new TransformControls(this.camera, canvas);
    this.transform.setSize(0.75);
    this.transform.addEventListener("dragging-changed", (event) => {
      this.orbit.enabled = !event.value;
    });
    this.transform.addEventListener("objectChange", () => {
      if (this.transform.object) this.emitPartTransform();
    });
    this.scene.add(this.transform.getHelper ? this.transform.getHelper() : this.transform);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.partMeshes = new Map();
    this.partRoots = new Map();
    this.pickMeshes = [];
    this.annotateMode = true;
    this.selectedPartId = null;
    this.dragSuppressed = false;

    this.setupLights();
    this.setupGrid();
    this.bindPointer();
    this.resize();
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xc9ddff, 0x18202c, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb2ff, 0.8);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim);
  }

  setupGrid() {
    const grid = new THREE.GridHelper(18, 18, 0x335d88, 0x203044);
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(1.4));
  }

  bindPointer() {
    const down = new THREE.Vector2();
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      down.set(event.clientX, event.clientY);
      this.dragSuppressed = false;
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.buttons !== 1) return;
      if (down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) this.dragSuppressed = true;
    });
    this.canvas.addEventListener("pointerup", (event) => this.handlePointerUp(event));
  }

  handlePointerUp(event) {
    if (event.button !== 0 || this.dragSuppressed || this.transform.dragging) return;
    const hit = this.pick(event);
    if (!hit) return this.onSelectPart(null);
    const partId = hit.object.userData.partId;
    if (this.annotateMode) {
      const root = this.partRoots.get(partId);
      const localAnchor = root.worldToLocal(hit.point.clone());
      const scale = Math.max(...root.scale.toArray(), 0.0001);
      const localNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(root.matrixWorld.clone().invert());
      localAnchor.addScaledVector(localNormal.normalize(), PICKED_SURFACE_OFFSET / scale);
      this.onPickSurface(partId, localAnchor.toArray(), hit.face.normal.clone());
    } else {
      this.onSelectPart(partId);
    }
  }

  setAnnotateMode(enabled) {
    this.annotateMode = enabled;
    this.canvas.style.cursor = enabled ? "crosshair" : "default";
    if (enabled) this.detachTransform();
  }

  setParts(parts) {
    for (const [, root] of this.partRoots) this.scene.remove(root);
    this.partMeshes.clear();
    this.partRoots.clear();
    this.pickMeshes = [];

    for (const part of parts) {
      const root = new THREE.Group();
      root.name = part.name;
      root.userData.partId = part.id;
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color),
        roughness: 0.58,
        metalness: 0.12,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.partId = part.id;
      root.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xdcecff, transparent: true, opacity: 0.42 }),
      );
      mesh.add(edges);
      this.scene.add(root);
      this.partRoots.set(part.id, root);
      this.partMeshes.set(part.id, mesh);
      this.pickMeshes.push(mesh);
    }

    for (const part of parts) {
      const root = this.partRoots.get(part.id);
      const parentRoot = part.parentId ? this.partRoots.get(part.parentId) : null;
      if (parentRoot) parentRoot.add(root);
    }
    this.syncTransforms(parts);
  }

  syncTransforms(parts) {
    for (const part of parts) {
      const root = this.partRoots.get(part.id);
      if (!root) continue;
      root.position.set(...part.position);
      root.rotation.set(
        THREE.MathUtils.degToRad(part.rotationDeg[0]),
        THREE.MathUtils.degToRad(part.rotationDeg[1]),
        THREE.MathUtils.degToRad(part.rotationDeg[2]),
      );
      root.scale.set(...part.size);
      const mesh = this.partMeshes.get(part.id);
      mesh.material.color.set(part.color);
      root.name = part.name;
    }
    if (this.selectedPartId && !this.partRoots.has(this.selectedPartId)) this.detachTransform();
  }

  selectPart(partId, mode = "translate") {
    this.selectedPartId = partId;
    const root = partId ? this.partRoots.get(partId) : null;
    if (root) {
      this.transform.attach(root);
      this.transform.setMode(mode);
    } else {
      this.detachTransform();
    }
    for (const [id, mesh] of this.partMeshes) {
      mesh.material.emissive.set(id === partId ? 0x24446c : 0x000000);
    }
  }

  setTransformMode(mode) {
    if (this.transform.object) this.transform.setMode(mode);
  }

  detachTransform() {
    this.selectedPartId = null;
    this.transform.detach();
  }

  emitPartTransform() {
    const root = this.transform.object;
    if (!root) return;
    this.onTransformPart(root.userData.partId, {
      position: root.position.toArray(),
      rotationDeg: [root.rotation.x, root.rotation.y, root.rotation.z].map(THREE.MathUtils.radToDeg),
      size: root.scale.toArray(),
    });
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    return hits[0] ?? null;
  }

  isAnchorOccluded(worldPoint, partId) {
    const cameraPosition = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);
    const direction = worldPoint.clone().sub(cameraPosition);
    const anchorDistance = direction.length();
    direction.normalize();
    this.raycaster.set(cameraPosition, direction);
    this.raycaster.near = 0;
    this.raycaster.far = Math.max(0, anchorDistance - 0.02);
    const blockers = this.raycaster.intersectObjects(this.pickMeshes, false);
    this.raycaster.far = Infinity;
    return blockers.some((hit) => hit.object.userData.partId !== partId);
  }

  resetCamera() {
    this.camera.position.set(5.2, 4.1, 6.2);
    this.orbit.target.set(0, 0.5, 0);
    this.orbit.update();
  }

  resize() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    return { width, height };
  }

  update() {
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
    return { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
  }
}
