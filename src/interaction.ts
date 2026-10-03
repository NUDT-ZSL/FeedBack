import * as THREE from 'three';
import type { TerrainData } from './terrain';
import { getHeightAt } from './terrain';
import { RoamSampler } from './route';

export interface InteractionHandlers {
  onTerrainClick?: (point: THREE.Vector3, event: MouseEvent) => void;
  onPathPointClick?: (index: number, point: THREE.Vector3, event: MouseEvent) => void;
  onMouseMove?: (point: THREE.Vector3 | null) => void;
  onModeChange?: (mode: 'roam' | 'edit') => void;
}

export class InteractionManager {
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private terrainMesh: THREE.Mesh;
  private terrainData: TerrainData;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private handlers: InteractionHandlers;
  private pathPointMeshes: THREE.Mesh[] = [];

  private isDragging: boolean = false;
  private previousMousePosition: { x: number; y: number } = { x: 0, y: 0 };
  private spherical: { radius: number; theta: number; phi: number };
  private target: THREE.Vector3;
  private minDistance: number = 100;
  private maxDistance: number = 1500;
  private minPolarAngle: number = Math.PI * 0.1;
  private maxPolarAngle: number = Math.PI * 0.48;

  private isRoaming: boolean = false;
  private roamSampler: RoamSampler = new RoamSampler();
  private roamDirection: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  private roamLookTarget: THREE.Vector3 = new THREE.Vector3(0, 250, 0);

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    terrainMesh: THREE.Mesh,
    terrainData: TerrainData,
    handlers: InteractionHandlers = {}
  ) {
    this.camera = camera;
    this.renderer = renderer;
    this.terrainMesh = terrainMesh;
    this.terrainData = terrainData;
    this.handlers = handlers;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.target = new THREE.Vector3(0, 250, 0);
    const cameraOffset = new THREE.Vector3(400, 400, 400);
    this.camera.position.copy(this.target).add(cameraOffset);
    this.camera.lookAt(this.target);

    const diff = new THREE.Vector3().subVectors(this.camera.position, this.target);
    this.spherical = {
      radius: diff.length(),
      theta: Math.atan2(diff.x, diff.z),
      phi: Math.acos(Math.max(-1, Math.min(1, diff.y / diff.length())))
    };

    this.bindEvents();
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('click', this.onClick);
  }

  public dispose(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mouseup', this.onMouseUp);
    canvas.removeEventListener('mouseleave', this.onMouseUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('click', this.onClick);
  }

  public setPathPointMeshes(meshes: THREE.Mesh[]): void {
    this.pathPointMeshes = meshes;
  }

  public setMode(mode: 'roam' | 'edit', path?: THREE.Vector3[]): void {
    if (mode === 'roam') {
      this.isRoaming = true;
      if (path) this.roamSampler.setPath(path);
    } else {
      if (this.isRoaming) {
        this.target.copy(this.roamLookTarget);
        const diff = new THREE.Vector3().subVectors(this.camera.position, this.target);
        this.spherical = {
          radius: Math.max(this.minDistance, Math.min(this.maxDistance, diff.length())),
          theta: Math.atan2(diff.x, diff.z),
          phi: Math.acos(Math.max(-1, Math.min(1, diff.y / (diff.length() || 1))))
        };
        this.updateCameraPosition();
      }
      this.isRoaming = false;
    }
  }

  public setRoamPath(path: THREE.Vector3[]): void {
    this.roamSampler.setPath(path);
  }

  public setRoamSpeed(speed: number): void {
    this.roamSampler.setSpeed(speed);
  }

  public getRoamSpeed(): number {
    return this.roamSampler.getSpeed();
  }

  public isRoamMode(): boolean {
    return this.isRoaming;
  }

  private updateMouseNDC(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private intersectTerrain(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.terrainMesh);
    if (intersects.length > 0) {
      return intersects[0].point.clone();
    }
    return null;
  }

  private intersectPathPoints(): number {
    if (this.pathPointMeshes.length === 0) return -1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.pathPointMeshes);
    if (intersects.length > 0) {
      return this.pathPointMeshes.indexOf(intersects[0].object as THREE.Mesh);
    }
    return -1;
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (this.isRoaming) return;
    if (event.button !== 0) return;
    this.isDragging = true;
    this.previousMousePosition = { x: event.clientX, y: event.clientY };
  };

  private onMouseMove = (event: MouseEvent): void => {
    this.updateMouseNDC(event);

    if (this.isDragging && !this.isRoaming) {
      const deltaX = event.clientX - this.previousMousePosition.x;
      const deltaY = event.clientY - this.previousMousePosition.y;

      this.spherical.theta -= deltaX * 0.005;
      this.spherical.phi = Math.max(
        this.minPolarAngle,
        Math.min(this.maxPolarAngle, this.spherical.phi + deltaY * 0.005)
      );

      this.updateCameraPosition();
      this.previousMousePosition = { x: event.clientX, y: event.clientY };
    }

    if (this.handlers.onMouseMove) {
      const terrainPoint = this.intersectTerrain();
      this.handlers.onMouseMove(terrainPoint);
    }
  };

  private onMouseUp = (): void => {
    this.isDragging = false;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.isRoaming) return;
    const zoomSpeed = 0.001;
    this.spherical.radius = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.spherical.radius + event.deltaY * zoomSpeed * this.spherical.radius)
    );
    this.updateCameraPosition();
  };

  private onClick = (event: MouseEvent): void => {
    if (this.isRoaming) return;
    this.updateMouseNDC(event);

    const pathPointIndex = this.intersectPathPoints();
    if (pathPointIndex >= 0) {
      const point = this.pathPointMeshes[pathPointIndex].position.clone();
      if (this.handlers.onPathPointClick) {
        this.handlers.onPathPointClick(pathPointIndex, point, event);
      }
      return;
    }

    const terrainPoint = this.intersectTerrain();
    if (terrainPoint && this.handlers.onTerrainClick) {
      terrainPoint.y = getHeightAt(terrainPoint.x, terrainPoint.z, this.terrainData);
      this.handlers.onTerrainClick(terrainPoint, event);
    }
  };

  private updateCameraPosition(): void {
    const { radius, theta, phi } = this.spherical;
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this.target);
  }

  public update(deltaTime: number): void {
    if (!this.isRoaming) return;
    this.updateRoamCamera(deltaTime);
  }

  private updateRoamCamera(deltaTime: number): void {
    const frame = this.roamSampler.advance(deltaTime);
    if (!frame.hasPath) return;

    if (!frame.moving) {
      const anchor = frame.position;
      this.camera.position.set(anchor.x + 30, anchor.y + 45, anchor.z + 30);
      this.roamLookTarget.copy(anchor);
      this.camera.lookAt(this.roamLookTarget);
      return;
    }

    const blend = 1 - Math.exp(-deltaTime * 3);
    if (this.roamDirection.dot(frame.direction) < -0.999) {
      const side = new THREE.Vector3(-this.roamDirection.z, 0, this.roamDirection.x);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      this.roamDirection.add(side.normalize().multiplyScalar(0.02)).normalize();
    }
    this.roamDirection.lerp(frame.direction, blend);
    if (this.roamDirection.lengthSq() < 1e-8) {
      this.roamDirection.copy(frame.direction);
    } else {
      this.roamDirection.normalize();
    }

    this.camera.position.set(
      frame.position.x - this.roamDirection.x * 12,
      frame.position.y + 40,
      frame.position.z - this.roamDirection.z * 12
    );
    this.roamLookTarget.set(
      frame.position.x + this.roamDirection.x * 25,
      frame.position.y + 10,
      frame.position.z + this.roamDirection.z * 25
    );
    this.camera.lookAt(this.roamLookTarget);
  }
}
