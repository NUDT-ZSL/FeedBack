import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { levelData, getSurfaceMaterial } from './level';
import { Player } from './player';
import { Hammer, FireColumn, Elevator, Star, Gate, HiddenPath, Goal } from './obstacles';
import { UI } from './ui';
import { Simulation, SimConfig, SimEffect, FIXED_DT } from './simulation';

class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  world: CANNON.World;
  clock: THREE.Clock;

  sim: Simulation;
  accumulator: number = 0;

  player: Player;
  ui: UI;
  hammers: Hammer[] = [];
  fireColumns: FireColumn[] = [];
  elevators: Elevator[] = [];
  stars: Star[] = [];
  gate?: Gate;
  hiddenPath?: HiddenPath;
  goal?: Goal;

  platforms: Array<{ mesh: THREE.Mesh; body: CANNON.Body }> = [];
  time: number = 0;

  cameraOffset: THREE.Vector3 = new THREE.Vector3(0, 8, 10);
  cameraTarget: THREE.Vector3 = new THREE.Vector3();

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a24);
    this.scene.fog = new THREE.Fog(0x1a1a24, 20, 80);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 10, 12);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    const container = document.getElementById('canvas-container')!;
    container.appendChild(this.renderer.domElement);

    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0)
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 10;
    this.world.allowSleep = true;

    this.clock = new THREE.Clock();

    this.ui = new UI();

    const simConfig: SimConfig = {
      fireColumns: levelData.fireColumns.map((f) => ({ interval: f.interval })),
      elevators: levelData.elevators.map((e) => ({
        baseY: e.position[1],
        minHeight: e.minHeight,
        maxHeight: e.maxHeight,
        speed: e.speed
      }))
    };
    this.sim = new Simulation(simConfig);

    this.setupLights();
    this.loadLevel();

    this.player = new Player(this.scene, this.world, levelData.start);
    this.player.onCollisionEvent = (event) => this.sim.enqueue(event);
    this.player.onFall = () => {
      // 坠落发生在两次固定步之间，记入下一步结算，保证事件日志可复算
      this.sim.enqueue({ tick: this.sim.tick + 1, type: 'fall' });
    };

    // 调试 / 离线复算：可从控制台导出 __sim.eventLog 后用 npm run replay 复算
    (window as unknown as { __sim: Simulation }).__sim = this.sim;

    this.ui.onJoystickChange = (input) => {
      this.player.setJoystickInput(input);
    };

    window.addEventListener('resize', this.onResize.bind(this));

    this.animate();
  }

  setupLights(): void {
    const ambient = new THREE.AmbientLight(0x404050, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x6688ff, 0.3);
    fillLight.position.set(-10, 10, -5);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xff8c00, 0.5, 50);
    rimLight.position.set(0, 5, -20);
    this.scene.add(rimLight);
  }

  loadLevel(): void {
    const ballMat = new CANNON.Material('ball');

    levelData.platforms.forEach((p) => {
      const { threeMat, cannonMat, friction, restitution } = getSurfaceMaterial(p.surface);

      const geo = new THREE.BoxGeometry(...p.size);
      const mesh = new THREE.Mesh(geo, threeMat);
      mesh.position.set(...p.position);
      if (p.rotation) {
        mesh.rotation.set(...p.rotation);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0xff8c00,
        transparent: true,
        opacity: 0.4
      });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      mesh.add(edges);

      this.scene.add(mesh);

      const shape = new CANNON.Box(new CANNON.Vec3(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2));
      const body = new CANNON.Body({
        mass: 0,
        shape,
        position: new CANNON.Vec3(...p.position),
        material: cannonMat
      });
      if (p.rotation) {
        body.quaternion.setFromEuler(...p.rotation);
      }
      body.userData = { type: 'surface', surface: p.surface };
      this.world.addBody(body);

      const contactMat = new CANNON.ContactMaterial(ballMat, cannonMat, {
        friction,
        restitution
      });
      this.world.addContactMaterial(contactMat);

      this.platforms.push({ mesh, body });
    });

    levelData.hammers.forEach((h, i) => {
      this.hammers.push(new Hammer(this.scene, this.world, h, i));
    });

    levelData.fireColumns.forEach((f, i) => {
      this.fireColumns.push(new FireColumn(this.scene, this.world, f, i));
    });

    levelData.elevators.forEach((e) => {
      this.elevators.push(new Elevator(this.scene, this.world, e, 'metal'));
    });

    levelData.stars.forEach((s, i) => {
      this.stars.push(new Star(this.scene, this.world, s, i));
    });

    this.gate = new Gate(this.scene, this.world, levelData.hiddenPath.gatePosition);

    this.goal = new Goal(this.scene, this.world, levelData.goal);

    this.ui.showMessage(
      '平衡球闯关',
      '方向键 / WASD 或虚拟摇杆控制  ·  收集 3 颗星星解锁隐藏通道',
      4000
    );
  }

  onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateCamera(): void {
    const targetPos = this.player.mesh.position;
    const desired = new THREE.Vector3(
      targetPos.x + this.cameraOffset.x,
      targetPos.y + this.cameraOffset.y,
      targetPos.z + this.cameraOffset.z
    );
    this.camera.position.lerp(desired, 0.08);

    this.cameraTarget.lerp(targetPos, 0.15);
    this.camera.lookAt(this.cameraTarget);
  }

  /** 一个固定物理步：推进机关时间 -> 写入运动学位置 -> 物理步进 -> 统一结算 */
  stepPhysics(): void {
    this.sim.nextTick(FIXED_DT);

    for (let i = 0; i < this.elevators.length; i++) {
      this.elevators[i].applyState(this.sim.elevators[i].y);
    }

    this.hammers.forEach((h) => h.update(FIXED_DT));

    this.player.currentTick = this.sim.tick;
    this.world.step(FIXED_DT);

    this.applyEffects(this.sim.settle());
  }

  applyEffects(effects: SimEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'surfaceChanged':
          this.player.applySurface(effect.surface);
          break;

        case 'hammerHit': {
          const dir = new CANNON.Vec3(effect.dirX, 0.5, effect.dirZ);
          dir.normalize();
          this.player.body.velocity.set(dir.x * 12, dir.y * 8, dir.z * 12);
          this.player.triggerShockwave();
          this.player.playSound(300, 0.15, 'square');
          break;
        }

        case 'lifeLost':
          this.ui.setLives(effect.lives);
          this.ui.showDamageFlash();
          this.player.playSound(150, 0.3, 'sawtooth');
          break;

        case 'gameOver':
          this.ui.showMessage('游戏结束', '最终得分: ' + effect.score, 0);
          break;

        case 'scoreAdd':
          this.ui.addScore(effect.points);
          break;

        case 'starCollected': {
          this.ui.setStars(effect.stars);
          const star = this.stars[effect.index];
          if (star) {
            star.collected = true;
            this.scene.remove(star.mesh);
          }
          this.player.playSound(880, 0.2, 'sine');
          break;
        }

        case 'gateOpened':
          if (this.gate) this.gate.open();
          this.player.playGearSound();
          this.hiddenPath = new HiddenPath(
            this.scene,
            this.world,
            levelData.hiddenPath.pathStart,
            levelData.hiddenPath.pathEnd
          );
          this.ui.showMessage('隐藏通道已开启!', '收集 500 奖励分', 2500);
          break;

        case 'goal':
          this.ui.showMessage(
            effect.hiddenPath ? '完美通关!' : '通关成功!',
            effect.hiddenPath
              ? '隐藏路径奖励 +500  总分: ' + effect.score
              : '总分: ' + effect.score + '  收集所有星星可获得高分',
            0
          );
          break;
      }
    }
  }

  /** 把 Simulation 的状态同步到纯视觉层 */
  syncViews(): void {
    for (let i = 0; i < this.fireColumns.length; i++) {
      this.fireColumns[i].applyState(this.sim.fires[i].active, this.time);
    }
    this.player.setBurning(this.sim.burning);
  }

  animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    if (!this.sim.gameOver && !this.sim.won) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT && !this.sim.gameOver && !this.sim.won) {
        this.stepPhysics();
        this.accumulator -= FIXED_DT;
      }

      this.player.update(dt);

      this.stars.forEach((s) => s.update(dt, this.time));
      this.gate?.update(dt);
      this.hiddenPath?.update(dt, this.time);
      this.goal?.update(dt, this.time);

      this.syncViews();
    }

    this.updateCamera();
    this.ui.animateJoystick();

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
