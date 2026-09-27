import * as THREE from 'three';

/**
 * CameraRig encapsulates the orbit-camera state machine that used to live
 * inline in main.ts: drag/zoom targets, critically-damped convergence,
 * idle detection and the 30s auto-rotate swing. It performs no DOM or
 * WebGL work, so it can be driven headlessly in tests.
 */
export class CameraRig {
  public angle: number = 0;
  public height: number = 20;
  public distance: number = 40;
  public targetAngle: number = 0;
  public targetHeight: number = 20;
  public targetDistance: number = 40;
  public autoRotatePhase: number = 0;
  public isUserInteracting: boolean = false;
  public isDragging: boolean = false;
  public lastInteractionTime: number = 0;
  public previousMousePosition: { x: number; y: number } = { x: 0, y: 0 };

  public static readonly MIN_HEIGHT = 2;
  public static readonly MAX_HEIGHT = 30;
  public static readonly MIN_DISTANCE = 10;
  public static readonly MAX_DISTANCE = 80;
  public static readonly DAMPING = 0.1;
  public static readonly ZOOM_SMOOTHING_SECONDS = 0.3;
  public static readonly IDLE_TIMEOUT_SECONDS = 5;
  public static readonly AUTO_ROTATE_PERIOD_SECONDS = 30;
  public static readonly AUTO_ROTATE_AMPLITUDE_RAD = (15 * Math.PI) / 180;

  public beginDrag(x: number, y: number, time: number): void {
    this.isDragging = true;
    this.isUserInteracting = true;
    this.lastInteractionTime = time;
    this.previousMousePosition = { x, y };
  }

  public dragTo(x: number, y: number, time: number): void {
    if (!this.isDragging) return;
    const deltaX = x - this.previousMousePosition.x;
    const deltaY = y - this.previousMousePosition.y;
    this.targetAngle -= deltaX * 0.005;
    this.targetHeight = THREE.MathUtils.clamp(
      this.targetHeight + deltaY * 0.1,
      CameraRig.MIN_HEIGHT,
      CameraRig.MAX_HEIGHT
    );
    this.previousMousePosition = { x, y };
    this.lastInteractionTime = time;
  }

  public endDrag(time: number): void {
    this.isDragging = false;
    this.lastInteractionTime = time;
  }

  public zoom(deltaY: number, time: number): void {
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance + deltaY * 0.05,
      CameraRig.MIN_DISTANCE,
      CameraRig.MAX_DISTANCE
    );
    this.isUserInteracting = true;
    this.lastInteractionTime = time;
  }

  /** Advances idle detection, auto-rotate and damped convergence by one frame. */
  public update(delta: number, time: number): void {
    if (time - this.lastInteractionTime > CameraRig.IDLE_TIMEOUT_SECONDS) {
      this.isUserInteracting = false;
    }

    if (!this.isUserInteracting && !this.isDragging) {
      this.autoRotatePhase += delta * ((2 * Math.PI) / CameraRig.AUTO_ROTATE_PERIOD_SECONDS);
      this.targetAngle = Math.sin(this.autoRotatePhase) * CameraRig.AUTO_ROTATE_AMPLITUDE_RAD;
    }

    this.angle += (this.targetAngle - this.angle) * CameraRig.DAMPING;
    this.height += (this.targetHeight - this.height) * CameraRig.DAMPING;

    const zoomSmooth = 1 - Math.pow(0.001, delta / CameraRig.ZOOM_SMOOTHING_SECONDS);
    this.distance += (this.targetDistance - this.distance) * zoomSmooth;
  }

  public applyToCamera(camera: THREE.Camera): void {
    const x = Math.sin(this.angle) * this.distance;
    const z = Math.cos(this.angle) * this.distance;
    camera.position.set(x, this.height, z);
    camera.lookAt(0, 3, 0);
  }

  public reset(): void {
    this.angle = 0;
    this.targetAngle = 0;
    this.height = 20;
    this.targetHeight = 20;
    this.distance = 40;
    this.targetDistance = 40;
    this.autoRotatePhase = 0;
    this.isUserInteracting = false;
    this.isDragging = false;
    this.lastInteractionTime = 0;
    this.previousMousePosition = { x: 0, y: 0 };
  }
}
