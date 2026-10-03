import * as THREE from 'three';

export class CameraController {
  public static readonly MIN_HEIGHT = 2;
  public static readonly MAX_HEIGHT = 30;
  public static readonly MIN_DISTANCE = 10;
  public static readonly MAX_DISTANCE = 80;
  public static readonly AUTO_ROTATE_AMPLITUDE = (15 * Math.PI) / 180;
  public static readonly AUTO_ROTATE_PERIOD = 30;
  public static readonly INTERACTION_TIMEOUT = 5;

  public cameraAngle: number = 0;
  public cameraHeight: number = 20;
  public cameraDistance: number = 40;
  public targetCameraAngle: number = 0;
  public targetCameraHeight: number = 20;
  public targetCameraDistance: number = 40;
  public autoRotatePhase: number = 0;
  public isUserInteracting: boolean = false;
  public isDragging: boolean = false;
  public lastInteractionTime: number = 0;

  private currentTime: number = 0;
  private previousPointerPosition: { x: number; y: number } = { x: 0, y: 0 };

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.applyToCamera();
  }

  public attach(canvas: HTMLElement): void {
    canvas.addEventListener('mousedown', (e) => {
      this.beginDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      this.endDrag();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.drag(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY);
    }, { passive: false });

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.beginDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    });

    canvas.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) {
        this.drag(e.touches[0].clientX, e.touches[0].clientY);
      }
    });

    canvas.addEventListener('touchend', () => {
      this.endDrag();
    });
  }

  public beginDrag(x: number, y: number): void {
    this.isDragging = true;
    this.isUserInteracting = true;
    this.lastInteractionTime = this.currentTime;
    this.previousPointerPosition = { x, y };
  }

  public drag(x: number, y: number): void {
    const deltaX = x - this.previousPointerPosition.x;
    const deltaY = y - this.previousPointerPosition.y;
    this.targetCameraAngle -= deltaX * 0.005;
    this.targetCameraHeight = THREE.MathUtils.clamp(
      this.targetCameraHeight + deltaY * 0.1,
      CameraController.MIN_HEIGHT,
      CameraController.MAX_HEIGHT
    );
    this.previousPointerPosition = { x, y };
    this.lastInteractionTime = this.currentTime;
  }

  public endDrag(): void {
    this.isDragging = false;
    this.lastInteractionTime = this.currentTime;
  }

  public zoom(deltaY: number): void {
    this.targetCameraDistance = THREE.MathUtils.clamp(
      this.targetCameraDistance + deltaY * 0.05,
      CameraController.MIN_DISTANCE,
      CameraController.MAX_DISTANCE
    );
    this.isUserInteracting = true;
    this.lastInteractionTime = this.currentTime;
  }

  public update(delta: number, time: number): void {
    this.currentTime = time;

    if (time - this.lastInteractionTime > CameraController.INTERACTION_TIMEOUT) {
      this.isUserInteracting = false;
    }

    if (!this.isUserInteracting && !this.isDragging) {
      this.autoRotatePhase += (delta * 2 * Math.PI) / CameraController.AUTO_ROTATE_PERIOD;
      this.targetCameraAngle =
        Math.sin(this.autoRotatePhase) * CameraController.AUTO_ROTATE_AMPLITUDE;
    }

    const damping = 0.1;
    this.cameraAngle += (this.targetCameraAngle - this.cameraAngle) * damping;
    this.cameraHeight += (this.targetCameraHeight - this.cameraHeight) * damping;

    const zoomSmooth = 1 - Math.pow(0.001, delta / 0.3);
    this.cameraDistance +=
      (this.targetCameraDistance - this.cameraDistance) * zoomSmooth;

    this.applyToCamera();
  }

  public reset(): void {
    this.cameraAngle = 0;
    this.targetCameraAngle = 0;
    this.cameraHeight = 20;
    this.targetCameraHeight = 20;
    this.cameraDistance = 40;
    this.targetCameraDistance = 40;
    this.autoRotatePhase = 0;
    this.isUserInteracting = false;
    this.isDragging = false;
    this.lastInteractionTime = 0;
    this.applyToCamera();
  }

  private applyToCamera(): void {
    const x = Math.sin(this.cameraAngle) * this.cameraDistance;
    const z = Math.cos(this.cameraAngle) * this.cameraDistance;
    this.camera.position.set(x, this.cameraHeight, z);
    this.camera.lookAt(0, 3, 0);
  }
}
