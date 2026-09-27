import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EnvironmentManager } from '../src/environment';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';
import { GUIManager } from '../src/gui';
import { CameraController, CAMERA_DEFAULTS } from '../src/cameraController';
import { updateHUD } from '../src/hud';
import { step, makeCamera } from './helpers';

interface Rig {
  scene: THREE.Scene;
  env: EnvironmentManager;
  corals: CoralManager;
  fishes: FishManager;
  gui: GUIManager;
  camera: CameraController;
  resetEnvironment: () => void;
}

function buildRig(): Rig {
  document.body.innerHTML = `
    <div id="app">
      <div id="hud">
        <span id="fps">60</span>
        <span id="fish-count">0</span>
        <span id="coral-count">0</span>
        <span id="water-temp">25</span>
      </div>
      <div id="gui-container"></div>
    </div>`;
  const scene = new THREE.Scene();
  const env = new EnvironmentManager(scene);
  const corals = new CoralManager(scene);
  const fishes = new FishManager(scene, corals.getClusterCenters());
  const camera = new CameraController(makeCamera());
  const rig: Rig = {
    scene, env, corals, fishes, camera,
    gui: null as unknown as GUIManager,
    resetEnvironment: () => {},
  };
  rig.resetEnvironment = () => {
    corals.reset();
    fishes.reset(corals.getClusterCenters());
    rig.gui.reset();
    camera.reset();
  };
  rig.gui = new GUIManager(
    document.getElementById('gui-container')!,
    env, corals, fishes,
    { onReset: rig.resetEnvironment, onToggleSchool: () => fishes.toggleSchoolSize() }
  );
  return rig;
}

function frame(rig: Rig, frames: number, delta: number): void {
  step(frames, delta, (d, t) => {
    rig.camera.update(d, t);
    rig.env.update(d, t);
    rig.corals.update(d, t, rig.env.params.lightIntensity, rig.env.params.temperature);
    rig.fishes.update(d, t, rig.env.params.temperature, rig.env.params.turbidity,
      rig.env.params.lightIntensity, 60);
  });
}

describe('跨模块集成链路', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('GUI 滑杆修改水质参数会写入环境并更新 HUD 水温', () => {
    const rig = buildRig();
    const ctrls = rig.gui.gui.controllersRecursive();
    const tempCtrl = ctrls.find(c => c.property === 'temperature')!;
    tempCtrl.setValue(30);
    expect(rig.env.params.temperature).toBe(30);
    expect(document.getElementById('water-temp')!.textContent).toBe('30.0');

    const turbCtrl = ctrls.find(c => c.property === 'turbidity')!;
    turbCtrl.setValue(90);
    expect((rig.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.055);
  });

  it('水质 -> 环境 -> 珊瑚/鱼群 的下游联动在一帧循环内生效', () => {
    const rig = buildRig();
    rig.env.setTemperature(35);
    rig.env.setLightIntensity(20);
    rig.env.setTurbidity(90);
    frame(rig, 60, 1 / 30);
    rig.fishes.fishes.forEach(f => {
      expect(f.currentSpeed).toBeCloseTo(f.baseSpeed * 1.6, 5);
      expect(f.bioFluorescent).toBe(true);
      expect(f.baseOpacity).toBe(0.4);
    });
    rig.corals.corals.forEach(c => {
      expect(c.baseSaturation).toBeCloseTo(0.75, 5);
    });
  });

  it('完整重置流程连续执行多次后各管理器状态归零且不累积', () => {
    const rig = buildRig();
    for (let i = 0; i < 3; i++) {
      rig.env.setTemperature(35);
      rig.env.setTurbidity(95);
      rig.camera.zoomBy(200, 0);
      frame(rig, 120, 1 / 30);
      rig.resetEnvironment();

      expect(rig.corals.coralCount).toBe(54);
      expect(rig.fishes.fishCount).toBe(30);
      expect(rig.fishes.fishes.length).toBe(30);
      expect(rig.env.params.temperature).toBe(25);
      expect(rig.env.params.lightIntensity).toBe(80);
      expect(rig.env.params.turbidity).toBe(10);
      expect((rig.scene.fog as THREE.FogExp2).density).toBeCloseTo(0.015);
      expect(rig.camera.cameraAngle).toBe(CAMERA_DEFAULTS.angle);
      expect(rig.camera.cameraDistance).toBe(CAMERA_DEFAULTS.distance);
      expect(document.getElementById('water-temp')!.textContent).toBe('25.0');
      rig.corals.corals.forEach(c => {
        expect(c.growthTime).toBe(0);
        expect(c.currentHeight).toBe(0);
      });
    }
    // 场景对象数量不随重置累积：灯光2 + 沙地1 + 粒子1 + 水母20 + 水母灯20
    // + 珊瑚54组 + 鱼30组 = 128
    expect(rig.scene.children.length).toBe(128);
  });

  it('HUD 显示与各管理器内部计数一致', () => {
    const rig = buildRig();
    frame(rig, 30, 1 / 60);
    updateHUD(document, {
      fps: 60,
      fishCount: rig.fishes.fishCount,
      coralCount: rig.corals.coralCount,
    });
    expect(document.getElementById('fish-count')!.textContent)
      .toBe(rig.fishes.fishCount.toString());
    expect(document.getElementById('coral-count')!.textContent)
      .toBe(rig.corals.coralCount.toString());
  });
});
