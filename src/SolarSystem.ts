import * as THREE from 'three';

export interface PlanetData {
  name: string;
  nameCN: string;
  color: number;
  radius: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitAngle: number;
  distanceAU: number;
  periodDays: number;
  diameterKm: number;
  temperature: string;
}

export const PLANET_DATA: PlanetData[] = [
  {
    name: 'Mercury',
    nameCN: '水星',
    color: 0x8c7853,
    radius: 0.38,
    orbitRadius: 8,
    orbitSpeed: 0.047,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 0.39,
    periodDays: 88,
    diameterKm: 4879,
    temperature: '-173 ~ 427 °C'
  },
  {
    name: 'Venus',
    nameCN: '金星',
    color: 0xffc649,
    radius: 0.95,
    orbitRadius: 12,
    orbitSpeed: 0.035,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 0.72,
    periodDays: 225,
    diameterKm: 12104,
    temperature: '462 °C'
  },
  {
    name: 'Earth',
    nameCN: '地球',
    color: 0x6b93d6,
    radius: 1.0,
    orbitRadius: 17,
    orbitSpeed: 0.029,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 1.0,
    periodDays: 365,
    diameterKm: 12742,
    temperature: '-88 ~ 58 °C'
  },
  {
    name: 'Mars',
    nameCN: '火星',
    color: 0xc1440e,
    radius: 0.53,
    orbitRadius: 22,
    orbitSpeed: 0.024,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 1.52,
    periodDays: 687,
    diameterKm: 6779,
    temperature: '-87 ~ -5 °C'
  },
  {
    name: 'Jupiter',
    nameCN: '木星',
    color: 0xd8ca9d,
    radius: 3.5,
    orbitRadius: 32,
    orbitSpeed: 0.013,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 5.2,
    periodDays: 4333,
    diameterKm: 139820,
    temperature: '-108 °C'
  },
  {
    name: 'Saturn',
    nameCN: '土星',
    color: 0xfad5a5,
    radius: 2.9,
    orbitRadius: 42,
    orbitSpeed: 0.0097,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 9.58,
    periodDays: 10759,
    diameterKm: 116460,
    temperature: '-139 °C'
  },
  {
    name: 'Uranus',
    nameCN: '天王星',
    color: 0x93ccea,
    radius: 1.8,
    orbitRadius: 52,
    orbitSpeed: 0.0068,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 19.22,
    periodDays: 30687,
    diameterKm: 50724,
    temperature: '-197 °C'
  },
  {
    name: 'Neptune',
    nameCN: '海王星',
    color: 0x3f54ba,
    radius: 1.75,
    orbitRadius: 62,
    orbitSpeed: 0.0054,
    orbitAngle: Math.random() * Math.PI * 2,
    distanceAU: 30.05,
    periodDays: 60190,
    diameterKm: 49244,
    temperature: '-201 °C'
  }
];

export const SUN_DATA = {
  name: 'Sun',
  nameCN: '太阳',
  color: 0xffdd33,
  radius: 5,
  distanceAU: 0,
  periodDays: 0,
  diameterKm: 1392700,
  temperature: '5,500 °C'
};

export class Planet {
  public mesh: THREE.Mesh;
  public orbit: THREE.Line;
  public label: THREE.Sprite;
  public data: PlanetData;

  constructor(data: PlanetData) {
    this.data = { ...data };

    const geometry = new THREE.SphereGeometry(this.data.radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: this.data.color,
      roughness: 0.8,
      metalness: 0.1
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.userData = { type: 'planet', planet: this };
    this.mesh.position.set(
      Math.cos(this.data.orbitAngle) * this.data.orbitRadius,
      0,
      Math.sin(this.data.orbitAngle) * this.data.orbitRadius
    );

    this.orbit = this.createOrbit();
    this.label = this.createLabel();
  }

  private createOrbit(): THREE.Line {
    const points: THREE.Vector3[] = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * this.data.orbitRadius,
        0,
        Math.sin(angle) * this.data.orbitRadius
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: 0xffffff,
      opacity: 0.3,
      transparent: true,
      dashSize: 0.5,
      gapSize: 0.3
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    return line;
  }

  private createLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 24px sans-serif';
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(this.data.nameCN, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);
    sprite.position.copy(this.mesh.position).add(new THREE.Vector3(0, this.data.radius + 1.2, 0));
    return sprite;
  }

  public updatePosition(): void {
    this.mesh.position.set(
      Math.cos(this.data.orbitAngle) * this.data.orbitRadius,
      0,
      Math.sin(this.data.orbitAngle) * this.data.orbitRadius
    );
    this.label.position.copy(this.mesh.position).add(new THREE.Vector3(0, this.data.radius + 1.2, 0));
  }

  public update(deltaTime: number, speedMultiplier: number, isPlaying: boolean): void {
    if (isPlaying) {
      this.data.orbitAngle += this.data.orbitSpeed * deltaTime * speedMultiplier * 60;
    }
    this.updatePosition();
  }

  public setLabelVisible(visible: boolean): void {
    const material = this.label.material as THREE.SpriteMaterial;
    material.opacity = visible ? 1 : 0;
  }
}

export class SolarSystem {
  public scene: THREE.Scene;
  public sun: THREE.Mesh;
  public sunGlow: THREE.Sprite;
  public planets: Planet[] = [];
  public isPlaying: boolean = true;
  public speedMultiplier: number = 1;

  private sunLight: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.sun = this.createSun();
    this.sunGlow = this.createSunGlow();
    this.sunLight = this.createSunLight();

    this.scene.add(this.sun);
    this.scene.add(this.sunGlow);
    this.scene.add(this.sunLight);

    this.planets = PLANET_DATA.map(data => {
      const planet = new Planet(data);
      this.scene.add(planet.mesh);
      this.scene.add(planet.orbit);
      this.scene.add(planet.label);
      return planet;
    });

    this.createStars();
  }

  private createSun(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(SUN_DATA.radius, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      color: SUN_DATA.color
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { type: 'sun' };
    return mesh;
  }

  private createSunGlow(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 512;
    canvas.height = 512;

    const gradient = context.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, canvas.width / 2
    );
    gradient.addColorStop(0, 'rgba(255, 220, 100, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 180, 50, 0.6)');
    gradient.addColorStop(0.5, 'rgba(255, 120, 30, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 80, 20, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(SUN_DATA.radius * 5, SUN_DATA.radius * 5, 1);
    return sprite;
  }

  private createSunLight(): THREE.PointLight {
    const light = new THREE.PointLight(0xffcc66, 2.5, 300, 1);
    light.position.set(0, 0, 0);
    return light;
  }

  private createStars(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 5000;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      const radius = 150 + Math.random() * 100;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i + 2] = radius * Math.cos(phi);
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.8
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
  }

  public setSpeed(speed: number): void {
    this.speedMultiplier = speed;
  }

  public update(deltaTime: number): void {
    for (const planet of this.planets) {
      planet.update(deltaTime, this.speedMultiplier, this.isPlaying);
    }

    this.sun.rotation.y += 0.001 * deltaTime * 60;
  }

  public getPlanetByName(name: string): Planet | null {
    return this.planets.find(p => p.data.name === name || p.data.nameCN === name) || null;
  }

  public getAllMeshes(): THREE.Mesh[] {
    return [this.sun, ...this.planets.map(p => p.mesh)];
  }
}
