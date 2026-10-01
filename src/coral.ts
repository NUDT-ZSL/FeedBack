import * as THREE from 'three';

export type CoralType = 'staghorn' | 'brain' | 'sea_fan' | 'tube' | 'bubble' | 'star';

export interface CoralConfig {
  type: CoralType;
  baseColor: number;
  tipColor: number;
}

export const CORAL_CONFIGS: Record<CoralType, CoralConfig> = {
  staghorn: { type: 'staghorn', baseColor: 0xff6f00, tipColor: 0xffab40 },
  brain: { type: 'brain', baseColor: 0xe91e63, tipColor: 0xf06292 },
  sea_fan: { type: 'sea_fan', baseColor: 0x9c27b0, tipColor: 0xba68c8 },
  tube: { type: 'tube', baseColor: 0x00bcd4, tipColor: 0x4dd0e1 },
  bubble: { type: 'bubble', baseColor: 0xffb300, tipColor: 0xffd54f },
  star: { type: 'star', baseColor: 0x4caf50, tipColor: 0x81c784 },
};

export class Coral {
  public group: THREE.Group;
  public type: CoralType;
  public baseHeight: number;
  public currentHeight: number = 0;
  public growthDuration: number = 3;
  public growthTime: number = 0;
  public swayPhase: number;
  public swayAmplitude: number = 0.2;
  public swayFrequency: number = 1.0;
  public config: CoralConfig;
  public materials: THREE.MeshStandardMaterial[] = [];
  public baseSaturation: number = 1.0;

  constructor(type: CoralType, position: THREE.Vector3, height: number) {
    this.type = type;
    this.baseHeight = height;
    this.config = CORAL_CONFIGS[type];
    this.swayPhase = Math.random() * Math.PI * 2;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.buildGeometry();
  }

  private buildGeometry(): void {
    switch (this.type) {
      case 'staghorn': this.buildStaghorn(); break;
      case 'brain': this.buildBrain(); break;
      case 'sea_fan': this.buildSeaFan(); break;
      case 'tube': this.buildTube(); break;
      case 'bubble': this.buildBubble(); break;
      case 'star': this.buildStar(); break;
    }
  }

