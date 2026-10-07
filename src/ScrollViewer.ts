import * as THREE from 'three';

export enum ScrollState {
  HIDDEN = 'hidden',
  FLOATING = 'floating',
  UNROLLING = 'unrolling',
  FULLY_UNROLLED = 'fully_unrolled',
  ROLLING_BACK = 'rolling_back',
}

export class ScrollViewer {
  public group: THREE.Group;
  public state: ScrollState = ScrollState.HIDDEN;
  public onUnrollComplete?: () => void;
  public onRollbackComplete?: () => void;
  public onClick?: () => void;

  private scrollCore: THREE.Group;
  private leftCap: THREE.Mesh;
  private rightCap: THREE.Mesh;
  private fabricMesh: THREE.Mesh | null = null;
  private fullFabricMesh: THREE.Mesh | null = null;
  private backgroundMesh: THREE.Mesh | null = null;
  private backgroundCanvas: HTMLCanvasElement;

  private animation = {
    startTime: 0,
    duration: 0,
    startValue: 0,
    endValue: 0,
  };

  private floatStartTime = 0;
  private unrollStartTime = 0;
  private readonly UNROLL_SPEED = 0.2;
  private readonly FULL_UNROLL_WIDTH = 3.5;
  private readonly FULL_UNROLL_HEIGHT = 2;
  private readonly AUTO_ROLLBACK_DELAY = 15000;

  private autoRollbackTimer: number | null = null;

