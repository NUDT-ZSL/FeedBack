import * as THREE from 'three';
import { sceneManager } from '../../core/SceneManager';

export interface CarData {
  id: string;
  mesh: THREE.Mesh;
  speed: number;
  color: number;
  pathProgress: number;
  currentSegment: number;
}

const CAR_COLORS = [
  0xff0000,
  0x00ff00,
  0x0000ff,
  0xffff00,
  0xff00ff,
  0x00ffff,
  0xff8800,
  0x88ff00,
];

const ROAD_RADIUS = 25;
const ROAD_SEGMENTS = 15;
const ROAD_WIDTH = 6;
const MAX_CARS = 50;

export class TrafficSystem {
  private static _instance: TrafficSystem;
  private _cars: CarData[] = [];
  private _pathPoints: THREE.Vector3[] = [];
  private _pathLength: number = 0;
  private _segmentLengths: number[] = [];
  private _isRunning: boolean = false;
  private _nextCarId: number = 1;
  private _roadGroup: THREE.Group | null = null;

  private constructor() {}

  public static get instance(): TrafficSystem {
    if (!TrafficSystem._instance) {
      TrafficSystem._instance = new TrafficSystem();
    }
    return TrafficSystem._instance;
  }

  public init(): void {
    this._generatePathPoints();
    this._createRoad();
    this._generateCars(20);
    this._bindUpdate();
  }

  private _generatePathPoints(): void {
    this._pathPoints = [];
    this._segmentLengths = [];
    this._pathLength = 0;

    for (let i = 0; i <= ROAD_SEGMENTS; i++) {
      const angle = (i / ROAD_SEGMENTS) * Math.PI * 2;
      const x = Math.cos(angle) * ROAD_RADIUS;
      const z = Math.sin(angle) * ROAD_RADIUS;
      this._pathPoints.push(new THREE.Vector3(x, 0.1, z));
    }

    for (let i = 0; i < ROAD_SEGMENTS; i++) {
      const length = this._pathPoints[i].distanceTo(this._pathPoints[i + 1]);
      this._segmentLengths.push(length);
      this._pathLength += length;
    }
  }