  private createGradientMaterial(baseColor: number, tipColor: number): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.8,
      metalness: 0.1,
      vertexColors: true,
    });
    this.materials.push(material);
    return material;
  }

  private applyVertexColors(geometry: THREE.BufferGeometry, baseColor: THREE.Color, tipColor: THREE.Color): void {
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const range = maxY - minY || 1;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const t = (y - minY) / range;
      const color = new THREE.Color().lerpColors(baseColor, tipColor, t);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  private buildStaghorn(): void {
    const baseColor = new THREE.Color(this.config.baseColor);
    const tipColor = new THREE.Color(this.config.tipColor);
    const branches = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < branches; i++) {
      const branchGroup = new THREE.Group();
      const angle = (i / branches) * Math.PI * 2 + Math.random() * 0.5;
      const branchHeight = this.baseHeight * (0.6 + Math.random() * 0.4);
      const geometry = new THREE.CylinderGeometry(0.15, 0.35, branchHeight, 8);
      const material = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
      this.applyVertexColors(geometry, baseColor, tipColor);
      const branch = new THREE.Mesh(geometry, material);
      branch.castShadow = true;
      branch.position.y = branchHeight / 2;
      branchGroup.add(branch);

      const subBranches = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < subBranches; j++) {
        const subHeight = branchHeight * (0.3 + Math.random() * 0.3);
        const subGeo = new THREE.CylinderGeometry(0.08, 0.15, subHeight, 6);
        this.applyVertexColors(subGeo, baseColor, tipColor);
        const subBranch = new THREE.Mesh(subGeo, material);
        subBranch.castShadow = true;
        const subAngle = angle + (Math.random() - 0.5) * 1.0;
        const startY = branchHeight * (0.4 + j * 0.15);
        subBranch.position.set(
          Math.cos(subAngle) * 0.2,
          startY + subHeight / 2,
          Math.sin(subAngle) * 0.2
        );
        subBranch.rotation.z = Math.cos(subAngle) * 0.4;
        subBranch.rotation.x = -Math.sin(subAngle) * 0.4;
        branchGroup.add(subBranch);
      }

      branchGroup.rotation.y = angle;
      branchGroup.rotation.z = Math.cos(angle) * 0.2;
      branchGroup.rotation.x = -Math.sin(angle) * 0.2;
      this.group.add(branchGroup);
    }
  }

  private buildBrain(): void {
    const baseColor = new THREE.Color(this.config.baseColor);
    const tipColor = new THREE.Color(this.config.tipColor);
    const geometry = new THREE.SphereGeometry(this.baseHeight * 0.6, 24, 16);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const len = Math.sqrt(x * x + y * y + z * z);
      const noise = Math.sin(x * 3) * Math.cos(y * 3) * Math.sin(z * 3) * 0.15 + 1;
      positions.setXYZ(i, (x / len) * this.baseHeight * 0.6 * noise,
        Math.abs(y / len) * this.baseHeight * 0.6 * noise,
        (z / len) * this.baseHeight * 0.6 * noise);
    }
    geometry.computeVertexNormals();
    const material = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
    this.applyVertexColors(geometry, baseColor, tipColor);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.position.y = this.baseHeight * 0.3;
    this.group.add(mesh);
  }

  private buildSeaFan(): void {
    const baseColor = new THREE.Color(this.config.baseColor);
    const tipColor = new THREE.Color(this.config.tipColor);
    const fanGroup = new THREE.Group();
    const segments = 8;
    const ribs = 6;
    for (let r = 0; r < ribs; r++) {
      const ribHeight = this.baseHeight * (0.5 + (r / ribs) * 0.5);
      const ribWidth = this.baseHeight * 0.8 * (r / ribs + 0.3);
      const points: THREE.Vector3[] = [];
      const steps = 12;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = (t - 0.5) * ribWidth;
        const y = t * ribHeight;
        const z = Math.sin(t * Math.PI) * 0.1 * (r % 2 === 0 ? 1 : -1);
        points.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(curve, 20, 0.03, 6, false);
      const material = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
      this.applyVertexColors(geometry, baseColor, tipColor);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      fanGroup.add(mesh);
      fanGroup.rotation.y = (r / ribs) * Math.PI * 0.5 - Math.PI * 0.25;
    }

    const webGeometry = new THREE.PlaneGeometry(this.baseHeight * 0.8, this.baseHeight, segments, segments);
    const webPos = webGeometry.attributes.position;
    for (let i = 0; i < webPos.count; i++) {
      const x = webPos.getX(i);
      const y = webPos.getY(i);
      const z = Math.sin(x * 4 + y * 2) * 0.15;
      webPos.setZ(i, z);
    }
    webGeometry.computeVertexNormals();
    const webMaterial = new THREE.MeshStandardMaterial({
      color: this.config.baseColor,
      transparent: true,
      opacity: 0.5,
      roughness: 0.9,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    this.materials.push(webMaterial);
    this.applyVertexColors(webGeometry, baseColor, tipColor);
    const web = new THREE.Mesh(webGeometry, webMaterial);
    web.position.y = this.baseHeight / 2;
    fanGroup.add(web);
    fanGroup.rotation.y = Math.random() * Math.PI;
    this.group.add(fanGroup);
  }

  private buildTube(): void {
    const baseColor = new THREE.Color(this.config.baseColor);
    const tipColor = new THREE.Color(this.config.tipColor);
    const tubeCount = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < tubeCount; i++) {
      const angle = (i / tubeCount) * Math.PI * 2;
      const radius = 0.2 + Math.random() * 0.3;
      const tubeHeight = this.baseHeight * (0.6 + Math.random() * 0.4);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * radius * 0.3, 0, Math.sin(angle) * radius * 0.3),
        new THREE.Vector3(Math.cos(angle) * radius * 0.6, tubeHeight * 0.4, Math.sin(angle) * radius * 0.6),
        new THREE.Vector3(Math.cos(angle) * radius, tubeHeight * 0.8, Math.sin(angle) * radius),
        new THREE.Vector3(Math.cos(angle) * radius * 1.1, tubeHeight, Math.sin(angle) * radius * 1.1),
      ]);
      const geometry = new THREE.TubeGeometry(curve, 16, 0.08 + Math.random() * 0.06, 8, false);
      const material = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
      this.applyVertexColors(geometry, baseColor, tipColor);
      const tube = new THREE.Mesh(geometry, material);
      tube.castShadow = true;
      this.group.add(tube);

      const topGeo = new THREE.CircleGeometry(0.12, 12);
      const topMat = this.createGradientMaterial(this.config.tipColor, this.config.tipColor);
      this.applyVertexColors(topGeo, tipColor, tipColor);
      const top = new THREE.Mesh(topGeo, topMat);
      top.position.copy(curve.getPoint(1));
      top.lookAt(curve.getPoint(0.9));
      this.group.add(top);
    }
  }

  private buildBubble(): void {
    const baseColor = new THREE.Color(this.config.baseColor);
    const tipColor = new THREE.Color(this.config.tipColor);
    const bubbleCount = 15 + Math.floor(Math.random() * 10);
    for (let i = 0; i < bubbleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * this.baseHeight * 0.5;
      const bubbleSize = 0.15 + Math.random() * 0.25;
      const geometry = new THREE.SphereGeometry(bubbleSize, 12, 10);
      const material = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
      this.applyVertexColors(geometry, baseColor, tipColor);
      const bubble = new THREE.Mesh(geometry, material);
      bubble.castShadow = true;
      bubble.position.set(
        Math.cos(angle) * radius,
        this.baseHeight * 0.2 + Math.random() * this.baseHeight * 0.6,
        Math.sin(angle) * radius
      );
      this.group.add(bubble);
    }

    const stemGeo = new THREE.CylinderGeometry(0.1, 0.2, this.baseHeight * 0.3, 8);
    const stemMat = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
    this.applyVertexColors(stemGeo, baseColor, tipColor);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = this.baseHeight * 0.15;
    stem.castShadow = true;
    this.group.add(stem);
  }

  private buildStar(): void {
    const baseColor = new THREE.Color(this.config.baseColor);
    const tipColor = new THREE.Color(this.config.tipColor);
    const polyps = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < polyps; i++) {
      const angle = (i / polyps) * Math.PI * 2;
      const radius = 0.3 + Math.random() * 0.3;
      const polypGroup = new THREE.Group();

      const armGeo = new THREE.ConeGeometry(0.1, this.baseHeight * 0.7, 5);
      const material = this.createGradientMaterial(this.config.baseColor, this.config.tipColor);
      this.applyVertexColors(armGeo, baseColor, tipColor);
      const arm = new THREE.Mesh(armGeo, material);
      arm.castShadow = true;
      arm.position.y = this.baseHeight * 0.35;
      polypGroup.add(arm);

      const centerGeo = new THREE.SphereGeometry(0.25, 12, 8);
      this.applyVertexColors(centerGeo, baseColor, tipColor);
      const center = new THREE.Mesh(centerGeo, material);
      center.castShadow = true;
      center.position.y = 0.1;
      polypGroup.add(center);

      polypGroup.position.set(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius
      );
      polypGroup.rotation.y = -angle;
      this.group.add(polypGroup);
    }
  }

  public update(delta: number, time: number, lightIntensity: number, temperature: number): void {
    if (this.growthTime < this.growthDuration) {
      this.growthTime += delta * (0.5 + lightIntensity / 200);
      const t = Math.min(this.growthTime / this.growthDuration, 1);
      const easeT = 1 - Math.pow(1 - t, 3);
      this.currentHeight = this.baseHeight * easeT;
      this.group.scale.setScalar(easeT);
    }

    const sway = Math.sin(time * this.swayFrequency + this.swayPhase) * this.swayAmplitude;
    this.group.rotation.z = sway * 0.3;
    this.group.rotation.x = sway * 0.2;

    const saturationFactor = 0.5 + 0.5 * (1 - Math.abs(temperature - 25) / 20);
    this.baseSaturation = Math.max(0.3, Math.min(1.0, saturationFactor));

    this.materials.forEach(mat => {
      if (mat.vertexColors) {
        const colorAttr = (mat as any).geometry?.attributes?.color;
        if (!colorAttr) return;
      }
      const baseHex = this.config.baseColor;
      const color = new THREE.Color(baseHex);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      hsl.s = hsl.s * this.baseSaturation;
      color.setHSL(hsl.h, hsl.s, hsl.l);
      mat.color.copy(color);
    });
  }
}

