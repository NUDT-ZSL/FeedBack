import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class ForgeScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private objects: Map<string, THREE.Object3D>;
  private updateCallbacks: Array<(delta: number) => void>;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.renderer = new THREE.WebGLRenderer();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.clock = new THREE.Clock();
    this.objects = new Map();
    this.updateCallbacks = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  init(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.scene.background = new THREE.Color(0x1a0a02);
    this.scene.fog = new THREE.Fog(0x1a0a02, 20, 50);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(8, 6, 12);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 20;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };

    this.setupLighting();
    this.createWorkshop();
    this.createFurnace();
    this.createBellows();
    this.createToolRack3D();
    this.createPouringArea();
    this.createQuenchingBucket();
    this.createInspectionTable();

    window.addEventListener('resize', () => this.onResize());
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0x403020, 0.6);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xfff5e6, 1);
    mainLight.position.set(10, 15, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -15;
    mainLight.shadow.camera.right = 15;
    mainLight.shadow.camera.top = 15;
    mainLight.shadow.camera.bottom = -15;
    this.scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x8b6914, 0.4);
    fillLight.position.set(-8, 5, -8);
    this.scene.add(fillLight);

    const furnaceGlow = new THREE.PointLight(0xff4400, 2, 15);
    furnaceGlow.position.set(0, 3, 0);
    furnaceGlow.name = 'furnaceGlow';
    this.scene.add(furnaceGlow);
  }

  private createWorkshop(): void {
    const floorGeo = new THREE.PlaneGeometry(20, 15);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      roughness: 0.9,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.8,
      metalness: 0.1
    });

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 0.3), wallMat);
    backWall.position.set(0, 4, -7.5);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 15), wallMat);
    leftWall.position.set(-10, 4, 0);
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.7,
      metalness: 0.1
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(21, 0.3, 16), roofMat);
    roof.position.set(0, 8, 0);
    this.scene.add(roof);

    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.8,
      metalness: 0.1
    });
    for (let i = -8; i <= 8; i += 4) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 15), beamMat);
      beam.position.set(i, 7.6, 0);
      this.scene.add(beam);
    }
  }

  private createFurnace(): void {
    const furnaceGroup = new THREE.Group();
    furnaceGroup.name = 'furnace';

    const bottomRadius = 1.5;
    const topRadius = 1.2;
    const height = 5;
    const segments = 32;

    const furnaceGeo = new THREE.CylinderGeometry(topRadius, bottomRadius, height, segments);
    const furnaceMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.9,
      metalness: 0.1,
      vertexColors: true
    });

    const colors = new Float32Array(furnaceGeo.attributes.position.count * 3);
    for (let i = 0; i < furnaceGeo.attributes.position.count; i++) {
      const y = furnaceGeo.attributes.position.getY(i);
      const t = (y + height / 2) / height;
      const r = 0.2 + t * 0.45;
      const g = 0.2 + t * 0.05;
      const b = 0.2;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    furnaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const furnaceBody = new THREE.Mesh(furnaceGeo, furnaceMat);
    furnaceBody.position.y = height / 2;
    furnaceBody.castShadow = true;
    furnaceBody.receiveShadow = true;
    furnaceGroup.add(furnaceBody);

    const doorGeo = new THREE.BoxGeometry(0.8, 1.2, 0.2);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x1a0a00,
      roughness: 0.5,
      metalness: 0.8,
      emissive: 0xff2200,
      emissiveIntensity: 0.3
    });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.8, bottomRadius - 0.05);
    furnaceGroup.add(door);

    const doorFrameMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.3
    });
    const doorFrameTop = new THREE.Mesh(new THREE.BoxGeometry(1, 0.15, 0.25), doorFrameMat);
    doorFrameTop.position.set(0, 1.5, bottomRadius - 0.05);
    furnaceGroup.add(doorFrameTop);

    const spoutGeo = new THREE.ConeGeometry(0.3, 0.8, 8);
    const spoutMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.6,
      metalness: 0.7
    });
    const spout = new THREE.Mesh(spoutGeo, spoutMat);
    spout.rotation.x = -Math.PI / 2;
    spout.rotation.z = Math.PI;
    spout.position.set(0.8, 1.5, bottomRadius - 0.1);
    furnaceGroup.add(spout);

    const rimGeo = new THREE.TorusGeometry(topRadius, 0.1, 8, 32);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x5a5a5a,
      roughness: 0.5,
      metalness: 0.8
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = height + 0.05;
    furnaceGroup.add(rim);

    const bricksCount = 20;
    const brickMat = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.8,
      metalness: 0.1
    });
    for (let i = 0; i < bricksCount; i++) {
      const angle = (i / bricksCount) * Math.PI * 2;
      const radius = bottomRadius + 0.15;
      const brick = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.4), brickMat);
      brick.position.set(
        Math.cos(angle) * radius,
        0.15,
        Math.sin(angle) * radius
      );
      brick.rotation.y = -angle;
      brick.castShadow = true;
      furnaceGroup.add(brick);
    }

    this.scene.add(furnaceGroup);
    this.objects.set('furnace', furnaceGroup);

    const platformGeo = new THREE.RingGeometry(0.5, 2.5, 32, 1, 0, Math.PI);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x696969,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.rotation.x = -Math.PI / 2;
    platform.rotation.z = -Math.PI / 2;
    platform.position.set(0, 0.01, 2);
    platform.receiveShadow = true;
    this.scene.add(platform);

    const tempBubble = document.createElement('div');
    tempBubble.className = 'temperature-bubble';
    tempBubble.id = 'temperature-bubble';
    tempBubble.textContent = '800°C';
    tempBubble.style.display = 'none';
    this.container.appendChild(tempBubble);
  }

  private createBellows(): void {
    const bellowsGroup = new THREE.Group();
    bellowsGroup.name = 'bellows';

    const boxGeo = new THREE.BoxGeometry(1.5, 0.8, 1);
    const woodTexture = this.createWoodTexture();
    const boxMat = new THREE.MeshStandardMaterial({
      map: woodTexture,
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.1
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(3, 0.4, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    bellowsGroup.add(box);

    const nozzleGeo = new THREE.ConeGeometry(0.2, 0.6, 8);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.8,
      metalness: 0.2
    });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(2.2, 0.4, 0);
    bellowsGroup.add(nozzle);

    const handleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.6,
      metalness: 0.3
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(4.2, 0.4, 0);
    handle.name = 'bellowsHandle';
    handle.castShadow = true;
    bellowsGroup.add(handle);

    const gripGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x2a1810,
      roughness: 0.5,
      metalness: 0.5
    });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(4.8, 0.4, 0);
    grip.name = 'bellowsGrip';
    grip.castShadow = true;
    bellowsGroup.add(grip);

    const standGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x5a4028,
      roughness: 0.8,
      metalness: 0.1
    });
    const stand1 = new THREE.Mesh(standGeo, standMat);
    stand1.position.set(2.5, 0.3, 0.4);
    stand1.castShadow = true;
    bellowsGroup.add(stand1);
    const stand2 = new THREE.Mesh(standGeo, standMat);
    stand2.position.set(2.5, 0.3, -0.4);
    stand2.castShadow = true;
    bellowsGroup.add(stand2);

    this.scene.add(bellowsGroup);
    this.objects.set('bellows', bellowsGroup);
    this.objects.set('bellowsHandle', handle);
    this.objects.set('bellowsGrip', grip);
  }

  private createWoodTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 50; i++) {
      const y = Math.random() * 256;
      const height = 2 + Math.random() * 4;
      ctx.fillStyle = `rgba(${100 + Math.random() * 30}, ${80 + Math.random() * 30}, ${50 + Math.random() * 30}, 0.5)`;
      ctx.fillRect(0, y, 256, height);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  private createToolRack3D(): void {
    const rackGroup = new THREE.Group();
    rackGroup.name = 'toolRack';
    rackGroup.position.set(7, 0, 3);

    const postGeo = new THREE.BoxGeometry(0.15, 2.5, 0.15);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.8,
      metalness: 0.1
    });
    const post1 = new THREE.Mesh(postGeo, postMat);
    post1.position.set(-0.5, 1.25, 0);
    post1.castShadow = true;
    rackGroup.add(post1);
    const post2 = new THREE.Mesh(postGeo, postMat);
    post2.position.set(0.5, 1.25, 0);
    post2.castShadow = true;
    rackGroup.add(post2);

    const shelfGeo = new THREE.BoxGeometry(1.2, 0.08, 0.6);
    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.1
    });
    const yPositions = [0.6, 1.3, 2];
    yPositions.forEach(y => {
      const shelf = new THREE.Mesh(shelfGeo, shelfMat);
      shelf.position.set(0, y, 0);
      shelf.castShadow = true;
      shelf.receiveShadow = true;
      rackGroup.add(shelf);
    });

    this.scene.add(rackGroup);
    this.objects.set('toolRack', rackGroup);
  }

  private createPouringArea(): void {
    const areaGroup = new THREE.Group();
    areaGroup.name = 'pouringArea';

    const areaGeo = new THREE.CircleGeometry(0.5, 32);
    const areaMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    const area = new THREE.Mesh(areaGeo, areaMat);
    area.rotation.x = -Math.PI / 2;
    area.position.set(2.5, 0.02, 2);
    area.receiveShadow = true;
    areaGroup.add(area);

    const ringGeo = new THREE.RingGeometry(0.45, 0.5, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x8b0000,
      roughness: 0.5,
      metalness: 0.3,
      side: THREE.DoubleSide,
      emissive: 0x8b0000,
      emissiveIntensity: 0.2
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(2.5, 0.03, 2);
    areaGroup.add(ring);

    this.scene.add(areaGroup);
    this.objects.set('pouringArea', areaGroup);
  }

  private createQuenchingBucket(): void {
    const bucketGroup = new THREE.Group();
    bucketGroup.name = 'quenchingBucket';
    bucketGroup.position.set(6, 0, -3);

    const bucketGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.6, 16);
    const bucketMat = new THREE.MeshStandardMaterial({
      color: 0x654321,
      roughness: 0.6,
      metalness: 0.2
    });
    const bucket = new THREE.Mesh(bucketGeo, bucketMat);
    bucket.position.y = 0.3;
    bucket.castShadow = true;
    bucketGroup.add(bucket);

    const hoopGeo = new THREE.TorusGeometry(0.375, 0.04, 8, 32);
    const hoopMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.4,
      metalness: 0.8
    });
    const hoop1 = new THREE.Mesh(hoopGeo, hoopMat);
    hoop1.rotation.x = Math.PI / 2;
    hoop1.position.y = 0.2;
    bucketGroup.add(hoop1);
    const hoop2 = new THREE.Mesh(hoopGeo, hoopMat);
    hoop2.rotation.x = Math.PI / 2;
    hoop2.position.y = 0.5;
    bucketGroup.add(hoop2);

    const waterGeo = new THREE.CircleGeometry(0.33, 32);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.45;
    water.name = 'waterSurface';
    bucketGroup.add(water);

    this.scene.add(bucketGroup);
    this.objects.set('quenchingBucket', bucketGroup);
    this.objects.set('waterSurface', water);
  }

  private createInspectionTable(): void {
    const tableGroup = new THREE.Group();
    tableGroup.name = 'inspectionTable';
    tableGroup.position.set(0, 0, 5);

    const legGeo = new THREE.BoxGeometry(0.15, 0.8, 0.15);
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x5a4028,
      roughness: 0.8,
      metalness: 0.1
    });
    const legPositions = [
      [-0.95, 0.4, 0.45],
      [0.95, 0.4, 0.45],
      [-0.95, 0.4, -0.45],
      [0.95, 0.4, -0.45]
    ];
    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(pos[0], pos[1], pos[2]);
      leg.castShadow = true;
      tableGroup.add(leg);
    });

    const topGeo = new THREE.BoxGeometry(2, 0.08, 1);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.1
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 0.84;
    top.castShadow = true;
    top.receiveShadow = true;
    tableGroup.add(top);

    const clothGeo = new THREE.PlaneGeometry(1.9, 0.9);
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0xaaa9ad,
      roughness: 0.9,
      metalness: 0.05
    });
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = 0.89;
    cloth.receiveShadow = true;
    tableGroup.add(cloth);

    this.scene.add(tableGroup);
    this.objects.set('inspectionTable', tableGroup);
  }

  addObject(name: string, object: THREE.Object3D): void {
    this.objects.set(name, object);
    this.scene.add(object);
  }

  removeObject(name: string): void {
    const object = this.objects.get(name);
    if (object) {
      this.scene.remove(object);
      this.objects.delete(name);
    }
  }

  getObject(name: string): THREE.Object3D | undefined {
    return this.objects.get(name);
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getControls(): OrbitControls {
    return this.controls;
  }

  getRaycaster(): THREE.Raycaster {
    return this.raycaster;
  }

  getMouse(): THREE.Vector2 {
    return this.mouse;
  }

  onUpdate(callback: (delta: number) => void): void {
    this.updateCallbacks.push(callback);
  }

  update(): void {
    const delta = this.clock.getDelta();
    
    this.updateCallbacks.forEach(callback => callback(delta));
    
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  worldToScreen(position: THREE.Vector3): { x: number; y: number } {
    const vector = position.clone();
    vector.project(this.camera);
    
    const rect = this.container.getBoundingClientRect();
    return {
      x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top
    };
  }

  screenToWorld(clientX: number, clientY: number, planeY: number = 0): THREE.Vector3 {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, intersection);
    
    return intersection;
  }
}
