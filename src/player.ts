import { TrailPoint } from './types';

const MOVE_DURATION = 150;
const TRAIL_FADE_TIME = 5000;
const HALO_DURATION = 3000;
const SLOW_DURATION = 2000;
const SLOW_MULTIPLIER = 0.5;

export class Player {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  moveProgress: number;
  moveDuration: number;
  isMoving: boolean;
  speedMultiplier: number;
  slowEndTime: number;
  haloEndTime: number;
  trapHits: number;
  trail: TrailPoint[];
  maxTrapHits: number;

  constructor(startX: number = 0, startY: number = 0, maxTrapHits: number = 3) {
    this.x = startX;
    this.y = startY;
    this.prevX = startX;
    this.prevY = startY;
    this.moveProgress = 1;
    this.moveDuration = MOVE_DURATION;
    this.isMoving = false;
    this.speedMultiplier = 1;
    this.slowEndTime = 0;
    this.haloEndTime = 0;
    this.trapHits = 0;
    this.trail = [];
    this.maxTrapHits = maxTrapHits;
  }

  reset(startX: number = 0, startY: number = 0): void {
    this.x = startX;
    this.y = startY;
    this.prevX = startX;
    this.prevY = startY;
    this.moveProgress = 1;
    this.isMoving = false;
    this.speedMultiplier = 1;
    this.slowEndTime = 0;
    this.haloEndTime = 0;
    this.trapHits = 0;
    this.trail = [];
  }

  tryMove(dx: number, dy: number, canMove: (x: number, y: number) => boolean, currentTime: number): boolean {
    if (this.isMoving) return false;
    
    const effectiveDuration = this.moveDuration / this.speedMultiplier;
    const newX = this.x + dx;
    const newY = this.y + dy;
    
    if (!canMove(newX, newY)) return false;
    
    this.prevX = this.x;
    this.prevY = this.y;
    this.x = newX;
    this.y = newY;
    this.isMoving = true;
    this.moveProgress = 0;
    this.moveDuration = effectiveDuration;
    
    this.trail.push({
      x: this.prevX,
      y: this.prevY,
      createdAt: currentTime
    });
    
    return true;
  }

  update(deltaTime: number, currentTime: number): void {
    if (this.isMoving) {
      this.moveProgress += deltaTime / this.moveDuration;
      if (this.moveProgress >= 1) {
        this.moveProgress = 1;
        this.isMoving = false;
      }
    }
    
    if (this.slowEndTime > 0 && currentTime >= this.slowEndTime) {
      this.speedMultiplier = 1;
      this.slowEndTime = 0;
    }
    
    this.cleanupOldTrail(currentTime);
  }

  cleanupOldTrail(currentTime: number): void {
    const cutoffTime = currentTime - TRAIL_FADE_TIME;
    this.trail = this.trail.filter(t => t.createdAt > cutoffTime);
  }

  getRenderPosition(): { x: number; y: number } {
    const easeProgress = this.easeOut(this.moveProgress);
    const renderX = this.prevX + (this.x - this.prevX) * easeProgress;
    const renderY = this.prevY + (this.y - this.prevY) * easeProgress;
    return { x: renderX, y: renderY };
  }

  easeOut(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  hasHalo(currentTime: number): boolean {
    return this.haloEndTime > currentTime;
  }

  activateHalo(currentTime: number): void {
    this.haloEndTime = currentTime + HALO_DURATION;
  }

  isSlowed(currentTime: number): boolean {
    return this.slowEndTime > currentTime;
  }

  applySlow(currentTime: number): void {
    this.speedMultiplier = SLOW_MULTIPLIER;
    this.slowEndTime = currentTime + SLOW_DURATION;
    this.trapHits++;
  }

  isFlashingRed(currentTime: number): boolean {
    if (!this.isSlowed(currentTime)) return false;
    const elapsed = SLOW_DURATION - (this.slowEndTime - currentTime);
    const flashInterval = 200;
    return Math.floor(elapsed / flashInterval) % 2 === 0;
  }

  getTrailAlpha(trailPoint: TrailPoint, currentTime: number): number {
    const age = currentTime - trailPoint.createdAt;
    if (age >= TRAIL_FADE_TIME) return 0;
    return 1 - age / TRAIL_FADE_TIME;
  }

  isGameOver(): boolean {
    return this.trapHits >= this.maxTrapHits;
  }

  getGridPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
}
