import * as THREE from 'three';

export const CAMERA_DEFAULTS = {
  angle: 0,
  height: 20,
  distance: 40,
  minHeight: 2,
  maxHeight: 30,
  minDistance: 10,
  maxDistance: 80,
  damping: 0.1,
  zoomSmoothingSeconds: 0.3,
  autoRotatePeriodSeconds: 30,
  autoRotateAmplitudeRad: (15 * Math.PI) / 180,
  idleTimeoutSeconds: 5,
} as const;

/**
 * Encapsulates camera orbit state: user drag/wheel targets, auto-rotate
 * when idle, and damped convergence of actual values toward targets.
 * Extracted from main.ts so the behaviour can be verified headlessly.
 */
export class CameraController {
  public cameraAngle: number = CAMERA_DEFAULTS.angle;
  public cameraHeight: number = CAMERA_DEFAULTS.height;
  public cameraDistance: number = CAMERA_DEFAULTS.distance;
  public targetCameraAngle: number = CAMERA_DEFAULTS.angle;
  public targetCameraHeight: number = CAMERA_DEFAULTS.height;
  public targetCameraDistance: number = CAMERA_DEFAULTS.distance;
  public autoRotatePhase: number = 0;
  public isUserInteracting: boolean = false;
  public isDragging: boolean = false;
  public lastInteractionTime: number = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.applyToCamera();
  }

  public beginDrag(time: number): void {
    this.isDragging = true;
    this.isUserInteracting = true;
    this.lastInteractionTime = time;
  }

  public endDrag(time: number): void {
    this.isDragging = false;
    this.lastInteractionTime = time;
  }

  public dragBy(deltaX: number, deltaY: number, time: number): void {
    if (!this.isDragging) return;
    this.targetCameraAngle -= deltaX * 0.005;
    this.targetCameraHeight = THREE.MathUtils.clamp(
      this.targetCameraHeight + deltaY * 0.1,
      CAMERA_DEFAULTS.minHeight,
      CAMERA_DEFAULTS.maxHeight
    );
    this.lastInteractionTime = time;
  }

  public zoomBy(deltaY: number, time: number): void {
    this.targetCameraDistance = THREE.MathUtils.clamp(
      this.targetCameraDistance + deltaY * 0.05,
      CAMERA_DEFAULTS.minDistance,
      CAMERA_DEFAULTS.maxDistance
    );
    this.isUserInteracting = true;
    this.lastInteractionTime = time;
  }

  public update(delta: number, time: number): void {
    if (time - this.lastInteractionTime > CAMERA_DEFAULTS.idleTimeoutSeconds) {
      this.isUserInteracting = false;
    }

    if (!this.isUserInteracting && !this.isDragging) {
      this.autoRotatePhase +=
        delta * ((2 * Math.PI) / CAMERA_DEFAULTS.autoRotatePeriodSeconds);
      this.targetCameraAngle =
        Math.sin(this.autoRotatePhase) * CAMERA_DEFAULTS.autoRotateAmplitudeRad;
    }

    const damping = CAMERA_DEFAULTS.damping;
    this.cameraAngle += (this.targetCameraAngle - this.cameraAngle) * damping;
    this.cameraHeight += (this.targetCameraHeight - this.cameraHeight) * damping;

    const zoomSmooth =
      1 - Math.pow(0.001, delta / CAMERA_DEFAULTS.zoomSmoothingSeconds);
    this.cameraDistance +=
      (this.targetCameraDistance - this.cameraDistance) * zoomSmooth;

    this.applyToCamera();
  }

  public reset(): void {
    this.cameraAngle = CAMERA_DEFAULTS.angle;
    this.targetCameraAngle = CAMERA_DEFAULTS.angle;
    this.cameraHeight = CAMERA_DEFAULTS.height;
    this.targetCameraHeight = CAMERA_DEFAULTS.height;
    this.cameraDistance = CAMERA_DEFAULTS.distance;
    this.targetCameraDistance = CAMERA_DEFAULTS.distance;
    this.autoRotatePhase = 0;
    this.applyToCamera();
  }

  private applyToCamera(): void {
    const x = Math.sin(this.cameraAngle) * this.cameraDistance;
    const z = Math.cos(this.cameraAngle) * this.cameraDistance;
    this.camera.position.set(x, this.cameraHeight, z);
    this.camera.lookAt(0, 3, 0);
  }
}
