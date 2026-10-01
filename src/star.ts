import * as THREE from 'three';

export interface StarConfig {
  name: string;
  mass: number;
  baseRadius: number;
  color: number;
  temperature: number;
  planetColor: number;
  position: THREE.Vector3;
}

export class Star {
  public group: THREE.Group;
  public mesh: THREE.Mesh;
  public glow: THREE.Mesh;
  public ring: THREE.Points;
  public planet: THREE.Mesh;
  public planetGlow: THREE.Mesh;
  public light: THREE.PointLight;
  public config: StarConfig;
  private currentScale: number;
  private targetScale: number;

  constructor(config: StarConfig) {
    this.config = { ...config };
    this.currentScale = 1;
    this.targetScale = 1;

    this.group = new THREE.Group();
    this.group.position.copy(config.position);

    this.mesh = this.createStarMesh(config);
    this.glow = this.createGlow(config);
    this.ring = this.createParticleRing(config);
    this.planet = this.createPlanet(config);
    this.planetGlow = this.createPlanetGlow(config);
    this.light = this.createLight(config);

    this.group.add(this.mesh);
    this.group.add(this.glow);
    this.group.add(this.ring);
    this.group.add(this.light);

    this.group.userData = {
      isStar: true,
      starRef: this
    };
  }

  private createStarMesh(config: StarConfig): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(config.baseRadius, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 1
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.isStarCore = true;
    mesh.userData.starRef = this;
    return mesh;
  }

  private createGlow(config: StarConfig): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(config.baseRadius * 1.8, 32, 32);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    const color = new THREE.Color(config.color);
    gradient.addColorStop(0, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.6)`);
    gradient.addColorStop(0.4, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.2)`);
    gradient.addColorStop(1, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.8,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(geometry, material);
    return glow;
  }

  private createParticleRing(config: StarConfig): THREE.Points {
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const color = new THREE.Color(config.color);

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = config.baseRadius * (1.4 + Math.random() * 0.6);
      const yOffset = (Math.random() - 0.5) * config.baseRadius * 0.3;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = yOffset;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      const brightness = 0.6 + Math.random() * 0.4;
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const ring = new THREE.Points(geometry, material);
    ring.rotation.x = Math.PI / 2;
    return ring;
  }

  private createPlanet(config: StarConfig): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(config.baseRadius * 0.25, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: config.planetColor,
      transparent: true,
      opacity: 1
    });
    const planet = new THREE.Mesh(geometry, material);
    planet.userData.isPlanet = true;
    return planet;
  }

  private createPlanetGlow(config: StarConfig): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(config.baseRadius * 0.45, 16, 16);
    const color = new THREE.Color(config.planetColor);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.5)`);
    gradient.addColorStop(1, `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.7,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(geometry, material);
    return glow;
  }

  private createLight(config: StarConfig): THREE.PointLight {
    const light = new THREE.PointLight(config.color, 2, 200, 2);
    light.position.set(0, 0, 0);
    return light;
  }

  public updateMass(newMass: number): void {
    this.config.mass = newMass;
    this.targetScale = Math.pow(newMass / this.config.mass * this.currentScale + (newMass / 3), 0.5);
    this.targetScale = Math.max(0.5, Math.min(2.5, 0.6 + newMass * 0.3));
    this.light.intensity = 1 + newMass * 0.5;
  }

  public update(deltaTime: number): void {
    this.currentScale += (this.targetScale - this.currentScale) * Math.min(deltaTime * 3, 1);
    const s = this.currentScale;
    this.mesh.scale.setScalar(s);
    this.glow.scale.setScalar(s);
    this.ring.scale.setScalar(s);

    this.mesh.rotation.y += deltaTime * 0.3;
    this.ring.rotation.z += deltaTime * 0.5;
  }

  public getRadius(): number {
    return this.config.baseRadius * this.currentScale;
  }
}
