import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { levelData, getSurfaceMaterial, SurfaceType } from './level';
import { Player } from './player';
import { Hammer, FireColumn, Elevator, Star, Gate, HiddenPath, Goal } from './obstacles';
import { UI } from './ui';

class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  world: CANNON.World;
  clock: THREE.Clock;

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
  gameOver: boolean = false;
  won: boolean = false;

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

    this.setupLights();
    this.loadLevel();

    this.player = new Player(this.scene, this.world, levelData.start);
    this.bindPlayerEvents();

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

    levelData.hammers.forEach((h) => {
      this.hammers.push(new Hammer(this.scene, this.world, h));
    });

    levelData.fireColumns.forEach((f) => {
      this.fireColumns.push(new FireColumn(this.scene, this.world, f));
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

  bindPlayerEvents(): void {
    this.player.onLifeLost = () => {
      this.ui.setLives(this.player.lives);
      this.ui.showDamageFlash();
      if (this.player.lives <= 0) {
        this.gameOver = true;
        this.ui.showMessage('游戏结束', '最终得分: ' + this.player.score, 0);
      }
    };

    this.player.onStarCollected = (index) => {
      this.ui.setStars(this.player.starsCollected.size);
      if (this.stars[index]) {
        this.stars[index].collected = true;
      }
      if (this.player.starsCollected.size >= 3 && this.gate) {
        this.gate.open();
        this.player.playGearSound();
        this.hiddenPath = new HiddenPath(
          this.scene,
          this.world,
          levelData.hiddenPath.pathStart,
          levelData.hiddenPath.pathEnd
        );
        this.ui.showMessage('隐藏通道已开启!', '收集 500 奖励分', 2500);
      }
    };

    this.player.onScoreAdd = (points) => {
      this.ui.addScore(points);
    };

    this.player.onGoal = (hiddenPath) => {
      if (!this.won) {
        this.won = true;
        this.ui.showMessage(
          hiddenPath ? '完美通关!' : '通关成功!',
          hiddenPath
            ? '隐藏路径奖励 +500  总分: ' + this.player.score
            : '总分: ' + this.player.score + '  收集所有星星可获得高分',
          0
        );
      }
    };

    this.player.onSurfaceChange = (_surface: SurfaceType) => {
      // 可添加更多表面反馈
    };
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

  animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    if (!this.gameOver && !this.won) {
      this.world.step(1 / 60, dt, 3);

      this.player.update(dt);

      this.hammers.forEach((h) => h.update(dt));
      this.fireColumns.forEach((f) => f.update(dt));
      this.elevators.forEach((e) => e.update(dt));
      this.stars.forEach((s) => s.update(dt, this.time));
      this.gate?.update(dt);
      this.hiddenPath?.update(dt, this.time);
      this.goal?.update(dt, this.time);
    }

    this.updateCamera();
    this.ui.animateJoystick();

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
