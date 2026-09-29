import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';

type StandardMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

export class AnimationHelper {
  private static readonly HIGHLIGHT_COLOR = 0x4FC3F7;
  private static readonly HIGHLIGHT_INTENSITY = 0.5;
  private static readonly COLLISION_COLOR = 0xFF5252;
  private static readonly SAFE_COLOR = 0x4CAF50;
  private static readonly BOUNCE_AMPLITUDE = 0.08; // 8px -> 0.08 m

  private activeBlinks: Map<THREE.Mesh, { stop: () => void; interval: number }> = new Map();

  static update(time?: number): void {
    TWEEN.update(time);
  }

  bounceIn(
    mesh: THREE.Mesh,
    delayMs: number,
    amplitude: number = AnimationHelper.BOUNCE_AMPLITUDE
  ): TWEEN.Tween<{ y: number }> {
    const targetY = mesh.position.y;
    const startY = targetY - amplitude * 2;
    mesh.position.y = startY;
    mesh.scale.setScalar(0.92);

    const posObj = { y: startY, s: 0.92 };

    return new TWEEN.Tween(posObj)
      .to({ y: targetY, s: 1 }, 520)
      .delay(delayMs)
      .easing(TWEEN.Easing.Bounce.Out)
      .onUpdate(() => {
        mesh.position.y = posObj.y;
        mesh.scale.setScalar(posObj.s);
      })
      .start();
  }

  scaleIn(el: HTMLElement, durationMs: number = 200): TWEEN.Tween<{ scale: number; opacity: number }> {
    const obj = { scale: 0.85, opacity: 0 };
    el.style.opacity = '0';
    el.style.transform = 'scale(0.85)';
    requestAnimationFrame(() => {
      el.classList.add('show');
    });

    return new TWEEN.Tween(obj)
      .to({ scale: 1, opacity: 1 }, durationMs)
      .easing(TWEEN.Easing.Back.Out)
      .onUpdate(() => {
        el.style.opacity = String(obj.opacity);
        el.style.transform = `scale(${obj.scale})`;
      })
      .start();
  }

  fadeOut(el: HTMLElement, durationMs: number = 300): Promise<void> {
    return new Promise((resolve) => {
      const obj = { opacity: 1 };
      new TWEEN.Tween(obj)
        .to({ opacity: 0 }, durationMs)
        .easing(TWEEN.Easing.Quadratic.Out)
        .onUpdate(() => {
          el.style.opacity = String(obj.opacity);
        })
        .onComplete(() => {
          el.classList.add('hidden');
          el.style.opacity = '';
          resolve();
        })
        .start();
    });
  }

