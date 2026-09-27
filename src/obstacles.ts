import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { HammerData, FireColumnData, ElevatorData, StarData, SurfaceType } from './level';

export class Hammer {
  group: THREE.Group;
  body: CANNON.Body;
  armLength: number;
  rotationSpeed: number;
  angle: number = 0;
  headRadius: number = 0.5;

  constructor(scene: THREE.Scene, world: CANNON.World, data: HammerData) {
    this.armLength = data.armLength;
    this.rotationSpeed = data.rotationSpeed;

    this.group = new THREE.Group();
    this.group.position.set(...data.position);

    const pivotGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 12);
    const pivotMat = new THREE.MeshStandardMaterial({ color: 0x444455, metalness: 0.8, roughness: 0.3 });
    const pivot = new THREE.Mesh(pivotGeo, pivotMat);
    this.group.add(pivot);

    const armGeo = new THREE.BoxGeometry(0.12, 0.12, this.armLength);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x666677, metalness: 0.7, roughness: 0.4 });
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.z = -this.armLength / 2;
    this.group.add(arm);

    const headGeo = new THREE.SphereGeometry(this.headRadius, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      metalness: 0.5,
      roughness: 0.5,
      emissive: 0x882222,
      emissiveIntensity: 0.3
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.z = -this.armLength;
    head.castShadow = true;
    this.group.add(head);

    scene.add(this.group);

    const shape = new CANNON.Sphere(this.headRadius);
    this.body = new CANNON.Body({
      mass: 0,
      shape,
      position: new CANNON.Vec3(
        data.position[0],
        data.position[1],
        data.position[2] - this.armLength
      ),
      material: new CANNON.Material('hammer')
    });
    this.body.userData = { type: 'hammer' };
    world.addBody(this.body);
  }

  update(dt: number): void {
    this.angle += this.rotationSpeed * dt;
    this.group.rotation.y = this.angle;

    const headWorldPos = new THREE.Vector3(0, 0, -this.armLength);
    headWorldPos.applyQuaternion(this.group.quaternion);
    headWorldPos.add(this.group.position);

    this.body.position.set(headWorldPos.x, headWorldPos.y, headWorldPos.z);
  }
}

export class FireColumn {
  group: THREE.Group;
  body: CANNON.Body;
  flameMesh?: THREE.Mesh;
  interval: number;
  timer: number = 0;
  active: boolean = false;
  flameHeight: number = 3;

  constructor(scene: THREE.Scene, world: CANNON.World, data: FireColumnData) {
    this.interval = data.interval;
    this.timer = Math.random() * data.interval;

    this.group = new THREE.Group();
    this.group.position.set(...data.position);

    const baseGeo = new THREE.CylinderGeometry(0.4, 0.5, 0.4, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.8,
      roughness: 0.3
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.2;
    base.castShadow = true;
    this.group.add(base);

    const nozzleGeo = new THREE.CylinderGeometry(0.15, 0.25, 0.2, 12);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x222233,
      metalness: 0.9,
      roughness: 0.2
    });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.position.y = 0.1;
    this.group.add(nozzle);

    const flameGeo = new THREE.ConeGeometry(0.6, this.flameHeight, 16, 1, true);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff3300,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.flameMesh = new THREE.Mesh(flameGeo, flameMat);
    this.flameMesh.position.y = this.flameHeight / 2 + 0.2;
    this.flameMesh.visible = false;
    this.group.add(this.flameMesh);

    const innerFlameGeo = new THREE.ConeGeometry(0.3, this.flameHeight * 0.7, 16, 1, true);
    const innerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const innerFlame = new THREE.Mesh(innerFlameGeo, innerFlameMat);
    innerFlame.position.y = this.flameHeight * 0.35 + 0.2;
    innerFlame.visible = false;
    this.flameMesh.add(innerFlame);

    scene.add(this.group);

