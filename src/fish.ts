import * as THREE from 'three';

export type FishType = 'clownfish' | 'blue_tang' | 'angelfish';

export interface FishConfig {
  type: FishType;
  bodyColor: number;
  stripeColors: number[];
}

export const FISH_CONFIGS: Record<FishType, FishConfig> = {
  clownfish: { type: 'clownfish', bodyColor: 0xff8c00, stripeColors: [0xffffff, 0x111111] },
  blue_tang: { type: 'blue_tang', bodyColor: 0x0099ff, stripeColors: [0x000000, 0xffdd00] },
  angelfish: { type: 'angelfish', bodyColor: 0xffffff, stripeColors: [0xff4444, 0x4444ff, 0x44ff44] },
};

export class Fish {
  public group: THREE.Group;
  public type: FishType;
  public config: FishConfig;
  public bodyMesh: THREE.Mesh;
  public tailMesh: THREE.Mesh;
  public bioLights: THREE.PointLight[] = [];

  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public baseSpeed: number;
  public currentSpeed: number;

  public bezierStart: THREE.Vector3;
  public bezierEnd!: THREE.Vector3;
  public bezierCP1!: THREE.Vector3;
  public bezierCP2!: THREE.Vector3;
  public bezierProgress: number = 0;
  public bezierTimer: number = 0;
  public bezierDuration: number = 5;

  public clusterCenter: THREE.Vector3;
  public tailPhase: number;
  public tailWagSpeed: number = 3;

  public isGathering: boolean = false;
  public gatherTarget: THREE.Vector3 | null = null;
  public gatherTimer: number = 0;

  public bioFluorescent: boolean = false;
  public bioLightPhase: number;

  public baseOpacity: number = 1.0;
  public materials: THREE.MeshStandardMaterial[] = [];

  constructor(type: FishType, position: THREE.Vector3, clusterCenter: THREE.Vector3) {
    this.type = type;
    this.config = FISH_CONFIGS[type];
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.baseSpeed = 0.5 + Math.random() * 1.0;
    this.currentSpeed = this.baseSpeed;
    this.clusterCenter = clusterCenter.clone();
    this.tailPhase = Math.random() * Math.PI * 2;
    this.bioLightPhase = Math.random() * Math.PI * 2;

    this.bezierStart = position.clone();
    this.generateNewBezier();

    this.group = new THREE.Group();
    this.bodyMesh = this.createBody();
    this.tailMesh = this.createTail();
    this.group.add(this.bodyMesh);
    this.group.add(this.tailMesh);
    this.group.position.copy(this.position);
  }

  private createBody(): THREE.Mesh {
    const bodyGroup = new THREE.Group();
    const bodyGeometry = new THREE.SphereGeometry(0.3, 16, 12);
    bodyGeometry.scale(1.5, 0.7, 0.8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.config.bodyColor,
      roughness: 0.5,
      metalness: 0.1,
    });
    this.materials.push(bodyMaterial);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    bodyGroup.add(body);

    if (this.type === 'clownfish') {
      for (let s = 0; s < 3; s++) {
        const stripeGeo = new THREE.SphereGeometry(0.31, 8, 6);
        stripeGeo.scale(1.5, 0.7, 0.85);
        const stripeColor = s === 1 ? 0xffffff : 0x111111;
        const stripeMat = new THREE.MeshStandardMaterial({
          color: stripeColor,
          roughness: 0.5,
        });
        this.materials.push(stripeMat);
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.position.x = -0.2 + s * 0.2;
        stripe.scale.setScalar(0.4);
        bodyGroup.add(stripe);
      }
    } else if (this.type === 'blue_tang') {
      const stripeGeo = new THREE.BoxGeometry(0.05, 0.3, 0.25);
      const stripeMat = new THREE.MeshStandardMaterial({
        color: 0xffdd00,
        roughness: 0.5,
      });
      this.materials.push(stripeMat);
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.x = 0.15;
      bodyGroup.add(stripe);
    } else if (this.type === 'angelfish') {
      const colors = [0xff4444, 0x4444ff, 0x44ff44];
      for (let s = 0; s < 3; s++) {
        const stripeGeo = new THREE.PlaneGeometry(0.05, 0.6);
        const stripeMat = new THREE.MeshStandardMaterial({
          color: colors[s],
          roughness: 0.5,
          side: THREE.DoubleSide,
        });
        this.materials.push(stripeMat);
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.position.set(-0.15 + s * 0.15, 0, 0);
        bodyGroup.add(stripe);
      }
    }

    const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    this.materials.push(eyeMat);
    const eye1 = new THREE.Mesh(eyeGeo, eyeMat);
    const eye2 = new THREE.Mesh(eyeGeo, eyeMat);
    eye1.position.set(0.28, 0.08, 0.12);
    eye2.position.set(0.28, 0.08, -0.12);
    bodyGroup.add(eye1);
    bodyGroup.add(eye2);

