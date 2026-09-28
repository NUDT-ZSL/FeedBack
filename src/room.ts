import * as THREE from 'three';
import { SunPosition, RoomLighting } from './types';

const ROOM_WIDTH = 8;
const ROOM_DEPTH = 6;
const ROOM_HEIGHT = 3;
const WALL_THICKNESS = 0.1;

const WINDOW_WIDTH = 2;
const WINDOW_HEIGHT = 1.5;
const WINDOW_BOTTOM = 0.8;

const L_INSET_X = 3;
const L_INSET_Z = 2;

export class Room {
  public group: THREE.Group;
  private walls: THREE.Mesh[] = [];
  private floors: THREE.Mesh[] = [];
  private ceilings: THREE.Mesh[] = [];
  private windowFrameMeshes: THREE.Mesh[] = [];
  private windowGlass: THREE.Mesh;
  
  private directionalLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private sunLightHelper?: THREE.Mesh;
  
  private gridHelpers: THREE.GridHelper[] = [];
  
  private currentLightDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private targetLightDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  
  private wallMaterial: THREE.MeshStandardMaterial;
  private floorMaterial: THREE.MeshStandardMaterial;
  private windowFrameMaterial: THREE.MeshStandardMaterial;

  private shadowRenderTarget: THREE.WebGLRenderTarget;
  private depthTexture: THREE.DepthTexture;

