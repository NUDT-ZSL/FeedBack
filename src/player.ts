import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SurfaceType } from './level';
import { JoystickOutput } from './ui';

export interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class Player {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  radius: number = 0.5;

  keys: { [key: string]: boolean } = {};
  joystickInput: JoystickOutput = { x: 0, y: 0, active: false };

  currentSurface: SurfaceType = 'metal';
  onSand: boolean = false;
  onIce: boolean = false;

  lives: number = 5;
  starsCollected: Set<number> = new Set();
  score: number = 0;
  burning: boolean = false;
  burnTimer: number = 0;

  scene: THREE.Scene;
  world: CANNON.World;

  particles: Particle[] = [];
  maxParticles: number = 200;
  shockwaveActive: boolean = false;
  shockwaveTime: number = 0;
  shockwaveMesh?: THREE.Mesh;

  iceGlow?: THREE.PointLight;

  onLifeLost?: () => void;
  onStarCollected?: (index: number) => void;
  onScoreAdd?: (points: number) => void;
  onGoal?: (hiddenPath: boolean) => void;
  onSurfaceChange?: (surface: SurfaceType) => void;

  audioCtx?: AudioContext;

  constructor(scene: THREE.Scene, world: CANNON.World, startPos: [number, number, number]) {
    this.scene = scene;
    this.world = world;

    const ballGeo = new THREE.SphereGeometry(this.radius, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xc0c0d0,
      metalness: 0.9,
      roughness: 0.15,
      envMapIntensity: 1.0
    });
    this.mesh = new THREE.Mesh(ballGeo, ballMat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.iceGlow = new THREE.PointLight(0x88ccff, 0, 3, 2);
    this.iceGlow.position.set(0, 0, 0);
    this.mesh.add(this.iceGlow);

    const shape = new CANNON.Sphere(this.radius);
    this.body = new CANNON.Body({
      mass: 2,
      shape: shape,
      position: new CANNON.Vec3(startPos[0], startPos[1], startPos[2]),
      material: new CANNON.Material('ball'),
      linearDamping: 0.15,
      angularDamping: 0.2
    });
    world.addBody(this.body);

    this.body.addEventListener('collide', this.handleCollision.bind(this));

    this.createShockwave();
    this.bindKeyboard();

    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.log('Audio not supported');
    }
  }

  createShockwave(): void {
    const geo = new THREE.RingGeometry(0.1, 0.3, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    this.shockwaveMesh = new THREE.Mesh(geo, mat);
    this.shockwaveMesh.rotation.x = -Math.PI / 2;
    this.shockwaveMesh.visible = false;
    this.scene.add(this.shockwaveMesh);
  }

  bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  setJoystickInput(input: JoystickOutput): void {
    this.joystickInput = input;
  }

  handleCollision(e: { body: CANNON.Body }): void {
    const other = e.body;

    if (other.userData) {
      const data = other.userData as any;

      if (data.type === 'surface') {
        this.setSurface(data.surface as SurfaceType);
      }

      if (data.type === 'hammer') {
        this.triggerShockwave();
        const dir = new CANNON.Vec3(
          this.body.position.x - other.position.x,
          0.5,
          this.body.position.z - other.position.z
        );
        dir.normalize();
        this.body.velocity.set(dir.x * 12, dir.y * 8, dir.z * 12);
        this.playSound(300, 0.15, 'square');
      }

      if (data.type === 'fire' && data.active && !this.burning) {
        this.takeDamage();
      }

      if (data.type === 'star') {
        const idx = data.index as number;
        if (!this.starsCollected.has(idx)) {
          this.starsCollected.add(idx);
          this.onStarCollected?.(idx);
          this.addScore(100);
          this.playSound(880, 0.2, 'sine');
          if (data.mesh) {
            this.scene.remove(data.mesh);
          }
        }
      }

      if (data.type === 'goal') {
        this.onGoal?.(!!data.hiddenPath);
        if (data.hiddenPath) {
          this.addScore(500);
        } else {
          this.addScore(200);
        }
      }

      if (data.type === 'hiddenPath') {
        this.addScore(10);
      }
    }
  }

  setSurface(surface: SurfaceType): void {
    if (this.currentSurface !== surface) {
      this.currentSurface = surface;
      this.onSurfaceChange?.(surface);
    }
    this.onSand = surface === 'sand';
    this.onIce = surface === 'ice';

    if (this.iceGlow) {
      this.iceGlow.intensity = this.onIce ? 1.5 : 0;
    }

    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    if (this.onIce) {
      mat.emissive = new THREE.Color(0x4488cc);
      mat.emissiveIntensity = 0.3;
    } else {
      mat.emissive = new THREE.Color(0x000000);
      mat.emissiveIntensity = 0;
    }
  }

  takeDamage(): void {
    this.lives = Math.max(0, this.lives - 1);
    this.burning = true;
    this.burnTimer = 1;
    this.onLifeLost?.();
    this.playSound(150, 0.3, 'sawtooth');

    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.emissive = new THREE.Color(0xff4400);
    mat.emissiveIntensity = 0.8;
  }

  triggerShockwave(): void {
    this.shockwaveActive = true;
    this.shockwaveTime = 0;
    if (this.shockwaveMesh) {
      this.shockwaveMesh.visible = true;
      this.shockwaveMesh.position.copy(this.mesh.position);
      this.shockwaveMesh.position.y -= this.radius - 0.05;
      (this.shockwaveMesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
      this.shockwaveMesh.scale.set(1, 1, 1);
    }
  }

  spawnParticle(type: 'sand' | 'fire' | 'shockwave'): void {
    if (this.particles.length >= this.maxParticles) return;

    let color: number;
    let size: number;
    let velocity: THREE.Vector3;

    switch (type) {
      case 'sand':
        color = 0xe6d28a;
        size = 0.06 + Math.random() * 0.04;
        velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 2 + 0.5,
          (Math.random() - 0.5) * 2
        );
        break;
      case 'fire':
        color = Math.random() > 0.5 ? 0xff6600 : 0xffaa00;
        size = 0.08 + Math.random() * 0.06;
        velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 1,
          Math.random() * 3 + 1,
          (Math.random() - 0.5) * 1
        );
        break;
      default:
        return;
    }

    const geo = new THREE.SphereGeometry(size, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.mesh.position);
    mesh.position.y -= this.radius * 0.5;
    this.scene.add(mesh);

    this.particles.push({
      mesh,
      velocity,
      life: type === 'fire' ? 0.6 : 0.8,
      maxLife: type === 'fire' ? 0.6 : 0.8
    });
  }

  addScore(points: number): void {
    this.score += points;
    this.onScoreAdd?.(points);
  }

  playSound(freq: number, duration: number, type: OscillatorType = 'sine'): void {
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  playGearSound(): void {
    if (!this.audioCtx) return;
    try {
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          const osc = this.audioCtx!.createOscillator();
          const gain = this.audioCtx!.createGain();
          osc.type = 'square';
          osc.frequency.value = 80 + i * 20;
          gain.gain.setValueAtTime(0.06, this.audioCtx!.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx!.currentTime + 0.2);
          osc.connect(gain);
          gain.connect(this.audioCtx!.destination);
          osc.start();
          osc.stop(this.audioCtx!.currentTime + 0.2);
        }, i * 150);
      }
    } catch (e) { /* ignore */ }
  }

  update(dt: number): void {
    let inputX = 0;
    let inputZ = 0;

    if (this.keys['ArrowLeft'] || this.keys['KeyA']) inputX -= 1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) inputX += 1;
    if (this.keys['ArrowUp'] || this.keys['KeyW']) inputZ -= 1;
    if (this.keys['ArrowDown'] || this.keys['KeyS']) inputZ += 1;

    if (this.joystickInput.active) {
      inputX = this.joystickInput.x;
      inputZ = this.joystickInput.y;
    }

    const len = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (len > 1) {
      inputX /= len;
      inputZ /= len;
    }

    let torqueStrength = 18;
    let speedMultiplier = 1;

    if (this.onSand) {
      speedMultiplier = 0.7;
    }
    if (this.onIce) {
      speedMultiplier = 1.0;
      torqueStrength *= 0.4;
    }

    if (inputX !== 0 || inputZ !== 0) {
      this.body.applyTorque(new CANNON.Vec3(
        -inputZ * torqueStrength * speedMultiplier,
        0,
        inputX * torqueStrength * speedMultiplier
      ));

      if (this.onSand && Math.random() < 0.4) {
        this.spawnParticle('sand');
      }
    }

    if (this.burning) {
      this.burnTimer -= dt;
      if (Math.random() < 0.5) {
        this.spawnParticle('fire');
      }
      if (this.burnTimer <= 0) {
        this.burning = false;
        const mat = this.mesh.material as THREE.MeshStandardMaterial;
        if (this.onIce) {
          mat.emissive = new THREE.Color(0x4488cc);
          mat.emissiveIntensity = 0.3;
        } else {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    }

    if (this.shockwaveActive) {
      this.shockwaveTime += dt;
      const dur = 0.3;
      const t = this.shockwaveTime / dur;
      if (t >= 1) {
        this.shockwaveActive = false;
        if (this.shockwaveMesh) this.shockwaveMesh.visible = false;
      } else if (this.shockwaveMesh) {
        const s = 1 + t * 5;
        this.shockwaveMesh.scale.set(s, s, s);
        (this.shockwaveMesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      }
    }

    this.particles = this.particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.geometry as THREE.BufferGeometry).dispose();
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      p.velocity.y -= 9.8 * dt * 0.3;
      p.mesh.position.addScaledVector(p.velocity, dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (p.life / p.maxLife);
      return true;
    });

    if (this.body.position.y < -15) {
      this.respawn();
    }

    this.mesh.position.copy(this.body.position as any);
    this.mesh.quaternion.copy(this.body.quaternion as any);
  }

  respawn(): void {
    this.takeDamage();
    this.body.position.set(0, 3, 0);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
  }
}