    return bodyGroup as unknown as THREE.Mesh;
  }

  private createTail(): THREE.Mesh {
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(-0.35, 0.25);
    tailShape.lineTo(-0.2, 0);
    tailShape.lineTo(-0.35, -0.25);
    tailShape.closePath();

    const tailGeometry = new THREE.ExtrudeGeometry(tailShape, {
      depth: 0.02,
      bevelEnabled: false,
    });
    tailGeometry.center();

    const tailMaterial = new THREE.MeshStandardMaterial({
      color: this.config.bodyColor,
      roughness: 0.5,
      side: THREE.DoubleSide,
    });
    this.materials.push(tailMaterial);
    const tail = new THREE.Mesh(tailGeometry, tailMaterial);
    tail.position.x = -0.4;
    return tail;
  }

  public addBioLight(): void {
    if (this.bioLights.length === 0) {
      const light = new THREE.PointLight(0x88ffff, 0, 3);
      light.position.set(0, 0, 0);
      this.group.add(light);
      this.bioLights.push(light);
    }
  }

  public removeBioLight(): void {
    this.bioLights.forEach(light => {
      this.group.remove(light);
      light.dispose();
    });
    this.bioLights = [];
  }

  private generateNewBezier(): void {
    this.bezierStart = this.bezierEnd ? this.bezierEnd.clone() : this.position.clone();
    const angle = Math.random() * Math.PI * 2;
    const radius = 2 + Math.random() * 4;
    const offsetY = (Math.random() - 0.5) * 3;

    this.bezierEnd = new THREE.Vector3(
      this.clusterCenter.x + Math.cos(angle) * radius,
      Math.max(0.5, Math.min(15, this.clusterCenter.y + offsetY)),
      this.clusterCenter.z + Math.sin(angle) * radius
    );

    const midAngle = angle + (Math.random() - 0.5) * Math.PI;
    const cp1Dist = 1 + Math.random() * 2;
    const cp2Dist = 1 + Math.random() * 2;
    this.bezierCP1 = new THREE.Vector3(
      this.bezierStart.x + Math.cos(midAngle) * cp1Dist,
      this.bezierStart.y + (Math.random() - 0.5) * 2,
      this.bezierStart.z + Math.sin(midAngle) * cp1Dist
    );
    this.bezierCP2 = new THREE.Vector3(
      this.bezierEnd.x + Math.cos(midAngle + Math.PI) * cp2Dist,
      this.bezierEnd.y + (Math.random() - 0.5) * 2,
      this.bezierEnd.z + Math.sin(midAngle + Math.PI) * cp2Dist
    );

    this.bezierProgress = 0;
    this.bezierDuration = 4 + Math.random() * 2;
    this.bezierTimer = 0;
  }

  public startGathering(target: THREE.Vector3): void {
    this.isGathering = true;
    this.gatherTarget = target.clone();
    this.gatherTimer = 2;
  }

  public update(delta: number, time: number, temperature: number, turbidity: number, lightIntensity: number): void {
    const tempFactor = 1 + ((temperature - 25) / 5) * 0.3;
    const speedFactor = this.isGathering ? 2 : 1;
    this.currentSpeed = this.baseSpeed * tempFactor * speedFactor;
    this.tailWagSpeed = 3 + this.currentSpeed * 3;

    this.tailPhase += delta * this.tailWagSpeed;
    this.tailMesh.rotation.y = Math.sin(this.tailPhase) * 0.5;

    if (this.isGathering && this.gatherTarget) {
      this.gatherTimer -= delta;
      const dir = new THREE.Vector3().subVectors(this.gatherTarget, this.position).normalize();
      this.velocity.lerp(dir.multiplyScalar(this.currentSpeed), 0.1);
      if (this.gatherTimer <= 0) {
        this.isGathering = false;
        this.gatherTarget = null;
        this.generateNewBezier();
      }
    } else {
      this.bezierTimer += delta;
      this.bezierProgress = Math.min(this.bezierTimer / this.bezierDuration, 1);

      if (this.bezierProgress >= 1) {
        this.generateNewBezier();
      } else {
        const t = this.bezierProgress;
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;

        const bezierPos = new THREE.Vector3();
        bezierPos.x = mt3 * this.bezierStart.x + 3 * mt2 * t * this.bezierCP1.x + 3 * mt * t2 * this.bezierCP2.x + t3 * this.bezierEnd.x;
        bezierPos.y = mt3 * this.bezierStart.y + 3 * mt2 * t * this.bezierCP1.y + 3 * mt * t2 * this.bezierCP2.y + t3 * this.bezierEnd.y;
        bezierPos.z = mt3 * this.bezierStart.z + 3 * mt2 * t * this.bezierCP1.z + 3 * mt * t2 * this.bezierCP2.z + t3 * this.bezierEnd.z;

        const tangent = new THREE.Vector3();
        tangent.x = 3 * mt2 * (this.bezierCP1.x - this.bezierStart.x) + 6 * mt * t * (this.bezierCP2.x - this.bezierCP1.x) + 3 * t2 * (this.bezierEnd.x - this.bezierCP2.x);
        tangent.y = 3 * mt2 * (this.bezierCP1.y - this.bezierStart.y) + 6 * mt * t * (this.bezierCP2.y - this.bezierCP1.y) + 3 * t2 * (this.bezierEnd.y - this.bezierCP2.y);
        tangent.z = 3 * mt2 * (this.bezierCP1.z - this.bezierStart.z) + 6 * mt * t * (this.bezierCP2.z - this.bezierCP1.z) + 3 * t2 * (this.bezierEnd.z - this.bezierCP2.z);
        tangent.normalize();

        const desiredVel = tangent.multiplyScalar(this.currentSpeed);
        this.velocity.lerp(desiredVel, 0.1);
        this.position.lerp(bezierPos, 0.3);
      }
    }

    this.position.add(this.velocity.clone().multiplyScalar(delta));
    this.position.x = THREE.MathUtils.clamp(this.position.x, -30, 30);
    this.position.y = THREE.MathUtils.clamp(this.position.y, 0.5, 20);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -30, 30);

    this.group.position.copy(this.position);

    if (this.velocity.length() > 0.01) {
      const lookTarget = this.position.clone().add(this.velocity);
      this.group.lookAt(lookTarget);
    }

    this.group.rotation.z = Math.sin(time + this.position.x * 0.5) * 0.05;

    if (lightIntensity < 30) {
      this.bioFluorescent = true;
      if (this.bioLights.length === 0) {
        this.addBioLight();
      }
      this.bioLightPhase += delta * (2 + Math.random() * 3);
      const intensity = (Math.sin(this.bioLightPhase) * 0.5 + 0.5) * 0.8;
      this.bioLights.forEach(light => {
        light.intensity = intensity;
      });
    } else {
      if (this.bioFluorescent) {
        this.bioFluorescent = false;
        this.removeBioLight();
      }
    }

    if (turbidity > 70) {
      this.baseOpacity = 0.4;
    } else {
      this.baseOpacity = 1.0;
    }

    this.materials.forEach(mat => {
      if (this.baseOpacity < 1.0) {
        mat.transparent = true;
        mat.opacity += (this.baseOpacity - mat.opacity) * 0.1;
      } else {
        mat.transparent = false;
        mat.opacity = 1.0;
      }
    });
  }
}