  constructor() {
    this.group = new THREE.Group();

    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.1
    });

    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1
    });

    this.windowFrameMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.5,
      emissive: 0xffffff,
      emissiveIntensity: 0.2
    });

    this.createFloors();
    this.createCeilings();
    this.createWalls();
    this.createWindow();
    this.createEdgeLines();
    this.createGridHelpers();

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    this.directionalLight.position.set(0, 10, 0);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 1024;
    this.directionalLight.shadow.mapSize.height = 1024;
    this.directionalLight.shadow.camera.near = 0.5;
    this.directionalLight.shadow.camera.far = 50;
    this.directionalLight.shadow.camera.left = -10;
    this.directionalLight.shadow.camera.right = 10;
    this.directionalLight.shadow.camera.top = 10;
    this.directionalLight.shadow.camera.bottom = -10;
    this.directionalLight.shadow.bias = -0.001;
    this.directionalLight.shadow.normalBias = 0.02;

    this.ambientLight = new THREE.AmbientLight(0x404040, 0.3);

    this.group.add(this.directionalLight);
    this.group.add(this.ambientLight);

    const sunGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    const sunMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffff00,
      transparent: true,
      opacity: 0.9
    });
    this.sunLightHelper = new THREE.Mesh(sunGeometry, sunMaterial);
    this.group.add(this.sunLightHelper);

    this.depthTexture = new THREE.DepthTexture(512, 512);
    this.depthTexture.type = THREE.UnsignedShortType;
    
    this.shadowRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
      depthTexture: this.depthTexture,
      depthBuffer: true
    });

    this.group.position.set(0, 0, 0);
  }

  private createFloors(): void {
    const southFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH - L_INSET_Z),
      this.floorMaterial
    );
    southFloor.rotation.x = -Math.PI / 2;
    southFloor.position.z = -L_INSET_Z / 2;
    southFloor.receiveShadow = true;
    this.floors.push(southFloor);
    this.group.add(southFloor);

    const westFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(L_INSET_X, L_INSET_Z),
      this.floorMaterial
    );
    westFloor.rotation.x = -Math.PI / 2;
    westFloor.position.x = -(ROOM_WIDTH / 2 - L_INSET_X / 2);
    westFloor.position.z = (ROOM_DEPTH - L_INSET_Z) / 2;
    westFloor.receiveShadow = true;
    this.floors.push(westFloor);
    this.group.add(westFloor);
  }

  private createCeilings(): void {
    const southCeiling = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH - L_INSET_Z),
      this.wallMaterial.clone()
    );
    southCeiling.rotation.x = Math.PI / 2;
    southCeiling.position.y = ROOM_HEIGHT;
    southCeiling.position.z = -L_INSET_Z / 2;
    this.ceilings.push(southCeiling);
    this.group.add(southCeiling);

    const westCeiling = new THREE.Mesh(
      new THREE.PlaneGeometry(L_INSET_X, L_INSET_Z),
      this.wallMaterial.clone()
    );
    westCeiling.rotation.x = Math.PI / 2;
    westCeiling.position.y = ROOM_HEIGHT;
    westCeiling.position.x = -(ROOM_WIDTH / 2 - L_INSET_X / 2);
    westCeiling.position.z = (ROOM_DEPTH - L_INSET_Z) / 2;
    this.ceilings.push(westCeiling);
    this.group.add(westCeiling);
  }

  private createWalls(): void {
    const wallConfigs = [
      { width: ROOM_WIDTH, height: ROOM_HEIGHT, x: 0, z: -ROOM_DEPTH / 2, rotY: 0 },
      { width: ROOM_DEPTH - L_INSET_Z, height: ROOM_HEIGHT, x: ROOM_WIDTH / 2, z: -L_INSET_Z / 2, rotY: -Math.PI / 2 },
      { width: ROOM_WIDTH - L_INSET_X, height: ROOM_HEIGHT, x: L_INSET_X / 2, z: (ROOM_DEPTH - L_INSET_Z) / 2, rotY: Math.PI },
      { width: L_INSET_Z, height: ROOM_HEIGHT, x: -ROOM_WIDTH / 2 + L_INSET_X, z: (ROOM_DEPTH - L_INSET_Z) / 2 + L_INSET_Z / 2, rotY: -Math.PI / 2 },
      { width: L_INSET_X, height: ROOM_HEIGHT, x: -(ROOM_WIDTH / 2 - L_INSET_X / 2), z: ROOM_DEPTH / 2, rotY: Math.PI },
      { width: ROOM_DEPTH, height: ROOM_HEIGHT, x: -ROOM_WIDTH / 2, z: 0, rotY: Math.PI / 2 }
    ];

    wallConfigs.forEach((config, index) => {
      const geometry = new THREE.PlaneGeometry(config.width, config.height);
      const mesh = new THREE.Mesh(geometry, this.wallMaterial.clone());
      mesh.position.set(config.x, config.height / 2, config.z);
      mesh.rotation.y = config.rotY;
      mesh.receiveShadow = true;
      if (index === 2 || index === 3) {
        mesh.castShadow = true;
      }
      this.walls.push(mesh);
      this.group.add(mesh);
    });
  }

  private createEdgeLines(): void {
    const edgeMaterial = new THREE.LineBasicMaterial({ 
      color: 0x888888, 
      transparent: true, 
      opacity: 0.5 
    });

    const corners = [
      [-ROOM_WIDTH / 2, -ROOM_DEPTH / 2],
      [ROOM_WIDTH / 2, -ROOM_DEPTH / 2],
      [ROOM_WIDTH / 2, (ROOM_DEPTH - L_INSET_Z * 2) / 2],
      [-ROOM_WIDTH / 2 + L_INSET_X, (ROOM_DEPTH - L_INSET_Z * 2) / 2],
      [-ROOM_WIDTH / 2 + L_INSET_X, ROOM_DEPTH / 2],
      [-ROOM_WIDTH / 2, ROOM_DEPTH / 2]
    ];

    for (let i = 0; i < corners.length; i++) {
      const [x, z] = corners[i];
      const points = [
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, ROOM_HEIGHT, z)
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, edgeMaterial);
      this.group.add(line);
    }

    for (let y = 1; y < 3; y++) {
      const yPos = y * (ROOM_HEIGHT / 3);
      const topPoints = corners.map(([x, z]) => new THREE.Vector3(x, yPos, z));
      topPoints.push(topPoints[0]);
      const geometry = new THREE.BufferGeometry().setFromPoints(topPoints);
      const line = new THREE.Line(geometry, edgeMaterial);
      this.group.add(line);
    }

    const bottomPoints = corners.map(([x, z]) => new THREE.Vector3(x, 0, z));
    bottomPoints.push(bottomPoints[0]);
    const bottomGeometry = new THREE.BufferGeometry().setFromPoints(bottomPoints);
    const bottomLine = new THREE.Line(bottomGeometry, edgeMaterial);
    this.group.add(bottomLine);

    const topPoints = corners.map(([x, z]) => new THREE.Vector3(x, ROOM_HEIGHT, z));
    topPoints.push(topPoints[0]);
    const topGeometry = new THREE.BufferGeometry().setFromPoints(topPoints);
    const topLine = new THREE.Line(topGeometry, edgeMaterial);
    this.group.add(topLine);
  }

  private createGridHelpers(): void {
    const southGrid = new THREE.GridHelper(ROOM_WIDTH, 16, 0x666666, 0x444444);
    southGrid.position.y = 0.01;
    southGrid.position.z = -L_INSET_Z / 2;
    southGrid.scale.z = (ROOM_DEPTH - L_INSET_Z) / ROOM_WIDTH;
    (southGrid.material as THREE.Material).transparent = true;
    (southGrid.material as THREE.Material).opacity = 0.3;
    this.gridHelpers.push(southGrid);
    this.group.add(southGrid);

    const westGrid = new THREE.GridHelper(L_INSET_X, 6, 0x666666, 0x444444);
    westGrid.position.y = 0.01;
    westGrid.position.x = -(ROOM_WIDTH / 2 - L_INSET_X / 2);
    westGrid.position.z = (ROOM_DEPTH - L_INSET_Z) / 2;
    westGrid.scale.z = L_INSET_Z / L_INSET_X;
    (westGrid.material as THREE.Material).transparent = true;
    (westGrid.material as THREE.Material).opacity = 0.3;
    this.gridHelpers.push(westGrid);
    this.group.add(westGrid);
  }

  private createWindow(): void {
    const windowGroup = new THREE.Group();
    
    const frameThickness = 0.08;
    
    const topFrame = new THREE.Mesh(
      new THREE.BoxGeometry(WINDOW_WIDTH + frameThickness * 2, frameThickness, frameThickness),
      this.windowFrameMaterial
    );
    topFrame.position.y = WINDOW_BOTTOM + WINDOW_HEIGHT + frameThickness / 2;
    
    const bottomFrame = new THREE.Mesh(
      new THREE.BoxGeometry(WINDOW_WIDTH + frameThickness * 2, frameThickness, frameThickness),
      this.windowFrameMaterial
    );
    bottomFrame.position.y = WINDOW_BOTTOM - frameThickness / 2;
    
    const leftFrame = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, WINDOW_HEIGHT + frameThickness * 2, frameThickness),
      this.windowFrameMaterial
    );
    leftFrame.position.set(-WINDOW_WIDTH / 2 - frameThickness / 2, WINDOW_BOTTOM + WINDOW_HEIGHT / 2, 0);
    
    const rightFrame = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, WINDOW_HEIGHT + frameThickness * 2, frameThickness),
      this.windowFrameMaterial
    );
    rightFrame.position.set(WINDOW_WIDTH / 2 + frameThickness / 2, WINDOW_BOTTOM + WINDOW_HEIGHT / 2, 0);

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.9,
      thickness: 0.05
    });

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(WINDOW_WIDTH, WINDOW_HEIGHT),
      glassMaterial
    );
    glass.position.y = WINDOW_BOTTOM + WINDOW_HEIGHT / 2;

    windowGroup.add(topFrame, bottomFrame, leftFrame, rightFrame, glass);
    windowGroup.position.z = -ROOM_DEPTH / 2 + 0.01;
    windowGroup.position.y = 0;

    this.windowFrameMeshes.push(topFrame, bottomFrame, leftFrame, rightFrame);
    this.windowGlass = glass;

    this.group.add(windowGroup);
  }

  public updateLight(sunPosition: SunPosition, deltaTime: number): void {
    const dir = sunPosition.direction;
    this.targetLightDirection.set(dir.x, dir.y, dir.z).normalize();

    this.currentLightDirection.lerp(this.targetLightDirection, Math.min(deltaTime * 3, 1));
    this.currentLightDirection.normalize();

    const sunDistance = 20;
    this.directionalLight.position.copy(this.currentLightDirection).multiplyScalar(sunDistance);
    this.directionalLight.position.y = Math.max(this.directionalLight.position.y, 1);

    if (this.sunLightHelper) {
      this.sunLightHelper.position.copy(this.currentLightDirection).multiplyScalar(15);
    }

    const elevation = sunPosition.elevation;
    const intensityScale = Math.max(0, Math.sin((elevation * Math.PI) / 180));
    
    const warmColor = new THREE.Color(0xffddaa);
    const coolColor = new THREE.Color(0xffffff);
    const elevationFactor = Math.max(0, Math.min(1, elevation / 60));
    const lightColor = coolColor.clone().lerp(warmColor, 1 - elevationFactor);
    this.directionalLight.color = lightColor;
    
    this.directionalLight.intensity = 1.5 * intensityScale;

    const ambientBase = 0.2;
    const ambientSunlight = 0.3 * intensityScale;
    this.ambientLight.intensity = ambientBase + ambientSunlight;
    this.ambientLight.color.setHSL(0.6, 0.3, 0.3 + intensityScale * 0.2);

    const windowEmissive = 0.1 + intensityScale * 0.4;
    this.windowFrameMaterial.emissiveIntensity = windowEmissive;
  }

  public calculateLighting(): RoomLighting {
    const dirLen = this.currentLightDirection.length();
    const sunVector = dirLen > 0 ? this.currentLightDirection.clone().normalize() : new THREE.Vector3(0, 1, 0);
    
    const windowNormal = new THREE.Vector3(0, 0, -1);
    
    let dotProduct = sunVector.dot(windowNormal);
    dotProduct = Math.max(0, dotProduct);
    
    const windowIllumination = Math.min(100, dotProduct * 100 * 1.5);
    
    const elevation = Math.max(0, Math.min(90, Math.asin(Math.max(-1, Math.min(1, sunVector.y))) * 180 / Math.PI));
    const elevationFactor = Math.sin((elevation * Math.PI) / 180);
    
    const baseIlluminance = 500;
    const maxIlluminance = 5000;
    const avgIlluminance = baseIlluminance + (maxIlluminance - baseIlluminance) * elevationFactor * dotProduct;
    
    const shadowRatio = Math.min(80, 60 + (1 - elevationFactor) * 40 - dotProduct * 30);
    const finalShadowRatio = Math.max(10, Math.min(95, shadowRatio));

    return {
      windowIllumination: Math.round(windowIllumination * 10) / 10,
      avgIlluminance: Math.round(avgIlluminance),
      shadowRatio: Math.round(finalShadowRatio)
    };
  }

  public getSunScreenPosition(): { x: number; y: number } {
    const dir = this.currentLightDirection;
    const elevation = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    let azimuth = Math.atan2(dir.x, dir.z);
    
    const r = 1 - (elevation / (Math.PI / 2));
    const theta = azimuth - Math.PI / 2;
    
    return {
      x: 0.5 + r * Math.cos(theta) * 0.45,
      y: 0.5 + r * Math.sin(theta) * 0.45
    };
  }

  public dispose(): void {
    this.wallMaterial.dispose();
    this.floorMaterial.dispose();
    this.windowFrameMaterial.dispose();
    this.shadowRenderTarget.dispose();
    this.depthTexture.dispose();
    this.directionalLight.dispose();
    this.ambientLight.dispose();
  }
}