    const shape = new CANNON.Cylinder(0.5, 0.5, this.flameHeight + 0.5, 16);
    this.body = new CANNON.Body({
      mass: 0,
      shape,
      position: new CANNON.Vec3(
        data.position[0],
        data.position[1] + this.flameHeight / 2,
        data.position[2]
      ),
      material: new CANNON.Material('fire'),
      isTrigger: true
    });
    this.body.userData = { type: 'fire', active: false };
    world.addBody(this.body);
  }

  update(dt: number): void {
    this.timer += dt;

    if (this.timer >= this.interval) {
      this.timer = 0;
      this.active = !this.active;
      if (this.flameMesh) this.flameMesh.visible = this.active;
      (this.body.userData as any).active = this.active;

      if (this.active) {
        setTimeout(() => {
          if (this.flameMesh) this.flameMesh.visible = false;
          (this.body.userData as any).active = false;
          this.active = false;
        }, 800);
      }
    }

    if (this.active && this.flameMesh) {
      const s = 0.95 + Math.sin(this.timer * 20) * 0.05;
      this.flameMesh.scale.set(s, 1, s);
      const mat = this.flameMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + Math.sin(this.timer * 15) * 0.1;
    }
  }
}

export class Elevator {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  minHeight: number;
  maxHeight: number;
  speed: number;
  baseY: number;
  direction: number = 1;
  prevPosition: CANNON.Vec3;

  constructor(scene: THREE.Scene, world: CANNON.World, data: ElevatorData, surface: SurfaceType = 'metal') {
    this.minHeight = data.minHeight;
    this.maxHeight = data.maxHeight;
    this.speed = data.speed;
    this.baseY = data.position[1];
    this.prevPosition = new CANNON.Vec3(...data.position);

    let color: number, metalness: number, roughness: number;
    if (surface === 'sand') { color = 0xc9a96a; metalness = 0; roughness = 0.9; }
    else if (surface === 'ice') { color = 0x9ec6e0; metalness = 0.1; roughness = 0.05; }
    else { color = 0x5a5a6a; metalness = 0.8; roughness = 0.3; }

    const geo = new THREE.BoxGeometry(...data.size);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(...data.position);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xff8c00, transparent: true, opacity: 0.6 });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    this.mesh.add(edges);

    scene.add(this.mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(data.size[0] / 2, data.size[1] / 2, data.size[2] / 2));
    this.body = new CANNON.Body({
      mass: 0,
      shape,
      position: new CANNON.Vec3(...data.position),
      material: new CANNON.Material('elevator'),
      type: CANNON.Body.KINEMATIC
    });
    this.body.userData = { type: 'surface', surface };
    world.addBody(this.body);
  }

  update(dt: number): void {
    let y = this.body.position.y + this.direction * this.speed * dt;

    if (y > this.baseY + this.maxHeight) {
      y = this.baseY + this.maxHeight;
      this.direction = -1;
    } else if (y < this.baseY + this.minHeight) {
      y = this.baseY + this.minHeight;
      this.direction = 1;
    }

    this.prevPosition.copy(this.body.position);
    this.body.position.set(this.body.position.x, y, this.body.position.z);
    this.mesh.position.copy(this.body.position as any);
  }
}

export class Star {
  mesh: THREE.Group;
  body: CANNON.Body;
  index: number;
  collected: boolean = false;

