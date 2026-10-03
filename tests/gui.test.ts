import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EnvironmentManager } from '../src/environment';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';
import { GUIManager } from '../src/gui';

describe('GUI 参数重置链路 (gui)', () => {
  it('GUI 重置后水质参数与环境状态回到默认值', () => {
    const scene = new THREE.Scene();
    const environment = new EnvironmentManager(scene);
    const coralManager = new CoralManager(scene);
    const fishManager = new FishManager(scene, coralManager.getClusterCenters());

    const container = document.createElement('div');
    document.body.appendChild(container);

    let resetCalled = 0;
    let toggleCalled = 0;
    const gui = new GUIManager(container, environment, coralManager, fishManager, {
      onReset: () => { resetCalled++; },
      onToggleSchool: () => { toggleCalled++; },
    });

    environment.setTemperature(31);
    environment.setLightIntensity(15);
    environment.setTurbidity(90);
    gui.params.temperature = 31;
    gui.params.lightIntensity = 15;
    gui.params.turbidity = 90;

    gui.reset();

    expect(gui.params.temperature).toBe(25);
    expect(gui.params.lightIntensity).toBe(80);
    expect(gui.params.turbidity).toBe(10);
    expect(environment.params.temperature).toBe(25);
    expect(environment.params.lightIntensity).toBe(80);
    expect(environment.params.turbidity).toBe(10);
    expect(environment.ambientLight.intensity).toBeCloseTo(0.4, 10);
    expect(environment.directionalLight.intensity).toBeCloseTo(0.8, 10);
    expect((scene.fog as THREE.FogExp2).density).toBeCloseTo(0.015, 10);

    gui.gui.destroy();
    container.remove();
  });
});
