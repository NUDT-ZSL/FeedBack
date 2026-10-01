import * as THREE from 'three';

export interface WaterParams {
  temperature: number;
  lightIntensity: number;
  turbidity: number;
}

export class EnvironmentManager {
  public scene: THREE.Scene;
  public params: WaterParams;
  public ambientLight!: THREE.AmbientLight;
  public directionalLight!: THREE.DirectionalLight;
  public waterParticles!: THREE.Points;
  public sandGround!: THREE.Mesh;
  public jellyfish: THREE.Group[] = [];
  public jellyfishLights: THREE.PointLight[] = [];
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoveredJellyfish: THREE.Group | null = null;
  private baseJellyfishScales: number[] = [];
  private baseLightIntensities: number[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.params = {
      temperature: 25,
      lightIntensity: 80,
      turbidity: 10,
    };
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupLights();
    this.setupFog();
    this.setupSandGround();
    this.setupWaterParticles();
    this.setupJellyfish();
    this.setupMouseEvents();
  }

  private setupLights(): void {
    this.ambientLight = new THREE.AmbientLight(0x88ccff, 0.5 * (this.params.lightIntensity / 100));
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0 * (this.params.lightIntensity / 100));
    this.directionalLight.position.set(-20, 40, -10);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.directionalLight.shadow.camera.near = 0.5;
    this.directionalLight.shadow.camera.far = 100;
    this.directionalLight.shadow.camera.left = -30;
    this.directionalLight.shadow.camera.right = 30;
    this.directionalLight.shadow.camera.top = 30;
    this.directionalLight.shadow.camera.bottom = -30;
    this.scene.add(this.directionalLight);
  }

  private setupFog(): void {
    const fogDensity = 0.01 + (this.params.turbidity / 100) * 0.05;
    this.scene.fog = new THREE.FogExp2(0x001a33, fogDensity);
  }

  private setupSandGround(): void {
    const size = 60;
    const segments = 60;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const noise = (Math.sin(x * 0.5) + Math.cos(z * 0.5)) * 0.3 + (Math.random() - 0.5) * 0.2;
      positions.setY(i, noise);
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xc2b280,
      roughness: 0.9,
      metalness: 0.0,
    });

    this.sandGround = new THREE.Mesh(geometry, material);
    this.sandGround.receiveShadow = true;
    this.sandGround.position.y = -0.5;
    this.scene.add(this.sandGround);
  }

  private setupWaterParticles(): void {
    const particleCount = 500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 50 - 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0x88ddff,
      size: 0.1,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true,
    });

    this.waterParticles = new THREE.Points(geometry, material);
    this.scene.add(this.waterParticles);
  }

  private setupJellyfish(): void {
    const colors = [0xff80ab, 0x80deea, 0xce93d8];

    for (let i = 0; i < 20; i++) {
      const jellyfishGroup = new THREE.Group();
      const color = colors[Math.floor(Math.random() * colors.length)];

      const bellGeometry = new THREE.SphereGeometry(0.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const bellMaterial = new THREE.MeshPhongMaterial({
        color: color,
        transparent: true,
        opacity: 0.6,
        emissive: color,
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide,
      });
      const bell = new THREE.Mesh(bellGeometry, bellMaterial);
      jellyfishGroup.add(bell);

      const ringGeometry = new THREE.TorusGeometry(0.6, 0.05, 8, 24);
      const ringMaterial = new THREE.MeshPhongMaterial({
        color: color,
        transparent: true,
        opacity: 0.8,
        emissive: color,
        emissiveIntensity: 0.4,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.05;
      jellyfishGroup.add(ring);

      const trailCount = 40;
      const trailGeometry = new THREE.BufferGeometry();
      const trailPositions = new Float32Array(trailCount * 3);
      for (let t = 0; t < trailCount; t++) {
        const angle = (t / trailCount) * Math.PI * 2;
        trailPositions[t * 3] = Math.cos(angle) * 0.2;
        trailPositions[t * 3 + 1] = -0.5 - t * 0.05;
        trailPositions[t * 3 + 2] = Math.sin(angle) * 0.2;
      }
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
      const trailMaterial = new THREE.PointsMaterial({
        color: color,
        size: 0.08,
        transparent: true,
        opacity: 0.5,
      });
      const trail = new THREE.Points(trailGeometry, trailMaterial);
      jellyfishGroup.add(trail);

      const baseScale = 0.8 + Math.random() * 0.8;
      jellyfishGroup.scale.set(baseScale, baseScale, baseScale);
      this.baseJellyfishScales.push(baseScale);

      const angle = Math.random() * Math.PI * 2;
      const radius = 5 + Math.random() * 15;
      jellyfishGroup.position.set(
        Math.cos(angle) * radius,
        5 + Math.random() * 20,
        Math.sin(angle) * radius
      );
      jellyfishGroup.userData = {
        baseY: jellyfishGroup.position.y,
        bobPeriod: 3 + Math.random() * 3,
        bobPhase: Math.random() * Math.PI * 2,
        trail: trail,
        bell: bell,
      };

      this.scene.add(jellyfishGroup);
      this.jellyfish.push(jellyfishGroup);

      const light = new THREE.PointLight(color, 0.5, 8);
      light.position.copy(jellyfishGroup.position);
      this.scene.add(light);
      this.jellyfishLights.push(light);
      this.baseLightIntensities.push(0.5);
    }
  }

  private setupMouseEvents(): void {
    window.addEventListener('mousemove', (event) => {
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    });
  }

  public setTemperature(value: number): void {
    this.params.temperature = value;
  }

  public setLightIntensity(value: number): void {
    this.params.lightIntensity = value;
    this.ambientLight.intensity = 0.5 * (value / 100);
    this.directionalLight.intensity = 1.0 * (value / 100);
  }

  public setTurbidity(value: number): void {
    this.params.turbidity = value;
    if (this.scene.fog instanceof THREE.FogExp2) {
      const fogDensity = 0.01 + (value / 100) * 0.05;
      this.scene.fog.density = fogDensity;
    }
    const opacity = Math.max(0.2, 0.4 - (value / 100) * 0.3);
    (this.waterParticles.material as THREE.PointsMaterial).opacity = opacity;
  }

  public checkJellyfishHover(camera: THREE.Camera): void {
    this.raycaster.setFromCamera(this.mouse, camera);
    const intersects = this.raycaster.intersectObjects(
      this.jellyfish.map(j => j.userData.bell),
      false
    );

    if (this.hoveredJellyfish) {
      const idx = this.jellyfish.indexOf(this.hoveredJellyfish);
      if (idx !== -1) {
        const baseScale = this.baseJellyfishScales[idx];
        this.hoveredJellyfish.scale.lerp(new THREE.Vector3(baseScale, baseScale, baseScale), 0.1);
        this.jellyfishLights[idx].intensity += (this.baseLightIntensities[idx] - this.jellyfishLights[idx].intensity) * 0.1;
      }
      this.hoveredJellyfish = null;
    }

    if (intersects.length > 0) {
      const bell = intersects[0].object;
      const jellyfish = this.jellyfish.find(j => j.userData.bell === bell);
      if (jellyfish) {
        this.hoveredJellyfish = jellyfish;
        const idx = this.jellyfish.indexOf(jellyfish);
        const baseScale = this.baseJellyfishScales[idx];
        const targetScale = baseScale * 1.5;
        jellyfish.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
        this.jellyfishLights[idx].intensity += (this.baseLightIntensities[idx] * 2 - this.jellyfishLights[idx].intensity) * 0.1;
      }
    }
  }

  public update(delta: number, time: number): void {
    const positions = this.waterParticles.geometry.attributes.position as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    for (let i = 0; i < positions.count; i++) {
      arr[i * 3 + 1] += delta * 0.5;
      if (arr[i * 3 + 1] > 50) {
        arr[i * 3 + 1] = -5;
      }
    }
    positions.needsUpdate = true;

    for (let i = 0; i < this.jellyfish.length; i++) {
      const jf = this.jellyfish[i];
      const bobY = jf.userData.baseY + Math.sin(time / jf.userData.bobPeriod + jf.userData.bobPhase) * 1.0;
      jf.position.y = bobY;
      jf.rotation.y += delta * 0.2;

      this.jellyfishLights[i].position.copy(jf.position);

      const trail = jf.userData.trail;
      const trailPos = trail.geometry.attributes.position as THREE.BufferAttribute;
      const trailArr = trailPos.array as Float32Array;
      for (let t = 0; t < trailArr.length / 3; t++) {
        trailArr[t * 3] += Math.sin(time * 2 + t) * 0.002;
        trailArr[t * 3 + 2] += Math.cos(time * 2 + t) * 0.002;
      }
      trailPos.needsUpdate = true;
    }
  }

  public getJellyfishMeshes(): THREE.Mesh[] {
    return this.jellyfish.map(j => j.userData.bell);
  }
}