  highlightPulse(
    mesh: THREE.Mesh,
    color: number = AnimationHelper.HIGHLIGHT_COLOR,
    intensity: number = AnimationHelper.HIGHLIGHT_INTENSITY,
    durationMs: number = 180
  ): TWEEN.Tween<{ i: number }> {
    const mat = mesh.material as StandardMaterial;
    if (!mat || !('emissive' in mat)) {
      return new TWEEN.Tween({ i: 0 });
    }

    const userData = mesh.userData as { originalEmissive?: number; originalEmissiveIntensity?: number };
    if (userData.originalEmissive === undefined) {
      userData.originalEmissive = mat.emissive ? mat.emissive.getHex() : 0;
      userData.originalEmissiveIntensity = mat.emissiveIntensity ?? 0;
    }

    mat.emissive?.setHex(color);
    const obj = { i: mat.emissiveIntensity ?? 0 };

    return new TWEEN.Tween(obj)
      .to({ i: intensity }, durationMs)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => {
        mat.emissiveIntensity = obj.i;
      })
      .start();
  }

  removeHighlight(mesh: THREE.Mesh, durationMs: number = 150): TWEEN.Tween<{ i: number }> | null {
    const mat = mesh.material as StandardMaterial;
    if (!mat || !('emissive' in mat)) return null;

    const userData = mesh.userData as { originalEmissive?: number; originalEmissiveIntensity?: number };
    const origIntensity = userData.originalEmissiveIntensity ?? 0;
    const origColor = userData.originalEmissive ?? 0;

    const obj = { i: mat.emissiveIntensity ?? 0 };
    return new TWEEN.Tween(obj)
      .to({ i: origIntensity }, durationMs)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => {
        mat.emissiveIntensity = obj.i;
      })
      .onComplete(() => {
        mat.emissive?.setHex(origColor);
      })
      .start();
  }

  blinkRed(mesh: THREE.Mesh, durationMs: number = 2000): () => void {
    this.stopBlink(mesh);
    const mat = mesh.material as StandardMaterial;
    if (!mat || !('emissive' in mat)) return () => {};

    const userData = mesh.userData as { originalEmissive?: number; originalEmissiveIntensity?: number };
    if (userData.originalEmissive === undefined) {
      userData.originalEmissive = mat.emissive ? mat.emissive.getHex() : 0;
      userData.originalEmissiveIntensity = mat.emissiveIntensity ?? 0;
    }

    const origColor = userData.originalEmissive;
    let on = false;
    const interval = window.setInterval(() => {
      on = !on;
      mat.emissive?.setHex(on ? AnimationHelper.COLLISION_COLOR : origColor);
      mat.emissiveIntensity = on ? 0.8 : 0;
    }, 250);

    const stop = () => {
      clearInterval(interval);
      mat.emissive?.setHex(origColor);
      mat.emissiveIntensity = userData.originalEmissiveIntensity ?? 0;
      this.activeBlinks.delete(mesh);
    };

    this.activeBlinks.set(mesh, { stop, interval });

    window.setTimeout(() => stop(), durationMs);

    return stop;
  }

  safeFlash(mesh: THREE.Mesh, durationMs: number = 800): void {
    const mat = mesh.material as StandardMaterial;
    if (!mat || !('emissive' in mat)) return;

    const userData = mesh.userData as { originalEmissive?: number; originalEmissiveIntensity?: number };
    if (userData.originalEmissive === undefined) {
      userData.originalEmissive = mat.emissive ? mat.emissive.getHex() : 0;
      userData.originalEmissiveIntensity = mat.emissiveIntensity ?? 0;
    }

    mat.emissive?.setHex(AnimationHelper.SAFE_COLOR);
    const obj = { i: 0 };
    new TWEEN.Tween(obj)
      .to({ i: 0.6 }, 180)
      .easing(TWEEN.Easing.Quadratic.Out)
      .yoyo(true)
      .repeat(1)
      .onUpdate(() => {
        mat.emissiveIntensity = obj.i;
      })
      .onComplete(() => {
        mat.emissive?.setHex(userData.originalEmissive ?? 0);
        mat.emissiveIntensity = userData.originalEmissiveIntensity ?? 0;
      })
      .start();
  }

  stopBlink(mesh: THREE.Mesh): void {
    const entry = this.activeBlinks.get(mesh);
    if (entry) entry.stop();
  }

  clearAllBlinks(): void {
    this.activeBlinks.forEach((entry) => entry.stop());
    this.activeBlinks.clear();
  }

  slideDown(el: HTMLElement, targetHeight: number, durationMs: number = 300): TWEEN.Tween<{ h: number }> {
    el.style.overflow = 'hidden';
    const obj = { h: 0 };
    return new TWEEN.Tween(obj)
      .to({ h: targetHeight }, durationMs)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => {
        el.style.maxHeight = `${obj.h}px`;
      })
      .start();
  }

  numberTween(
    from: number,
    to: number,
    durationMs: number,
    onUpdate: (v: number) => void
  ): TWEEN.Tween<{ v: number }> {
    const obj = { v: from };
    return new TWEEN.Tween(obj)
      .to({ v: to }, durationMs)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => onUpdate(obj.v))
      .start();
  }
}