  private _createRoad(): void {
    this._roadGroup = new THREE.Group();

    const roadShape = new THREE.Shape();
    const outerRadius = ROAD_RADIUS + ROAD_WIDTH / 2;
    const innerRadius = ROAD_RADIUS - ROAD_WIDTH / 2;

    roadShape.moveTo(outerRadius, 0);
    for (let i = 1; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      roadShape.lineTo(
        Math.cos(angle) * outerRadius,
        Math.sin(angle) * outerRadius
      );
    }

    const hole = new THREE.Path();
    hole.moveTo(innerRadius, 0);
    for (let i = 1; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      hole.lineTo(
        Math.cos(angle) * innerRadius,
        Math.sin(angle) * innerRadius
      );
    }
    roadShape.holes.push(hole);

    const roadGeometry = new THREE.ShapeGeometry(roadShape);
    roadGeometry.rotateX(-Math.PI / 2);
    roadGeometry.translate(0, 0.05, 0);

    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x333344,
      transparent: true,
      opacity: 0.7,
      roughness: 0.8,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });

    const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
    roadMesh.receiveShadow = true;
    this._roadGroup.add(roadMesh);

    this._createLaneMarkings();

    sceneManager.addObject(this._roadGroup);
  }

  private _createLaneMarkings(): void {
    if (!this._roadGroup) return;

    const markingCount = 30;
    const markingLength = 2;
    const markingWidth = 0.2;
    const markingRadius = ROAD_RADIUS;

    for (let i = 0; i < markingCount; i++) {
      const angleStart = (i / markingCount) * Math.PI * 2;
      const angleEnd = ((i + 0.5) / markingCount) * Math.PI * 2;

      const curve = new THREE.LineCurve3(
        new THREE.Vector3(
          Math.cos(angleStart) * markingRadius,
          0.08,
          Math.sin(angleStart) * markingRadius
        ),
        new THREE.Vector3(
          Math.cos(angleEnd) * markingRadius,
          0.08,
          Math.sin(angleEnd) * markingRadius
        )
      );

      const tubeGeometry = new THREE.TubeGeometry(curve, 8, markingWidth / 2, 4, false);
      const markingMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff88,
        transparent: true,
        opacity: 0.8,
      });

      const marking = new THREE.Mesh(tubeGeometry, markingMaterial);
      this._roadGroup.add(marking);
    }
  }

  private _generateCars(count: number): void {
    for (let i = 0; i < Math.min(count, MAX_CARS); i++) {
      this._createCar(
        (i / count) * this._pathLength,
        CAR_COLORS[i % CAR_COLORS.length]
      );
    }
  }

  private _createCar(progress: number, color: number): CarData {
    const carGroup = new THREE.Group();

    const bodyGeometry = new THREE.BoxGeometry(1.5, 0.6, 0.8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.5,
      metalness: 0.6,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.3;
    body.castShadow = true;

    const topGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.7);
    const topMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.7).getHex(),
      roughness: 0.5,
      metalness: 0.6,
    });
    const top = new THREE.Mesh(topGeometry, topMaterial);
    top.position.set(-0.1, 0.75, 0);
    top.castShadow = true;

    carGroup.add(body);
    carGroup.add(top);

    const car: CarData = {
      id: `car_${this._nextCarId++}`,
      mesh: body,
      speed: 0.5 + Math.random() * 1.0,
      color: color,
      pathProgress: progress,
      currentSegment: 0,
    };

    carGroup.userData.carId = car.id;

    this._cars.push(car);
    sceneManager.addObject(carGroup);

    this._updateCarPosition(car);

    return car;
  }

  private _updateCarPosition(car: CarData): void {
    const carGroup = car.mesh.parent as THREE.Group;
    if (!carGroup) return;

    let remainingDistance = car.pathProgress;
    let segmentIndex = 0;

    while (segmentIndex < ROAD_SEGMENTS && remainingDistance > this._segmentLengths[segmentIndex]) {
      remainingDistance -= this._segmentLengths[segmentIndex];
      segmentIndex++;
    }

    if (segmentIndex >= ROAD_SEGMENTS) {
      segmentIndex = 0;
      remainingDistance = car.pathProgress;
    }

    car.currentSegment = segmentIndex;

    const t = remainingDistance / this._segmentLengths[segmentIndex];
    const startPoint = this._pathPoints[segmentIndex];
    const endPoint = this._pathPoints[segmentIndex + 1];

    const position = new THREE.Vector3().lerpVectors(startPoint, endPoint, t);
    carGroup.position.copy(position);

    const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
    const angle = Math.atan2(direction.z, direction.x);
    carGroup.rotation.y = -angle;
  }

  private _bindUpdate(): void {
    sceneManager.onUpdate(this._update.bind(this));
  }

  private _update(deltaTime: number): void {
    if (!this._isRunning) return;

    for (const car of this._cars) {
      car.pathProgress += car.speed * deltaTime;
      
      if (car.pathProgress >= this._pathLength) {
        car.pathProgress -= this._pathLength;
      }

      this._updateCarPosition(car);
    }
  }

  public start(): void {
    this._isRunning = true;
  }

  public stop(): void {
    this._isRunning = false;
  }

  public toggle(): boolean {
    this._isRunning = !this._isRunning;
    return this._isRunning;
  }

  public isRunning(): boolean {
    return this._isRunning;
  }

  public getCars(): CarData[] {
    return [...this._cars];
  }

  public getCarById(id: string): CarData | undefined {
    return this._cars.find(c => c.id === id);
  }

  public getCarCount(): number {
    return this._cars.length;
  }

  public addCar(): CarData | null {
    if (this._cars.length >= MAX_CARS) {
      return null;
    }

    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const progress = Math.random() * this._pathLength;
    return this._createCar(progress, color);
  }

  public removeCar(id: string): boolean {
    const index = this._cars.findIndex(c => c.id === id);
    if (index === -1) return false;

    const car = this._cars[index];
    const carGroup = car.mesh.parent;
    if (carGroup) {
      sceneManager.removeObject(carGroup);
    }

    car.mesh.geometry.dispose();
    if (car.mesh.material instanceof THREE.Material) {
      car.mesh.material.dispose();
    }

    this._cars.splice(index, 1);
    return true;
  }

  public getAllCarMeshes(): THREE.Mesh[] {
    return this._cars.map(c => c.mesh);
  }

  public getCarByMesh(mesh: THREE.Mesh): CarData | undefined {
    const carGroup = mesh.parent;
    if (!carGroup) return undefined;
    
    const carId = carGroup.userData.carId;
    if (!carId) return undefined;
    
    return this._cars.find(c => c.id === carId);
  }

  public getColorHex(color: number): string {
    return '#' + color.toString(16).padStart(6, '0');
  }

  public dispose(): void {
    sceneManager.offUpdate(this._update.bind(this));
    
    for (const car of this._cars) {
      const carGroup = car.mesh.parent;
      if (carGroup) {
        sceneManager.removeObject(carGroup);
      }
      car.mesh.geometry.dispose();
      if (car.mesh.material instanceof THREE.Material) {
        car.mesh.material.dispose();
      }
    }
    this._cars = [];

    if (this._roadGroup) {
      sceneManager.removeObject(this._roadGroup);
      this._roadGroup = null;
    }
  }
}

export const trafficSystem = TrafficSystem.instance;