export class CoralManager {
  public scene: THREE.Scene;
  public corals: Coral[] = [];
  public coralCount: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.generateCorals();
  }

  private generateCorals(): void {
    const coralTypes: CoralType[] = ['staghorn', 'brain', 'sea_fan', 'tube', 'bubble', 'star'];
    const coralsPerType = 9;

    for (let t = 0; t < coralTypes.length; t++) {
      for (let i = 0; i < coralsPerType; i++) {
        const x = (Math.random() - 0.5) * 40;
        const z = (Math.random() - 0.5) * 40;
        const height = 1 + Math.random() * 4;
        const position = new THREE.Vector3(x, -0.3, z);
        const coral = new Coral(coralTypes[t], position, height);
        this.corals.push(coral);
        this.scene.add(coral.group);
        this.coralCount++;
      }
    }
  }

  public getClusterCenters(): THREE.Vector3[] {
    const centers: THREE.Vector3[] = [];
    const coralTypes: CoralType[] = ['staghorn', 'sea_fan', 'tube'];
    for (const type of coralTypes) {
      const typeCorals = this.corals.filter(c => c.type === type);
      if (typeCorals.length > 0) {
        const sum = new THREE.Vector3();
        typeCorals.forEach(c => sum.add(c.group.position));
        sum.divideScalar(typeCorals.length);
        centers.push(sum);
      }
    }
    return centers;
  }

  public update(delta: number, time: number, lightIntensity: number, temperature: number): void {
    for (const coral of this.corals) {
      coral.update(delta, time, lightIntensity, temperature);
    }
  }

  public reset(): void {
    for (const coral of this.corals) {
      this.scene.remove(coral.group);
    }
    this.corals = [];
    this.coralCount = 0;
    this.generateCorals();
  }
}