  constructor(scene: THREE.Scene, world: CANNON.World, data: StarData, index: number) {
    this.index = index;

    this.mesh = new THREE.Group();
    this.mesh.position.set(...data.position);

    const starShape = new THREE.Shape();
    const spikes = 5;
    const outerRadius = 0.4;
    const innerRadius = 0.18;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerRadius : innerRadius;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) starShape.moveTo(x, y);
      else starShape.lineTo(x, y);
    }
    starShape.closePath();

    const extrudeSettings = { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 };
    const starGeo = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    starGeo.center();

    const starMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0xffaa00,
      emissiveIntensity: 0.5
    });
    const starMesh = new THREE.Mesh(starGeo, starMat);
    starMesh.castShadow = true;
    this.mesh.add(starMesh);

    const glowGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.15,
      depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    this.mesh.add(glow);

    const light = new THREE.PointLight(0xffd700, 0.8, 4);
    this.mesh.add(light);

    scene.add(this.mesh);

    const shape = new CANNON.Sphere(0.45);
    this.body = new CANNON.Body({
      mass: 0,
      shape,
      position: new CANNON.Vec3(...data.position),
      material: new CANNON.Material('star'),
      isTrigger: true
    });
    this.body.userData = { type: 'star', index, mesh: this.mesh };
    world.addBody(this.body);
  }

  update(dt: number, time: number): void {
    if (this.collected) return;
    this.mesh.rotation.y += dt * 2;
    this.mesh.position.y += Math.sin(time * 3 + this.index) * dt * 0.1;
  }
}

export class Gate {
  group: THREE.Group;
  body: CANNON.Body;
  opening: boolean = false;
  openProgress: number = 0;
  startY: number;
  targetY: number;

  constructor(scene: THREE.Scene, world: CANNON.World, position: [number, number, number]) {
    this.startY = position[1];
    this.targetY = position[1] + 4;

    this.group = new THREE.Group();
    this.group.position.set(...position);

    const frameGeo = new THREE.BoxGeometry(0.3, 4, 0.3);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x444455,
      metalness: 0.9,
      roughness: 0.2
    });
    const leftFrame = new THREE.Mesh(frameGeo, frameMat);
    leftFrame.position.set(-1.3, 0, 0);
    this.group.add(leftFrame);
    const rightFrame = new THREE.Mesh(frameGeo, frameMat);
    rightFrame.position.set(1.3, 0, 0);
    this.group.add(rightFrame);

    const topGeo = new THREE.BoxGeometry(3, 0.3, 0.3);
    const top = new THREE.Mesh(topGeo, frameMat);
    top.position.set(0, 2, 0);
    this.group.add(top);

    const bars: THREE.Mesh[] = [];
    const barMat = new THREE.MeshStandardMaterial({
      color: 0x666677,
      metalness: 0.8,
      roughness: 0.3
    });
    for (let i = 0; i < 5; i++) {
      const barGeo = new THREE.BoxGeometry(0.15, 3.8, 0.15);
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(-1 + i * 0.5, -0.1, 0);
      this.group.add(bar);
      bars.push(bar);
    }
    for (let i = 0; i < 3; i++) {
      const hbarGeo = new THREE.BoxGeometry(2.5, 0.12, 0.12);
      const hbar = new THREE.Mesh(hbarGeo, barMat);
      hbar.position.set(0, -1.5 + i * 1.5, 0);
      this.group.add(hbar);
    }

    scene.add(this.group);

    const shape = new CANNON.Box(new CANNON.Vec3(1.5, 2, 0.2));
    this.body = new CANNON.Body({
      mass: 0,
      shape,
      position: new CANNON.Vec3(...position),
      material: new CANNON.Material('gate')
    });
    this.body.userData = { type: 'gate' };
    world.addBody(this.body);
  }

  open(): void {
    if (this.opening) return;
    this.opening = true;
  }

  update(dt: number): void {
    if (this.opening && this.openProgress < 1) {
      this.openProgress = Math.min(1, this.openProgress + dt / 2);
      const y = this.startY + (this.targetY - this.startY) * this.openProgress;
      this.group.position.y = y;
      this.body.position.y = y;
    }
  }
}

export class HiddenPath {
  group: THREE.Group;
  goalBody?: CANNON.Body;

  constructor(scene: THREE.Scene, world: CANNON.World, start: [number, number, number], end: [number, number, number]) {
    this.group = new THREE.Group();

    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);

