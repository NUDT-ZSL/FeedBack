import * as THREE from 'three';
import { Herb } from './Herb';

interface TerrainData {
  mesh: THREE.Group;
  herbs: Herb[];
  herbPositions: THREE.Vector3[];
}

export class TerrainGenerator {
  private size: number;
  private resolution: number;

  constructor(size: number = 100, resolution: number = 64) {
    this.size = size;
    this.resolution = resolution;
  }

  public generate(): TerrainData {
    const terrainGroup = new THREE.Group();

    const ground = this.createGround();
    terrainGroup.add(ground);

    const mountains = this.createMountains();
    terrainGroup.add(mountains);

    const stream = this.createStream();
    terrainGroup.add(stream);

    const { herbs, positions } = this.createHerbs();
    herbs.forEach(herb => terrainGroup.add(herb.getMesh()));

    const fog = new THREE.Fog(0x1a2a1a, 20, 80);
    terrainGroup.userData.fog = fog;

    return {
      mesh: terrainGroup,
      herbs,
      herbPositions: positions
    };
  }

  private createGround(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.resolution, this.resolution);
    const positions = geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const height = this.getTerrainHeight(x, y);
      positions[i + 2] = height;
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x2e4a32,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: false
    });

    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';

    return ground;
  }

  private getTerrainHeight(x: number, z: number): number {
    let height = 0;
    
    height += Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2;
    height += Math.sin(x * 0.02 + 1) * Math.cos(z * 0.03) * 3;
    height += Math.sin(x * 0.1) * 0.5;
    
    const distFromCenter = Math.sqrt(x * x + z * z);
    if (distFromCenter > this.size * 0.35) {
      height += (distFromCenter - this.size * 0.35) * 0.15;
    }
    
    return height;
  }

  private createMountains(): THREE.Group {
    const mountains = new THREE.Group();
    const mountainPositions = [
      { x: -35, z: -35, scale: 1.2 },
      { x: 35, z: -30, scale: 1.0 },
      { x: -30, z: 35, scale: 1.1 },
      { x: 30, z: 30, scale: 0.9 },
      { x: 0, z: -40, scale: 1.3 }
    ];

    mountainPositions.forEach(pos => {
      const mountain = this.createSingleMountain(pos.scale);
      mountain.position.set(pos.x, 0, pos.z);
      mountains.add(mountain);
    });

    return mountains;
  }

  private createSingleMountain(scale: number): THREE.Group {
    const mountain = new THREE.Group();
    
    const geometry = new THREE.ConeGeometry(12 * scale, 25 * scale, 8);
    const positions = geometry.attributes.position.array as Float32Array;
    
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += (Math.random() - 0.5) * 2 * scale;
      positions[i + 2] += (Math.random() - 0.5) * 2 * scale;
    }
    
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x3d5c4a,
      roughness: 0.95,
      metalness: 0.05
    });
    
    const cone = new THREE.Mesh(geometry, material);
    cone.position.y = 12 * scale;
    cone.castShadow = true;
    mountain.add(cone);

    const snowGeometry = new THREE.ConeGeometry(4 * scale, 8 * scale, 8);
    const snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5e6d0,
      roughness: 0.8
    });
    const snow = new THREE.Mesh(snowGeometry, snowMaterial);
    snow.position.y = 23 * scale;
    mountain.add(snow);

    return mountain;
  }

  private createStream(): THREE.Group {
    const streamGroup = new THREE.Group();
    
    const streamLength = 60;
    const streamWidth = 4;
    
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const x = -30 + t * 60;
      const z = Math.sin(t * Math.PI * 1.5) * 8;
      const y = this.getTerrainHeight(x, z) + 0.05;
      points.push(new THREE.Vector3(x, y, z));
    }

    const streamShape = new THREE.Shape();
    const halfWidth = streamWidth / 2;
    
    for (let i = 0; i < points.length; i++) {
      const p1 = points[Math.max(0, i - 1)];
      const p2 = points[i];
      const p3 = points[Math.min(points.length - 1, i + 1)];
      
      const tangent = new THREE.Vector3()
        .subVectors(p3, p1)
        .normalize();
      
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
        .multiplyScalar(halfWidth);
      
      if (i === 0) {
        streamShape.moveTo(p2.x - normal.x, p2.z - normal.z);
      } else {
        streamShape.lineTo(p2.x - normal.x, p2.z - normal.z);
      }
    }
    
    for (let i = points.length - 1; i >= 0; i--) {
      const p1 = points[Math.max(0, i - 1)];
      const p2 = points[i];
      const p3 = points[Math.min(points.length - 1, i + 1)];
      
      const tangent = new THREE.Vector3()
        .subVectors(p3, p1)
        .normalize();
      
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x)
        .multiplyScalar(halfWidth);
      
      streamShape.lineTo(p2.x + normal.x, p2.z + normal.z);
    }

    const geometry = new THREE.ShapeGeometry(streamShape);
    geometry.rotateX(-Math.PI / 2);
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a90b8,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
      metalness: 0.3
    });

    const streamMesh = new THREE.Mesh(geometry, material);
    streamMesh.name = 'stream';
    streamMesh.userData = { animationTime: 0, flowSpeed: 0.5 };
    streamGroup.add(streamMesh);

    return streamGroup;
  }

  private createHerbs(): { herbs: Herb[]; positions: THREE.Vector3[] } {
    const herbs: Herb[] = [];
    const positions: THREE.Vector3[] = [];
    const herbCount = 25;

    for (let i = 0; i < herbCount; i++) {
      let x, z, height;
      let validPosition = false;
      let attempts = 0;

      while (!validPosition && attempts < 50) {
        x = (Math.random() - 0.5) * (this.size - 20);
        z = (Math.random() - 0.5) * (this.size - 20);
        height = this.getTerrainHeight(x, z);
        
        const distFromStream = Math.abs(z - Math.sin((x + 30) / 60 * Math.PI * 1.5) * 8);
        const distFromCenter = Math.sqrt(x * x + z * z);
        
        if (distFromStream > 3 && distFromCenter < this.size * 0.4 && height < 5) {
          validPosition = true;
        }
        attempts++;
      }

      if (validPosition) {
        const position = new THREE.Vector3(x!, height + 0.05, z!);
        const herb = new Herb(position);
        herbs.push(herb);
        positions.push(position);
      }
    }

    return { herbs, positions };
  }

  public updateStreamAnimation(mesh: THREE.Object3D, deltaTime: number): void {
    if (mesh.name === 'stream') {
      mesh.userData.animationTime += deltaTime;
      const offset = (mesh.userData.animationTime * mesh.userData.flowSpeed) % 1;
      if (mesh instanceof THREE.Mesh) {
        (mesh.material as THREE.MeshStandardMaterial).opacity = 0.6 + Math.sin(offset * Math.PI * 2) * 0.1;
      }
    }
  }

  public getHeightAt(x: number, z: number): number {
    return this.getTerrainHeight(x, z);
  }
}
