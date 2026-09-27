import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createFakeDocument } from './helpers';
import { EnvironmentManager } from '../src/environment';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';
import { updateHUD, setHUDField, formatTemperature, DEFAULT_WATER_PARAMS } from '../src/hud';

describe('HUD 显示与各管理器内部计数一致', () => {
  let scene: THREE.Scene;
  let env: EnvironmentManager;
  let coralManager: CoralManager;
  let fishManager: FishManager;
  let doc: ReturnType<typeof createFakeDocument>;

  beforeEach(() => {
    scene = new THREE.Scene();
    env = new EnvironmentManager(scene);
    coralManager = new CoralManager(scene);
    fishManager = new FishManager(scene, coralManager.getClusterCenters());
    doc = createFakeDocument();
  });

  function pushHUD(fps = 60): void {
    updateHUD(doc, {
      fps,
      fishCount: fishManager.fishCount,
      coralCount: coralManager.coralCount,
    });
  }

  it('初始 HUD 与鱼群/珊瑚计数一致', () => {
    pushHUD(59.6);
    expect(doc.text('fps')).toBe('60');
    expect(doc.text('fish-count')).toBe(fishManager.fishCount.toString());
    expect(doc.text('fish-count')).toBe('30');
    expect(doc.text('coral-count')).toBe(coralManager.coralCount.toString());
    expect(doc.text('coral-count')).toBe('54');
  });

  it('切换鱼群数量后 HUD 跟随 fishCount 变化', () => {
    fishManager.toggleSchoolSize();
    pushHUD();
    expect(doc.text('fish-count')).toBe('15');

    fishManager.toggleSchoolSize();
    pushHUD();
    expect(doc.text('fish-count')).toBe('30');
  });

  it('珊瑚重置后 HUD 计数与管理器一致', () => {
    coralManager.reset();
    pushHUD();
    expect(doc.text('coral-count')).toBe(coralManager.coralCount.toString());
    expect(doc.text('coral-count')).toBe('54');
  });

  it('水温字段按一位小数格式化，与环境参数一致', () => {
    env.setTemperature(31.25);
    setHUDField(doc, 'water-temp', formatTemperature(env.params.temperature));
    expect(doc.text('water-temp')).toBe('31.3');
    expect(doc.text('water-temp')).toBe(env.params.temperature.toFixed(1));

    env.setTemperature(DEFAULT_WATER_PARAMS.temperature);
    setHUDField(doc, 'water-temp', formatTemperature(env.params.temperature));
    expect(doc.text('water-temp')).toBe('25.0');
  });

  it('缺失的 HUD 元素不会导致异常', () => {
    const emptyDoc = { getElementById: () => null };
    expect(() =>
      updateHUD(emptyDoc, { fps: 60, fishCount: 30, coralCount: 54 })
    ).not.toThrow();
  });
});
