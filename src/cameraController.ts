import * as THREE from 'three';

export const CAMERA_DEFAULTS = {
  angle: 0,
  height: 20,
  distance: 40,
  minHeight: 2,
  maxHeight: 30,
  minDistance: 10,
  maxDistance: 80,
  dragAngleFactor: 0.005,
  dragHeightFactor: 0.1,
  zoomFactor: 0.05,
  damping: 0.1,
  zoomSmoothHalfLife: 0.3,
  autoRotatePeriod: 30,
  autoRotateAmplitude: (15 * Math.PI) / 180,
  interactionResumeDelay: 5,
  lookAt: new THREE.Vector3(0, 3, 0),
} as const;

export class CameraController {
  public cameraAngle: number = CAMERA_DEFAULTS.angle;
  public cameraHeight: number = CAMERA_DEFAULTS.height;
  public cameraDistance: number = CAMERA_DEFAULTS.distance;
  public targetCameraAngle: number = CAMERA_DEFAULTS.angle;
  public targetCameraHeight: number = CAMERA_DEFAULTS.height;
  public targetCameraDistance: number = CAMERA_DEFAULTS.distance;
  public autoRotatePhase: number = 0;
  public isDragging: boolean = false;
  public isUserInteracting: boolean = false;
  public lastInteractionTime: number = 0;

  public beginDrag(time: number): void {
    this.isDragging = true;
    this.isUserInteracting = true;
    this.lastInteractionTime = time;
  }

  public applyDrag(deltaX: number, deltaY: number, time: number): void {
    this.targetCameraAngle -= deltaX * CAMERA_DEFAULTS.dragAngleFactor;
    this.targetCameraHeight = THREE.MathUtils.clamp(
      this.targetCameraHeight + deltaY * CAMERA_DEFAULTS.dragHeightFactor,
      CAMERA_DEFAULTS.minHeight,
      CAMERA_DEFAULTS.maxHeight
    );
    this.lastInteractionTime = time;
  }

  public endDrag(time: number): void {
    this.isDragging = false;
    this.lastInteractionTime = time;
  }

  public applyZoom(deltaY: number, time: number): void {
    this.targetCameraDistance = THREE.MathUtils.clamp(
      this.targetCameraDistance + deltaY * CAMERA_DEFAULTS.zoomFactor,
      CAMERA_DEFAULTS.minDistance,
      CAMERA_DEFAULTS.maxDistance
    );
    this.isUserInteracting = true;
    this.lastInteractionTime = time;
  }

  public reset(): void {
    this.cameraAngle = CAMERA_DEFAULTS.angle;
    this.targetCameraAngle = CAMERA_DEFAULTS.angle;
    this.cameraHeight = CAMERA_DEFAULTS.height;
    this.targetCameraHeight = CAMERA_DEFAULTS.height;
    this.cameraDistance = CAMERA_DEFAULTS.distance;
    this.targetCameraDistance = CAMERA_DEFAULTS.distance;
    this.autoRotatePhase = 0;
    this.isDragging = false;
    this.isUserInteracting = false;
    this.lastInteractionTime = 0;
  }

  public update(delta: number, time: number): void {
    if (time - this.lastInteractionTime > CAMERA_DEFAULTS.interactionResumeDelay) {
      this.isUserInteracting = false;
    }

    if (!this.isUserInteracting && !this.isDragging) {
      this.autoRotatePhase += delta * ((2 * Math.PI) / CAMERA_DEFAULTS.autoRotatePeriod);
      const autoAngle = Math.sin(this.autoRotatePhase) * CAMERA_DEFAULTS.autoRotateAmplitude;
      this.targetCameraAngle = autoAngle;
    }

    this.cameraAngle += (this.targetCameraAngle - this.cameraAngle) * CAMERA_DEFAULTS.damping;
    this.cameraHeight += (this.targetCameraHeight - this.cameraHeight) * CAMERA_DEFAULTS.damping;

    const zoomSmooth = 1 - Math.pow(0.001, delta / CAMERA_DEFAULTS.zoomSmoothHalfLife);
    this.cameraDistance += (this.targetCameraDistance - this.cameraDistance) * zoomSmooth;
  }

  public applyTo(camera: THREE.PerspectiveCamera): void {
    const x = Math.sin(this.cameraAngle) * this.cameraDistance;
    const z = Math.cos(this.cameraAngle) * this.cameraDistance;
    camera.position.set(x, this.cameraHeight, z);
    camera.lookAt(CAMERA_DEFAULTS.lookAt);
  }
}