export class FishManager {
  public scene: THREE.Scene;
  public fishes: Fish[] = [];
  public fishCount: number = 30;
  public clusterCenters: THREE.Vector3[];
  public smallSchool: boolean = false;

  constructor(scene: THREE.Scene, clusterCenters: THREE.Vector3[]) {
    this.scene = scene;
    this.clusterCenters = clusterCenters;
    this.generateFish();
    this.setupClickEvents();
  }

  private generateFish(): void {
    const fishTypes: FishType[] = ['clownfish', 'blue_tang', 'angelfish'];
    const fishesPerType = 10;

    for (let t = 0; t < fishTypes.length; t++) {
      const clusterCenter = this.clusterCenters[t] || new THREE.Vector3(0, 2, 0);
      for (let i = 0; i < fishesPerType; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 3;
        const pos = new THREE.Vector3(
          clusterCenter.x + Math.cos(angle) * radius,
          clusterCenter.y + 1 + Math.random() * 3,
          clusterCenter.z + Math.sin(angle) * radius
        );
        const fish = new Fish(fishTypes[t], pos, clusterCenter);
        this.fishes.push(fish);
        this.scene.add(fish.group);
      }
    }
  }

  private setupClickEvents(): void {
    window.addEventListener('click', (event) => {
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
      );
      const camera = (window as any)._camera as THREE.Camera;
      if (!camera) return;
      raycaster.setFromCamera(mouse, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      const intersectPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, intersectPoint);
      if (intersectPoint) {
        intersectPoint.y = 2 + Math.random() * 5;
        this.fishes.forEach(fish => {
          fish.startGathering(intersectPoint);
        });
      }
    });
  }

  public toggleSchoolSize(): void {
    this.smallSchool = !this.smallSchool;
    if (this.smallSchool) {
      for (let i = 15; i < this.fishes.length; i++) {
        this.scene.remove(this.fishes[i].group);
      }
      this.fishes = this.fishes.slice(0, 15);
    } else {
      this.fishes.forEach(f => this.scene.remove(f.group));
      this.fishes = [];
      this.generateFish();
    }
    this.fishCount = this.fishes.length;
  }

  public update(delta: number, time: number, temperature: number, turbidity: number, lightIntensity: number, fps: number): void {
    const skipFrame = fps < 30 ? Math.floor(time * 60) % 2 === 0 : false;
    if (skipFrame) return;

    for (const fish of this.fishes) {
      fish.update(delta, time, temperature, turbidity, lightIntensity);
    }
  }

  public reset(clusterCenters: THREE.Vector3[]): void {
    this.fishes.forEach(f => this.scene.remove(f.group));
    this.fishes = [];
    this.clusterCenters = clusterCenters;
    this.smallSchool = false;
    this.generateFish();
    this.fishCount = this.fishes.length;
  }
}