  constructor() {
    this.group = new THREE.Group();
    this.scrollCore = new THREE.Group();

    this.backgroundCanvas = document.createElement('canvas');
    this.backgroundCanvas.width = 1024;
    this.backgroundCanvas.height = 768;

    const coreGeo = new THREE.CylinderGeometry(0.075, 0.075, 2.4, 32);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x8b0000,
      roughness: 0.6,
      metalness: 0.2,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.rotation.z = Math.PI / 2;
    this.scrollCore.add(core);

    const capGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x98d8c8,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.9,
    });
    this.leftCap = new THREE.Mesh(capGeo, capMat);
    this.leftCap.position.x = -1.2;
    this.scrollCore.add(this.leftCap);

    this.rightCap = new THREE.Mesh(capGeo, capMat.clone());
    this.rightCap.position.x = 1.2;
    this.scrollCore.add(this.rightCap);

    this.scrollCore.position.set(0, 1.5, 0);
    this.scrollCore.visible = false;

    this.group.add(this.scrollCore);
    this.generateInkWashBackground();
  }

  private generateInkWashBackground(): void {
    const ctx = this.backgroundCanvas.getContext('2d')!;
    ctx.fillStyle = '#f5f0e6';
    ctx.fillRect(0, 0, 1024, 768);

    ctx.globalAlpha = 0.15;

    for (let i = 0; i < 5; i++) {
      const gradient = ctx.createRadialGradient(
        Math.random() * 1024,
        Math.random() * 768,
        0,
        Math.random() * 1024,
        Math.random() * 768,
        200 + Math.random() * 300
      );
      gradient.addColorStop(0, `rgba(50, 40, 30, ${0.3 + Math.random() * 0.3})`);
      gradient.addColorStop(1, 'rgba(50, 40, 30, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 768);
    }

    ctx.strokeStyle = 'rgba(30, 25, 20, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 600);
    ctx.bezierCurveTo(200, 400, 300, 500, 400, 350);
    ctx.bezierCurveTo(500, 200, 600, 300, 700, 250);
    ctx.bezierCurveTo(800, 200, 900, 300, 950, 200);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(50, 650);
    ctx.bezierCurveTo(150, 500, 250, 550, 350, 450);
    ctx.bezierCurveTo(450, 350, 550, 400, 650, 350);
    ctx.bezierCurveTo(750, 300, 850, 350, 900, 300);
    ctx.stroke();

    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(Math.random() * 1024, Math.random() * 768, 1 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  public createScroll(fabricTexture: THREE.Texture): void {
    this.clearScroll();

    const scrollFabricGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.3, 32);
    const scrollFabricMat = new THREE.MeshStandardMaterial({
      map: fabricTexture,
      roughness: 0.8,
    });
    const scrollFabric = new THREE.Mesh(scrollFabricGeo, scrollFabricMat);
    scrollFabric.rotation.z = Math.PI / 2;
    this.scrollCore.add(scrollFabric);

    this.fabricMesh = scrollFabric;

    const fullFabricGeo = new THREE.PlaneGeometry(this.FULL_UNROLL_WIDTH, this.FULL_UNROLL_HEIGHT);
    const fullFabricMat = new THREE.MeshStandardMaterial({
      map: fabricTexture,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    this.fullFabricMesh = new THREE.Mesh(fullFabricGeo, fullFabricMat);
    this.fullFabricMesh.position.set(0, 1.5, -0.1);
    this.fullFabricMesh.visible = false;
    this.fullFabricMesh.scale.x = 0;
    this.group.add(this.fullFabricMesh);

    const bgTexture = new THREE.CanvasTexture(this.backgroundCanvas);
    const bgGeo = new THREE.PlaneGeometry(8, 6);
    const bgMat = new THREE.MeshBasicMaterial({
      map: bgTexture,
      transparent: true,
      opacity: 0.15,
    });
    this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
    this.backgroundMesh.position.set(0, 1.5, -0.5);
    this.backgroundMesh.visible = false;
    this.group.add(this.backgroundMesh);

    this.scrollCore.visible = true;
    this.state = ScrollState.FLOATING;
    this.floatStartTime = performance.now();
    this.scrollCore.userData.isScroll = true;
  }

  private clearScroll(): void {
    if (this.fabricMesh) {
      this.scrollCore.remove(this.fabricMesh);
      this.fabricMesh.geometry.dispose();
      (this.fabricMesh.material as THREE.Material).dispose();
      this.fabricMesh = null;
    }
    if (this.fullFabricMesh) {
      this.group.remove(this.fullFabricMesh);
      this.fullFabricMesh.geometry.dispose();
      (this.fullFabricMesh.material as THREE.Material).dispose();
      this.fullFabricMesh = null;
    }
    if (this.backgroundMesh) {
      this.group.remove(this.backgroundMesh);
      this.backgroundMesh.geometry.dispose();
      (this.backgroundMesh.material as THREE.Material).dispose();
      this.backgroundMesh = null;
    }
    this.clearAutoRollbackTimer();
  }

  public unroll(): void {
    if (this.state !== ScrollState.FLOATING) return;

    this.state = ScrollState.UNROLLING;
    this.animation.startTime = performance.now();
    this.animation.duration = (this.FULL_UNROLL_WIDTH / 2) / this.UNROLL_SPEED * 1000;
    this.animation.startValue = 0;
    this.animation.endValue = 1;

    if (this.fullFabricMesh) {
      this.fullFabricMesh.visible = true;
    }
    if (this.backgroundMesh) {
      this.backgroundMesh.visible = true;
    }
  }

  public rollback(): void {
    if (this.state !== ScrollState.FULLY_UNROLLED) return;

    this.clearAutoRollbackTimer();
    this.state = ScrollState.ROLLING_BACK;
    this.animation.startTime = performance.now();
    this.animation.duration = (this.FULL_UNROLL_WIDTH / 2) / this.UNROLL_SPEED * 1000;
    this.animation.startValue = 1;
    this.animation.endValue = 0;
  }

  private startAutoRollback(): void {
    this.clearAutoRollbackTimer();
    this.autoRollbackTimer = window.setTimeout(() => {
      this.rollback();
    }, this.AUTO_ROLLBACK_DELAY);
  }

  private clearAutoRollbackTimer(): void {
    if (this.autoRollbackTimer !== null) {
      clearTimeout(this.autoRollbackTimer);
      this.autoRollbackTimer = null;
    }
  }

  public hide(): void {
    this.clearScroll();
    this.scrollCore.visible = false;
    this.state = ScrollState.HIDDEN;
  }

  public getClickableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    if (this.scrollCore.visible) {
      objects.push(this.scrollCore);
    }
    return objects;
  }

  public handleClick(): void {
    if (this.state === ScrollState.FLOATING) {
      this.unroll();
      this.onClick?.();
    }
  }

  public update(deltaTime: number): void {
    const now = performance.now();

    if (this.state === ScrollState.FLOATING) {
      const floatTime = (now - this.floatStartTime) / 1000;
      this.scrollCore.position.y = 1.5 + Math.sin(floatTime * 0.5) * 0.1;
      this.scrollCore.rotation.y += deltaTime * (Math.PI * 2 / 10);
    }

    if (this.state === ScrollState.UNROLLING || this.state === ScrollState.ROLLING_BACK) {
      const elapsed = now - this.animation.startTime;
      const t = Math.min(elapsed / this.animation.duration, 1);
      const progress = this.animation.startValue + (this.animation.endValue - this.animation.startValue) * t;

      if (this.fullFabricMesh) {
        this.fullFabricMesh.scale.x = progress;

        const offset = (1 - progress) * (this.FULL_UNROLL_WIDTH / 2);
        this.leftCap.position.x = -1.2 - offset;
        this.rightCap.position.x = 1.2 + offset;

        this.scrollCore.position.x = 0;
      }

      if (this.backgroundMesh) {
        const bgMat = this.backgroundMesh.material as THREE.MeshBasicMaterial;
        bgMat.opacity = 0.15 * progress;
      }

      if (t >= 1) {
        if (this.state === ScrollState.UNROLLING) {
          this.state = ScrollState.FULLY_UNROLLED;
          this.startAutoRollback();
          this.onUnrollComplete?.();
        } else {
          this.state = ScrollState.FLOATING;
          this.leftCap.position.x = -1.2;
          this.rightCap.position.x = 1.2;
          if (this.fullFabricMesh) {
            this.fullFabricMesh.visible = false;
          }
          if (this.backgroundMesh) {
            this.backgroundMesh.visible = false;
          }
          this.floatStartTime = performance.now();
          this.onRollbackComplete?.();
        }
      }
    }
  }

  public dispose(): void {
    this.clearScroll();
    this.clearAutoRollbackTimer();
  }
}