    const wallHeight = 2.5;
    const pathWidth = 3;

    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x2266ff,
      transparent: true,
      opacity: 0.3,
      wireframe: true,
      side: THREE.DoubleSide
    });
    const solidMat = new THREE.MeshBasicMaterial({
      color: 0x001144,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });

    const leftWallGeo = new THREE.PlaneGeometry(length, wallHeight);
    const leftWall = new THREE.Mesh(leftWallGeo, solidMat);
    leftWall.position.set(-pathWidth / 2, wallHeight / 2, length / 2);
    leftWall.rotation.y = Math.PI / 2;
    this.group.add(leftWall);

    const leftWallWire = new THREE.Mesh(leftWallGeo.clone(), wallMat);
    leftWallWire.position.copy(leftWall.position);
    leftWallWire.rotation.copy(leftWall.rotation);
    this.group.add(leftWallWire);

    const rightWall = new THREE.Mesh(leftWallGeo.clone(), solidMat);
    rightWall.position.set(pathWidth / 2, wallHeight / 2, length / 2);
    rightWall.rotation.y = -Math.PI / 2;
    this.group.add(rightWall);

    const rightWallWire = new THREE.Mesh(leftWallGeo.clone(), wallMat);
    rightWallWire.position.copy(rightWall.position);
    rightWallWire.rotation.copy(rightWall.rotation);
    this.group.add(rightWallWire);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const ceilGeo = new THREE.PlaneGeometry(length, pathWidth);
    const ceil = new THREE.Mesh(ceilGeo, glowMat);
    ceil.position.set(0, wallHeight, length / 2);
    ceil.rotation.x = -Math.PI / 2;
    this.group.add(ceil);

    this.group.position.set(start[0], start[1], start[2]);
    this.group.rotation.y = -angle;
    scene.add(this.group);

    const goalShape = new CANNON.Sphere(1);
    this.goalBody = new CANNON.Body({
      mass: 0,
      shape: goalShape,
      position: new CANNON.Vec3(end[0], end[1] + 1, end[2]),
      isTrigger: true
    });
    this.goalBody.userData = { type: 'goal', hiddenPath: true };
    world.addBody(this.goalBody);

    const markerGeo = new THREE.RingGeometry(0.8, 1.2, 32);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(end[0], end[1] + 0.1, end[2]);
    marker.rotation.x = -Math.PI / 2;
    scene.add(marker);
  }

  update(dt: number, time: number): void {
    this.group.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        if (child.material.wireframe) {
          child.material.opacity = 0.3 + Math.sin(time * 4) * 0.1;
        }
      }
    });
  }
}

export class Goal {
  group: THREE.Group;
  body: CANNON.Body;

  constructor(scene: THREE.Scene, world: CANNON.World, position: [number, number, number]) {
    this.group = new THREE.Group();
    this.group.position.set(...position);

    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 3, 8);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.9,
      roughness: 0.2
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 1.5;
    this.group.add(pole);

    const flagGeo = new THREE.PlaneGeometry(1, 0.7);
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xff8c00,
      side: THREE.DoubleSide,
      metalness: 0.3,
      roughness: 0.5,
      emissive: 0x884400,
      emissiveIntensity: 0.2
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.5, 2.5, 0);
    this.group.add(flag);

    const baseGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.3, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x444455,
      metalness: 0.8,
      roughness: 0.3
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.15;
    this.group.add(base);

    scene.add(this.group);

    const shape = new CANNON.Sphere(0.8);
    this.body = new CANNON.Body({
      mass: 0,
      shape,
      position: new CANNON.Vec3(position[0], position[1] + 1, position[2]),
      isTrigger: true
    });
    this.body.userData = { type: 'goal', hiddenPath: false };
    world.addBody(this.body);
  }

  update(dt: number, time: number): void {
    this.group.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry) {
        child.rotation.y = Math.sin(time * 2) * 0.3;
      }
    });
  }
}
